/// WebSocket server — output push + command dispatch channel.
/// Browser (no Electrobun host) sends SessionCommand JSON frames; this module dispatches them
/// via unix::dispatch() and sends SessionEvent::Response back to the originating client only.

use crate::session::{SessionCommand, SessionEvent, SessionManager};
use crate::store::Store;
use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::net::TcpListener;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio_tungstenite::tungstenite::Message;

use tracing::{info, warn};

/// How long the event bus waits on one client before giving up on it.
const STALL_LIMIT: Duration = Duration::from_secs(10);
/// How long a new connection has to complete the WebSocket handshake.
const HANDSHAKE_LIMIT: Duration = Duration::from_secs(5);

/// Largest output message built from queued chunks (see the per-client send task).
const MERGE_LIMIT: usize = 64 << 10;

/// A connected WebSocket client: its event queue, and a signal that closes its connection.
#[derive(Clone)]
struct Client {
    tx: mpsc::Sender<SessionEvent>,
    kill: Arc<Notify>,
}

pub async fn serve(
    listener: TcpListener,
    db: Arc<Store>,
    event_tx: mpsc::Sender<SessionEvent>,
    event_rx: mpsc::Receiver<SessionEvent>,
    mgr: Arc<Mutex<SessionManager>>,
    port: u16,
) -> Result<()> {

    // Broadcast task: fan out session events to all connected WebSocket clients.
    // A client that falls behind gets backpressure, like any terminal: the bus waits for
    // it, the PTY readers block, and the program producing output pauses. Dropping events
    // (or the client) instead would leave the UI connected but no longer receiving output.
    // Only a client that takes no event for STALL_LIMIT is dropped; its connection is
    // closed so it reconnects instead of hanging.
    let clients: Arc<Mutex<Vec<Client>>> = Arc::new(Mutex::new(vec![]));
    let clients_bcast = clients.clone();
    tokio::spawn(async move {
        let mut rx = event_rx;
        while let Some(ev) = rx.recv().await {
            // Snapshot so a waiting send doesn't hold the lock against new connections.
            let snapshot = clients_bcast.lock().await.clone();
            let mut gone: Vec<mpsc::Sender<SessionEvent>> = vec![];
            for c in &snapshot {
                match tokio::time::timeout(STALL_LIMIT, c.tx.send(ev.clone())).await {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) => gone.push(c.tx.clone()),
                    Err(_) => {
                        warn!("client stalled for {STALL_LIMIT:?}, disconnecting it");
                        c.kill.notify_one();
                        gone.push(c.tx.clone());
                    }
                }
            }
            if !gone.is_empty() {
                clients_bcast.lock().await.retain(|c| !gone.iter().any(|g| g.same_channel(&c.tx)));
            }
        }
    });

    tokio::spawn(crate::plugins::watch(event_tx.clone()));
    tokio::spawn(crate::specs::watch(event_tx.clone()));
    let db_prune = db.clone();
    tokio::spawn(async move {
        let mut hourly = tokio::time::interval(Duration::from_secs(60 * 60));
        hourly.tick().await; // the first tick is immediate; Store::open already pruned
        loop {
            hourly.tick().await;
            let db = db_prune.clone();
            if let Ok(Err(e)) = tokio::task::spawn_blocking(move || db.prune_blocks()).await {
                warn!("pruning old blocks: {e}");
            }
        }
    });

    info!("WebSocket server ready");

    loop {
        let (stream, addr) = listener.accept().await?;
        info!("connection from {}", addr);

        // WebSocket upgrades arrive as "GET /ws HTTP/1.1\r\n...Upgrade: websocket".
        // Plain HTTP asset requests are any other GET path. Peek 7 bytes to tell them apart:
        // route non-WS GET requests to the asset handler; everything else to accept_async.
        let mut peek = [0u8; 7];
        let n = stream.peek(&mut peek).await.unwrap_or(0);
        let is_ws = n < 7 || &peek == b"GET /ws";
        if !is_ws && &peek[..4] == b"GET " {
            tokio::spawn(crate::assets::serve_http(stream));
            continue;
        }

        let (client_tx, mut client_rx) = mpsc::channel::<SessionEvent>(256);
        let kill = Arc::new(Notify::new());
        let clients = clients.clone();
        let mgr = mgr.clone();
        let db = db.clone();

        tokio::spawn(async move {
            let ws = match tokio::time::timeout(HANDSHAKE_LIMIT, tokio_tungstenite::accept_async(stream)).await {
                Ok(Ok(ws)) => ws,
                Ok(Err(e)) => { info!("rejected connection from {}: {}", addr, e); return; }
                Err(_) => { warn!("connection from {addr} didn't finish the handshake in {HANDSHAKE_LIMIT:?}"); return; }
            };
            clients.lock().await.push(Client { tx: client_tx.clone(), kill: kill.clone() });
            let (mut sink, mut source) = ws.split();

            let send_task = tokio::spawn(async move {
                let mut next = client_rx.recv().await;
                while let Some(mut ev) = next.take() {
                    if let SessionEvent::Output { tab_id, data } = &mut ev {
                        while data.len() < MERGE_LIMIT {
                            match client_rx.try_recv() {
                                Ok(SessionEvent::Output { tab_id: t, data: more }) if t == *tab_id => data.push_str(&more),
                                Ok(other) => { next = Some(other); break; }
                                Err(_) => break,
                            }
                        }
                    }
                    let json = serde_json::to_string(&ev).unwrap();
                    if sink.send(Message::Text(json.into())).await.is_err() { break; }
                    if next.is_none() { next = client_rx.recv().await; }
                }
            });

            // Dispatch incoming text frames as SessionCommand; send responses to this client only.
            while tokio::select! {
                m = source.next() => {
                    match m {
                        Some(Ok(Message::Text(text))) => {
                            match serde_json::from_str::<SessionCommand>(&text) {
                                Ok(cmd) => {
                                    let mgr = mgr.clone();
                                    let db = db.clone();
                                    let resp_tx = client_tx.clone();
                                    tokio::spawn(async move {
                                        if let Some(ev) = crate::unix::dispatch(cmd, mgr, db, port).await {
                                            let _ = resp_tx.send(ev).await;
                                        }
                                    });
                                }
                                Err(e) => warn!("[ws] bad command from {addr}: {e}"),
                            }
                            true
                        }
                        Some(Ok(_)) => true,
                        Some(Err(_)) | None => false,
                    }
                }
                _ = kill.notified() => false,
            } {}

            send_task.abort();
        });
    }
}

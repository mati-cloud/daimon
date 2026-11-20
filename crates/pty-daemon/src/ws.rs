/// WebSocket server — one connection per tab, multiplexed over a single port.

use crate::session::{SessionCommand, SessionEvent, SessionManager};
use crate::store::Store;
use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::net::TcpListener;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::Message;

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Web origins allowed to connect: the app's bundled UI only. Debug builds (dev.sh) also
/// allow the Vite dev server the dev app loads. Release builds never do.
fn allowed_origin(origin: &str) -> bool {
    origin == "views://daimon2"
        || (cfg!(debug_assertions) && matches!(origin, "http://localhost:7881" | "http://127.0.0.1:7881"))
}

/// Who may open a WebSocket (all three checks must pass):
/// - Host is loopback with our port: a DNS-rebinding page (evil.example → 127.0.0.1)
///   still sends its own name and is refused.
/// - Origin, if any, is the app's own. Browsers always send it on a WebSocket handshake
///   and pages can't forge it, so no website can talk to the daemon, even with the token.
///   No Origin = a native client (the app's main process); those still need the token.
/// - The token (`?token=`), compared in constant time.
fn authorize(host: Option<&str>, origin: Option<&str>, query: Option<&str>, token: &str, port: u16) -> std::result::Result<(), &'static str> {
    let host_ok = host.is_some_and(|h| {
        h.rsplit_once(':').is_some_and(|(name, p)| {
            p.parse() == Ok(port) && matches!(name.to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "[::1]")
        })
    });
    if !host_ok {
        return Err("Host isn't loopback");
    }
    if origin.is_some_and(|o| !allowed_origin(o)) {
        return Err("web origin not allowed");
    }
    let token_ok = query.is_some_and(|q| {
        q.split('&').any(|kv| kv.strip_prefix("token=").is_some_and(|t| constant_time_eq(t.as_bytes(), token.as_bytes())))
    });
    if !token_ok {
        return Err("bad or missing token");
    }
    Ok(())
}

#[cfg(test)]
mod auth_tests {
    use super::authorize;
    const T: &str = "secret";
    const Q: Option<&str> = Some("token=secret");

    #[test]
    fn app_and_native_clients_pass() {
        assert!(authorize(Some("localhost:7878"), Some("views://daimon2"), Q, T, 7878).is_ok());
        assert!(authorize(Some("127.0.0.1:7878"), None, Q, T, 7878).is_ok());
        assert!(authorize(Some("[::1]:7878"), None, Some("a=1&token=secret"), T, 7878).is_ok());
    }

    #[test]
    fn websites_are_refused_even_with_the_token() {
        for o in ["https://evil.example", "null", "http://localhost:8080", "views://other", "file://"] {
            assert!(authorize(Some("localhost:7878"), Some(o), Q, T, 7878).is_err(), "{o}");
        }
    }

    #[test]
    fn rebinding_and_bad_tokens_are_refused() {
        assert!(authorize(Some("evil.example:7878"), None, Q, T, 7878).is_err());
        assert!(authorize(Some("localhost:7879"), None, Q, T, 7878).is_err());
        assert!(authorize(None, None, Q, T, 7878).is_err());
        assert!(authorize(Some("localhost:7878"), None, Some("token=secreT"), T, 7878).is_err());
        assert!(authorize(Some("localhost:7878"), None, None, T, 7878).is_err());
    }
}
use tracing::{error, info, warn};

/// How long the event bus waits on one client before giving up on it.
const STALL_LIMIT: Duration = Duration::from_secs(10);

/// Largest output message built from queued chunks (see the per-client send task).
const MERGE_LIMIT: usize = 64 << 10;

/// A connected WebSocket client: its event queue, and a signal that closes its connection.
#[derive(Clone)]
struct Client {
    tx: mpsc::Sender<SessionEvent>,
    kill: Arc<Notify>,
}

pub async fn serve(listener: TcpListener, db: Store, token: String, port: u16) -> Result<()> {
    let db = Arc::new(db);
    let token = Arc::new(token);

    // Single event bus: all sessions → all connected WebSocket clients
    let (event_tx, event_rx) = mpsc::channel::<SessionEvent>(1024);
    let mgr = Arc::new(Mutex::new(SessionManager::new(event_tx.clone())));

    // Broadcast task: fan out session events to all connected clients.
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

    info!("WebSocket server ready");

    loop {
        let (stream, addr) = listener.accept().await?;
        info!("connection from {}", addr);

        let mgr = mgr.clone();
        let db = db.clone();
        let token = token.clone();
        let (client_tx, mut client_rx) = mpsc::channel::<SessionEvent>(256);
        let kill = Arc::new(Notify::new());
        clients.lock().await.push(Client { tx: client_tx.clone(), kill: kill.clone() });

        tokio::spawn(async move {
            // The daemon runs shells, so every handshake is checked (see `authorize`).
            let check = |req: &Request, resp: Response| -> std::result::Result<Response, ErrorResponse> {
                let header = |name: &str| req.headers().get(name).and_then(|v| v.to_str().ok());
                match authorize(header("host"), header("origin"), req.uri().query(), &token, port) {
                    Ok(()) => Ok(resp),
                    Err(why) => {
                        warn!("refused connection from {addr}: {why} (origin {:?})", header("origin"));
                        let mut deny = ErrorResponse::new(Some("unauthorized".into()));
                        *deny.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN;
                        Err(deny)
                    }
                }
            };
            let ws = match tokio_tungstenite::accept_hdr_async(stream, check).await {
                Ok(ws) => ws,
                Err(e) => { info!("rejected connection from {}: {}", addr, e); return; }
            };
            let (mut sink, mut source) = ws.split();

            let send_task = tokio::spawn(async move {
                // Output that queued up while the client was busy goes out as one message
                // (consecutive chunks of one tab, up to MERGE_LIMIT): fewer messages to parse
                // exactly when the client is behind; nothing waits for more to arrive.
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

            while let Some(Ok(msg)) = tokio::select! {
                m = source.next() => m,
                _ = kill.notified() => None,
            } {
                if let Message::Text(text) = msg {
                    let cmd: Result<SessionCommand, _> = serde_json::from_str(&text);
                    match cmd {
                        Ok(SessionCommand::Write { tab_id, data, command }) => {
                            let mut mgr = mgr.lock().await;
                            if mgr.write(&tab_id, &data, command.clone()).is_err() {
                                if let Err(e) = mgr.open(tab_id.clone()) {
                                    error!("open session {}: {}", tab_id, e);
                                    continue;
                                }
                                let _ = mgr.write(&tab_id, &data, command);
                            }
                        }
                        Ok(SessionCommand::Attach { req_id, tab_id }) => {
                            let info = mgr.lock().await.attach(&tab_id);
                            info!("attach {}: exists={} running={}", tab_id, info.exists, info.running);
                            let data = serde_json::to_value(info).unwrap_or_default();
                            let _ = client_tx.send(SessionEvent::Response { req_id, ok: true, data }).await;
                        }
                        Ok(SessionCommand::Redraw { tab_id }) => {
                            mgr.lock().await.redraw(&tab_id);
                        }
                        Ok(SessionCommand::TtyRaw { req_id, tab_id }) => {
                            let raw = mgr.lock().await.tty_raw(&tab_id);
                            let _ = client_tx.send(SessionEvent::Response { req_id, ok: true, data: serde_json::Value::Bool(raw) }).await;
                        }
                        Ok(SessionCommand::DaemonInfo { req_id }) => {
                            let sessions = mgr.lock().await.len();
                            let data = serde_json::json!({ "build": crate::daemon_info::build_id(), "sessions": sessions, "pid": std::process::id(), "plugins": crate::plugins::PROTOCOL });
                            let _ = client_tx.send(SessionEvent::Response { req_id, ok: true, data }).await;
                        }
                        Ok(SessionCommand::Shutdown { req_id }) => {
                            info!("shutdown requested");
                            let _ = client_tx.send(SessionEvent::Response { req_id, ok: true, data: serde_json::Value::Bool(true) }).await;
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                            crate::daemon_info::unpublish(port);
                            std::process::exit(0);
                        }
                        Ok(SessionCommand::Resize { tab_id, cols, rows }) => {
                            let mgr = mgr.lock().await;
                            let _ = mgr.resize(&tab_id, cols, rows);
                        }
                        Ok(SessionCommand::Close { tab_id }) => {
                            mgr.lock().await.close(&tab_id);
                        }
                        Ok(SessionCommand::GitStatus { req_id, cwd }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::commands::git_status(&cwd);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::GitLog { req_id, cwd, limit, args }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::commands::git_log(&cwd, limit, &args);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::GitBranch { req_id, cwd }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::commands::git_branch(&cwd);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::GitDiff { req_id, cwd, args }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::commands::git_diff(&args, &cwd);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::ListPaths { req_id, prefix, cwd, kind }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::commands::list_paths(&prefix, &cwd, &kind);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::Complete { req_id, buffer, cwd, tab_id }) => {
                            let tx = client_tx.clone();
                            let remote = match &tab_id {
                                Some(t) => mgr.lock().await.remote_listing(t, &cwd),
                                None => None,
                            };
                            tokio::task::spawn_blocking(move || {
                                let data = crate::complete::complete(&buffer, &cwd, remote.as_deref());
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::CommitDetail { req_id, hash, cwd }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::commands::git_commit_detail(&hash, &cwd);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::FileDiff { req_id, hash, file_path, cwd }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::commands::git_file_diff(&hash, &file_path, &cwd);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::FileContent { req_id, blob, file_path, cwd }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::commands::git_file_content(&blob, &file_path, &cwd);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::LinkPreview { req_id, url }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::link_preview::link_preview(&url);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        // ── Store commands ────────────────────────────────────────────
                        Ok(SessionCommand::HistoryAdd { req_id, cmd, ts }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = match db.history_add(&cmd, ts) {
                                    Ok(_) => serde_json::Value::Bool(true),
                                    Err(e) => { error!("historyAdd: {}", e); serde_json::Value::Bool(false) }
                                };
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::HistoryList { req_id, limit }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = match db.history_list(limit) {
                                    Ok(entries) => serde_json::to_value(entries).unwrap_or_default(),
                                    Err(e) => { error!("historyList: {}", e); serde_json::Value::Array(vec![]) }
                                };
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::BlockSave { req_id, block }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let result = (|| -> anyhow::Result<()> {
                                    let b = crate::store::BlockRow {
                                        id: block["id"].as_str().unwrap_or("").to_string(),
                                        session_id: block["session_id"].as_str().unwrap_or("").to_string(),
                                        input: block["input"].as_str().unwrap_or("").to_string(),
                                        cwd: block["cwd"].as_str().unwrap_or("").to_string(),
                                        ctx: block["ctx"].as_str().unwrap_or("").to_string(),
                                        ts: block["ts"].as_i64().unwrap_or(0),
                                        exit_code: block["exit_code"].as_i64().unwrap_or(0) as i32,
                                        output_json: block["output_json"].as_str().unwrap_or("[]").to_string(),
                                    };
                                    db.block_save(&b)
                                })();
                                let data = serde_json::Value::Bool(result.is_ok());
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::BlockList { req_id, session_id, limit }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = match db.blocks_for_session(&session_id, limit) {
                                    Ok(rows) => serde_json::to_value(rows).unwrap_or_default(),
                                    Err(e) => { error!("blockList: {}", e); serde_json::Value::Array(vec![]) }
                                };
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::BlockRecent { req_id, limit }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = match db.blocks_recent(limit) {
                                    Ok(rows) => serde_json::to_value(rows).unwrap_or_default(),
                                    Err(e) => { error!("blockRecent: {}", e); serde_json::Value::Array(vec![]) }
                                };
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::BlockClear { req_id, session_id }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let ok = db.blocks_delete_session(&session_id).is_ok();
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok, data: serde_json::Value::Bool(ok) });
                            });
                        }
                        Ok(SessionCommand::BlockSearch { req_id, query, limit }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = match db.blocks_search(&query, limit) {
                                    Ok(rows) => serde_json::to_value(rows).unwrap_or_default(),
                                    Err(e) => { error!("blockSearch: {}", e); serde_json::Value::Array(vec![]) }
                                };
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::HistorySearch { req_id, query, limit }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = match db.history_search(&query, limit) {
                                    Ok(rows) => serde_json::to_value(rows).unwrap_or_default(),
                                    Err(e) => { error!("historySearch: {}", e); serde_json::Value::Array(vec![]) }
                                };
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::PrefSet { req_id, key, value }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let ok = db.pref_set(&key, &value).is_ok();
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok, data: serde_json::Value::Bool(ok) });
                            });
                        }
                        Ok(SessionCommand::PrefGet { req_id, key }) => {
                            let tx = client_tx.clone();
                            let db = db.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = match db.pref_get(&key) {
                                    Ok(Some(v)) => serde_json::Value::String(v),
                                    _ => serde_json::Value::Null,
                                };
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::SetContextEnv { req_id, names }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let (ok, data) = match crate::plugins::set_context_env(&names) {
                                    Ok(()) => (true, serde_json::json!(true)),
                                    Err(e) => (false, serde_json::json!({ "error": e.to_string() })),
                                };
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok, data });
                            });
                        }
                        Ok(SessionCommand::PluginList { req_id }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::plugins::list();
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::PluginQuarantine { req_id, name }) => {
                            let tx = client_tx.clone();
                            tokio::task::spawn_blocking(move || {
                                let data = crate::plugins::quarantine(&name);
                                let _ = tx.blocking_send(SessionEvent::Response { req_id, ok: true, data });
                            });
                        }
                        Ok(SessionCommand::PluginApprove { req_id, name }) => {
                            let tx = client_tx.clone();
                            tokio::spawn(async move {
                                let data = crate::plugins::approve(name).await;
                                let _ = tx.send(SessionEvent::Response { req_id, ok: true, data }).await;
                            });
                        }
                        Ok(SessionCommand::Exec { req_id, cmd, args, cwd, env, timeout_ms }) => {
                            let tx = client_tx.clone();
                            tokio::spawn(async move {
                                let (ok, data) = crate::plugins::exec(cmd, args, cwd, env, timeout_ms).await;
                                let _ = tx.send(SessionEvent::Response { req_id, ok, data }).await;
                            });
                        }
                        Err(e) => error!("bad command: {}: {}", text, e),
                    }
                }
            }

            send_task.abort();
        });
    }
}

/// UNIX-domain socket server for privileged commands.
///
/// The Bun host process connects here via net.createConnection to the socket path published
/// in daemon-<port>.json. Identity = uid ownership of the socket file (mode 0600) — no token.
/// The page cannot reach this socket directly (WKWebView's WebSocket API is TCP-only);
/// all page writes are proxied through the Bun host via __electrobunSendToHost IPC.
///
/// Protocol: newline-delimited JSON, same SessionCommand/SessionEvent types as the TCP WS.
/// Each request gets exactly one response (SessionEvent::Response), except push-only
/// commands (write, resize, redraw, close) which fire-and-forget.

use crate::session::{SessionCommand, SessionEvent, SessionManager};
use crate::store::Store;
use anyhow::Result;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::Mutex;
use tracing::{error, info};

pub async fn serve(listener: UnixListener, mgr: Arc<Mutex<SessionManager>>, db: Arc<Store>, port: u16) -> Result<()> {
    info!("UNIX socket ready");
    loop {
        let (stream, _) = listener.accept().await?;
        let mgr = mgr.clone();
        let db = db.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(stream, mgr, db, port).await {
                error!("[unix] connection error: {e}");
            }
        });
    }
}

async fn handle(stream: tokio::net::UnixStream, mgr: Arc<Mutex<SessionManager>>, db: Arc<Store>, port: u16) -> Result<()> {
    let (reader, mut writer) = tokio::io::split(stream);
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines.next_line().await? {
        if line.is_empty() { continue; }
        let cmd: Result<SessionCommand, _> = serde_json::from_str(&line);
        let response: Option<SessionEvent> = match cmd {
            Err(e) => {
                error!("[unix] bad command: {e}");
                None
            }
            Ok(cmd) => {
                // Shutdown must be handled here (needs writer access to send ack before exit).
                if let SessionCommand::Shutdown { ref req_id } = cmd {
                    info!("[unix] shutdown requested");
                    let ev = SessionEvent::Response { req_id: req_id.clone(), ok: true, data: serde_json::Value::Bool(true) };
                    let json = serde_json::to_string(&ev).unwrap_or_default();
                    let _ = writer.write_all(format!("{json}\n").as_bytes()).await;
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    crate::daemon_info::unpublish(port);
                    std::process::exit(0);
                }
                dispatch(cmd, mgr.clone(), db.clone(), port).await
            }
        };

        if let Some(ev) = response {
            let json = serde_json::to_string(&ev).unwrap_or_default();
            writer.write_all(format!("{json}\n").as_bytes()).await?;
        }
    }
    Ok(())
}

/// Dispatch one parsed SessionCommand and return an optional response event.
/// Used by both the UNIX socket handler and the WebSocket handler (ws.rs).
pub async fn dispatch(cmd: SessionCommand, mgr: Arc<Mutex<SessionManager>>, db: Arc<Store>, port: u16) -> Option<SessionEvent> {
    match cmd {
        SessionCommand::Write { tab_id, data, command, cwd } => {
            let mut mgr = mgr.lock().await;
            if mgr.write(&tab_id, &data, command.clone()).is_err() {
                if let Err(e) = mgr.open(tab_id.clone(), cwd) {
                    error!("[unix] open session {tab_id}: {e}");
                } else {
                    let _ = mgr.write(&tab_id, &data, command);
                }
            }
            None
        }
        SessionCommand::Attach { req_id, tab_id } => {
            let info = mgr.lock().await.attach(&tab_id);
            info!("[unix] attach {tab_id}: exists={} running={}", info.exists, info.running);
            Some(SessionEvent::Response { req_id, ok: true, data: serde_json::to_value(info).unwrap_or_default() })
        }
        SessionCommand::Redraw { tab_id } => {
            mgr.lock().await.redraw(&tab_id);
            None
        }
        SessionCommand::TtyRaw { req_id, tab_id } => {
            let raw = mgr.lock().await.tty_raw(&tab_id);
            Some(SessionEvent::Response { req_id, ok: true, data: serde_json::Value::Bool(raw) })
        }
        SessionCommand::DaemonInfo { req_id } => {
            let sessions = mgr.lock().await.len();
            let data = serde_json::json!({
                "build": crate::daemon_info::build_id(),
                "sessions": sessions,
                "pid": std::process::id(),
                "plugins": crate::plugins::PROTOCOL,
            });
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::Shutdown { req_id } => {
            // Shutdown is handled in handle() before dispatch() — this arm is unreachable
            // but must be present for exhaustive match.
            info!("[unix] shutdown (dispatch path)");
            crate::daemon_info::unpublish(port);
            let _ = port;
            Some(SessionEvent::Response { req_id, ok: true, data: serde_json::Value::Bool(true) })
        }
        SessionCommand::Resize { tab_id, cols, rows } => {
            let _ = mgr.lock().await.resize(&tab_id, cols, rows);
            None
        }
        SessionCommand::Close { tab_id } => {
            mgr.lock().await.close(&tab_id);
            None
        }
        SessionCommand::GitStatus { req_id, cwd } => {
            let data = tokio::task::spawn_blocking(move || crate::commands::git_status(&cwd)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::GitLog { req_id, cwd, limit, args } => {
            let data = tokio::task::spawn_blocking(move || crate::commands::git_log(&cwd, limit, &args)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::GitBranch { req_id, cwd } => {
            let data = tokio::task::spawn_blocking(move || crate::commands::git_branch(&cwd)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::GitDiff { req_id, cwd, args } => {
            let data = tokio::task::spawn_blocking(move || crate::commands::git_diff(&args, &cwd)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::ListPaths { req_id, prefix, cwd, kind } => {
            let data = tokio::task::spawn_blocking(move || crate::commands::list_paths(&prefix, &cwd, &kind)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::Complete { req_id, buffer, cwd, tab_id } => {
            let remote = match &tab_id {
                Some(t) => mgr.lock().await.remote_listing(t, &cwd),
                None => None,
            };
            let data = tokio::task::spawn_blocking(move || crate::complete::complete(&buffer, &cwd, remote.as_deref())).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::CommitDetail { req_id, hash, cwd } => {
            let data = tokio::task::spawn_blocking(move || crate::commands::git_commit_detail(&hash, &cwd)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::FileDiff { req_id, hash, file_path, cwd } => {
            let data = tokio::task::spawn_blocking(move || crate::commands::git_file_diff(&hash, &file_path, &cwd)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::FileContent { req_id, blob, file_path, cwd } => {
            let data = tokio::task::spawn_blocking(move || crate::commands::git_file_content(&blob, &file_path, &cwd)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::Image { req_id, url } => {
            let data = tokio::task::spawn_blocking(move || crate::link_preview::image(&url)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::LinkPreview { req_id, url } => {
            let data = tokio::task::spawn_blocking(move || crate::link_preview::link_preview(&url)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::HistoryAdd { req_id, cmd, ts } => {
            let db = db.clone();
            let data = tokio::task::spawn_blocking(move || match db.history_add(&cmd, ts) {
                Ok(_) => serde_json::Value::Bool(true),
                Err(e) => { error!("historyAdd: {e}"); serde_json::Value::Bool(false) }
            }).await.unwrap_or(serde_json::Value::Bool(false));
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::HistoryList { req_id, limit } => {
            let db = db.clone();
            let (ok, data) = tokio::task::spawn_blocking(move || match db.history_list(limit) {
                Ok(entries) => (true, serde_json::to_value(entries).unwrap_or_default()),
                Err(e) => { error!("historyList: {e}"); (false, serde_json::Value::Array(vec![])) }
            }).await.unwrap_or((false, serde_json::Value::Array(vec![])));
            Some(SessionEvent::Response { req_id, ok, data })
        }
        SessionCommand::BlockSave { req_id, block } => {
            let db = db.clone();
            let ok = tokio::task::spawn_blocking(move || {
                let b = crate::store::BlockRow {
                    id: block["id"].as_str().unwrap_or("").to_string(),
                    session_id: block["session_id"].as_str().unwrap_or("").to_string(),
                    input: block["input"].as_str().unwrap_or("").to_string(),
                    cwd: block["cwd"].as_str().unwrap_or("").to_string(),
                    ctx: block["ctx"].as_str().unwrap_or("").to_string(),
                    ts: block["ts"].as_i64().unwrap_or(0),
                    exit_code: block["exit_code"].as_i64().unwrap_or(0) as i32,
                    output_json: block["output_json"].as_str().unwrap_or("[]").to_string(),
                    ssh: block["ssh"].as_str().unwrap_or("").to_string(),
                };
                db.block_save(&b).is_ok()
            }).await.unwrap_or(false);
            Some(SessionEvent::Response { req_id, ok, data: serde_json::Value::Bool(ok) })
        }
        SessionCommand::BlockList { req_id, session_id, limit } => {
            let db = db.clone();
            let (ok, data) = tokio::task::spawn_blocking(move || match db.blocks_for_session(&session_id, limit) {
                Ok(rows) => (true, serde_json::to_value(rows).unwrap_or_default()),
                Err(e) => { error!("blockList: {e}"); (false, serde_json::Value::Array(vec![])) }
            }).await.unwrap_or((false, serde_json::Value::Array(vec![])));
            Some(SessionEvent::Response { req_id, ok, data })
        }
        SessionCommand::BlockRecent { req_id, limit } => {
            let db = db.clone();
            let (ok, data) = tokio::task::spawn_blocking(move || match db.blocks_recent(limit) {
                Ok(rows) => (true, serde_json::to_value(rows).unwrap_or_default()),
                Err(e) => { error!("blockRecent: {e}"); (false, serde_json::Value::Array(vec![])) }
            }).await.unwrap_or((false, serde_json::Value::Array(vec![])));
            Some(SessionEvent::Response { req_id, ok, data })
        }
        SessionCommand::BlockClear { req_id, session_id } => {
            let db = db.clone();
            let ok = tokio::task::spawn_blocking(move || db.blocks_delete_session(&session_id).is_ok()).await.unwrap_or(false);
            Some(SessionEvent::Response { req_id, ok, data: serde_json::Value::Bool(ok) })
        }
        SessionCommand::BlockSearch { req_id, query, limit } => {
            let db = db.clone();
            let (ok, data) = tokio::task::spawn_blocking(move || match db.blocks_search(&query, limit) {
                Ok(rows) => (true, serde_json::to_value(rows).unwrap_or_default()),
                Err(e) => { error!("blockSearch: {e}"); (false, serde_json::Value::Array(vec![])) }
            }).await.unwrap_or((false, serde_json::Value::Array(vec![])));
            Some(SessionEvent::Response { req_id, ok, data })
        }
        SessionCommand::HistorySearch { req_id, query, limit } => {
            let db = db.clone();
            let (ok, data) = tokio::task::spawn_blocking(move || match db.history_search(&query, limit) {
                Ok(rows) => (true, serde_json::to_value(rows).unwrap_or_default()),
                Err(e) => { error!("historySearch: {e}"); (false, serde_json::Value::Array(vec![])) }
            }).await.unwrap_or((false, serde_json::Value::Array(vec![])));
            Some(SessionEvent::Response { req_id, ok, data })
        }
        SessionCommand::PrefSet { req_id, key, value } => {
            let db = db.clone();
            let ok = tokio::task::spawn_blocking(move || db.pref_set(&key, &value).is_ok()).await.unwrap_or(false);
            Some(SessionEvent::Response { req_id, ok, data: serde_json::Value::Bool(ok) })
        }
        SessionCommand::PrefGet { req_id, key } => {
            let db = db.clone();
            let data = tokio::task::spawn_blocking(move || match db.pref_get(&key) {
                Ok(Some(v)) => serde_json::Value::String(v),
                _ => serde_json::Value::Null,
            }).await.unwrap_or(serde_json::Value::Null);
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::SetContextEnv { req_id, names } => {
            let (ok, data) = match crate::plugins::set_context_env(&names) {
                Ok(()) => (true, serde_json::json!(true)),
                Err(e) => (false, serde_json::json!({ "error": e.to_string() })),
            };
            Some(SessionEvent::Response { req_id, ok, data })
        }
        SessionCommand::PluginList { req_id } => {
            let data = tokio::task::spawn_blocking(crate::plugins::list).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::SpecList { req_id } => {
            let data = tokio::task::spawn_blocking(crate::specs::list).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::PluginQuarantine { req_id, name } => {
            let data = tokio::task::spawn_blocking(move || crate::plugins::quarantine(&name)).await.unwrap_or_default();
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::PluginApprove { req_id, name } => {
            let data = crate::plugins::approve(name).await;
            Some(SessionEvent::Response { req_id, ok: true, data })
        }
        SessionCommand::Exec { req_id, cmd, args, cwd, env, timeout_ms } => {
            let (ok, data) = crate::plugins::exec(cmd, args, cwd, env, timeout_ms).await;
            Some(SessionEvent::Response { req_id, ok, data })
        }
    }
}

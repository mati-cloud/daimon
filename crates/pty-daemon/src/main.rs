mod assets;
mod commands;
mod complete;
mod daemon_info;
mod integration;
mod kitty_graphics;
mod launcher_env;
mod link_preview;
mod plugins;
mod precmd_git;
mod session;
mod shell_env;
mod specs;
mod store;
mod unix;
mod ws;

use anyhow::Result;
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::EnvFilter;

/// pty-daemon — owns the shells; the UI connects over a token-protected WebSocket.
///
///   pty-daemon                     run in the foreground (dev.sh)
///   pty-daemon --detach            start in the background and return once it's up;
///                                  sessions outlive the app (production default)
///   pty-daemon --exit-with-parent  quit when stdin closes (the app holds it open), so
///                                  sessions end with the app (DAIMON_PERSIST=0)
///   pty-daemon --info              print {port, token, selfBuild, running} as JSON
///   pty-daemon --token             print the token
///
/// Port: DAIMON_PORT (default 7878).
fn main() -> Result<()> {
    // Before anything else (and before any thread): drop the launcher's CEF preloads.
    launcher_env::scrub();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let has = |flag: &str| args.iter().any(|a| a == flag);
    if has("--info") {
        return daemon_info::print_info();
    }
    if has("--token") {
        println!("{}", daemon_info::token()?);
        return Ok(());
    }
    if has("--detach") {
        #[cfg(unix)]
        return daemon_info::detach(&args);
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("pty_daemon=debug".parse()?))
        .init();

    // PATH for the commands the daemon runs (see shell_env.rs).
    shell_env::init();

    if has("--exit-with-parent") {
        std::thread::spawn(|| {
            let _ = std::io::copy(&mut std::io::stdin().lock(), &mut std::io::sink());
            info!("parent app exited — shutting down");
            daemon_info::unpublish(daemon_info::port());
            std::process::exit(0);
        });
    }

    tokio::runtime::Runtime::new()?.block_on(async {
        let port = daemon_info::port();
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => l,
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                eprintln!("port {port} is in use — is another pty-daemon running? (pty-daemon --info)");
                std::process::exit(3);
            }
            Err(e) => return Err(e.into()),
        };

        // UNIX domain socket for privileged commands (uid ownership = auth, no token).
        let sock_path = daemon_info::socket_path();
        let _ = std::fs::remove_file(&sock_path); // remove stale socket
        std::fs::create_dir_all(sock_path.parent().unwrap())?;
        let unix_listener = tokio::net::UnixListener::bind(&sock_path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sock_path, std::fs::Permissions::from_mode(0o600))?;
        }
        let token = daemon_info::token()?;
        daemon_info::publish(port, &token)?;
        let db = Arc::new(store::Store::open()?);
        info!("daimon pty-daemon listening on 127.0.0.1:{port}, socket {}", sock_path.display());

        let shutdown_port = port;
        tokio::spawn(async move {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
            daemon_info::unpublish(shutdown_port);
            std::process::exit(0);
        });

        // Share SessionManager between TCP (output broadcast) and UNIX (command handling).
        let (event_tx, event_rx) = tokio::sync::mpsc::channel::<session::SessionEvent>(1024);
        let mgr = Arc::new(tokio::sync::Mutex::new(session::SessionManager::new(event_tx.clone())));
        let db2 = db.clone();
        let mgr2 = mgr.clone();
        tokio::spawn(async move {
            if let Err(e) = unix::serve(unix_listener, mgr2, db2, port).await {
                tracing::error!("[unix] serve error: {e}");
            }
        });
        ws::serve(listener, db, event_tx, event_rx).await
    })
}

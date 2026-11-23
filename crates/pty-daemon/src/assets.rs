/// Static asset server — serves the UI bundle (views/daimon2/) over plain HTTP/1.1 on the
/// same port as the WebSocket. The TCP accept loop in main.rs peeks the first 4 bytes; a
/// "GET " prefix lands here, everything else goes to ws::handle_connection.
///
/// Relative path from the daemon binary: views/daimon2/  (electrobun bundle layout:
///   Contents/Resources/app/pty-daemon
///   Contents/Resources/app/views/daimon2/index.html …)
///
/// Security: loopback-only (127.0.0.1 bind), no auth — the page is public HTML, same as a
/// local dev server. Privileged commands go through the UNIX socket, not HTTP.

use anyhow::Result;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

fn assets_root() -> PathBuf {
    // Resolve relative to current executable so it works in both the installed bundle
    // and a local build (where the daemon binary is next to the UI dist/).
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().unwrap_or(Path::new(".")).join("views/daimon2")
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "wasm" => "application/wasm",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "ttf" => "font/ttf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// Read the request line (up to \r\n) from a stream that has already had its first 4
/// bytes peeked but NOT consumed. Returns the path component, e.g. "/assets/main.js".
async fn read_path(stream: &mut TcpStream) -> Result<String> {
    let mut buf = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    // Read up to 2 KiB to find the request line; ignore headers.
    for _ in 0..2048 {
        stream.read_exact(&mut byte).await?;
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n") {
            break;
        }
    }
    // "GET /path HTTP/1.1\r\n"
    let line = std::str::from_utf8(&buf).unwrap_or("").trim();
    let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
    Ok(path)
}

pub async fn serve_http(mut stream: TcpStream) {
    if let Err(e) = handle(&mut stream).await {
        tracing::debug!("[assets] {e}");
    }
}

async fn handle(stream: &mut TcpStream) -> Result<()> {
    let raw_path = read_path(stream).await?;
    // Drain remaining request headers (we don't need them).
    drain_headers(stream).await?;

    let req_path = raw_path.split('?').next().unwrap_or("/");
    // Strip leading slash, percent-decode minimal set.
    let rel = req_path.trim_start_matches('/');
    let rel = percent_decode(rel);

    // Security: reject any path that escapes the root.
    if rel.contains("..") {
        return write_response(stream, 400, "text/plain", b"bad request").await;
    }

    let root = assets_root();
    let candidate = if rel.is_empty() {
        root.join("index.html")
    } else {
        root.join(&rel)
    };

    // SPA fallback: unknown paths serve index.html so the React router handles them.
    let (file_path, content_type) = if candidate.is_file() {
        let ct = mime(&candidate);
        (candidate, ct)
    } else {
        (root.join("index.html"), "text/html; charset=utf-8")
    };

    let body = tokio::fs::read(&file_path).await?;
    write_response(stream, 200, content_type, &body).await
}

async fn write_response(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) -> Result<()> {
    let reason = if status == 200 { "OK" } else { "Bad Request" };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body).await?;
    Ok(())
}

/// Consume headers until the blank line that ends the HTTP request.
async fn drain_headers(stream: &mut TcpStream) -> Result<()> {
    let mut buf = [0u8; 1];
    let mut last4 = [0u8; 4];
    for _ in 0..16384 {
        stream.read_exact(&mut buf).await?;
        last4 = [last4[1], last4[2], last4[3], buf[0]];
        if &last4 == b"\r\n\r\n" {
            return Ok(());
        }
    }
    Ok(()) // give up gracefully
}

fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b as char);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

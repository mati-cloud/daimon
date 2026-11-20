//! Open Graph link previews for URLs found in command output.
//!
//! The webview can't read other origins (CORS), so the daemon fetches the page with `curl`
//! (same approach as `git`: a subprocess, no HTTP stack compiled in), reads at most
//! `MAX_BYTES` of it and pulls the `og:` / `twitter:` / `<title>` tags out of the head.
//! Results — including misses — are cached for the daemon's lifetime.

use regex_lite::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

const MAX_BYTES: usize = 512 * 1024;
const CACHE_CAP: usize = 512;

fn cache() -> &'static Mutex<HashMap<String, Value>> {
    static C: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Preview for `url`, or `null` when the page has nothing worth showing (or can't be fetched).
pub fn link_preview(url: &str) -> Value {
    if let Some(v) = cache().lock().unwrap().get(url) {
        return v.clone();
    }
    // Image and icon stay URLs: the UI shows them through `image` (fetched the same way).
    let v = fetch_head(url).map(|html| parse(url, &html)).unwrap_or(Value::Null);
    let mut c = cache().lock().unwrap();
    if c.len() >= CACHE_CAP {
        c.clear();
    }
    c.insert(url.to_string(), v.clone());
    v
}

/// A URL's host and port, for http(s) URLs without credentials. IPv6 literals aren't
/// previewed (curl's `--resolve` pinning below would need them bracketed; they're rare in output).
fn target(url: &str) -> Option<(String, u16)> {
    let (rest, port) = match url.strip_prefix("https://") {
        Some(r) => (r, 443),
        None => (url.strip_prefix("http://")?, 80),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains(['@', '[', '\\']) {
        return None; // userinfo, an IPv6 literal, or a backslash some parsers treat as '/'
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h, p.parse().ok()?),
        None => (authority, port),
    };
    let host = host.to_ascii_lowercase();
    (!host.is_empty()).then_some((host, port))
}

/// Only addresses on the public internet. Output often mentions dev servers, routers and
/// internal endpoints; those are never fetched.
fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified()
                || v4.is_broadcast() || v4.is_documentation() || v4.is_multicast()
                || a == 0 || a >= 240 || (a == 100 && (64..=127).contains(&b)) || (a == 198 && (b == 18 || b == 19)))
        }
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => public(IpAddr::V4(v4)),
            None => !(v6.is_loopback() || v6.is_unspecified() || v6.is_multicast()
                || v6.is_unique_local() || v6.is_unicast_link_local()
                || v6.segments()[0] == 0x64 && v6.segments()[1] == 0xff9b // NAT64 (wraps IPv4)
                || v6.segments()[0] == 0x2002                              // 6to4 (wraps IPv4)
                || v6.segments()[0] == 0x2001 && v6.segments()[1] == 0xdb8),
        },
    }
}

/// Resolves the URL's host once and returns the address to connect to, if every address
/// it resolves to is public. curl is then pinned to that address (`--resolve`), so a DNS
/// answer that changes between this check and the fetch (rebinding) can't redirect it.
fn allowed(url: &str) -> Option<(String, u16, IpAddr)> {
    let (host, port) = target(url)?;
    let addrs: Vec<IpAddr> = (host.as_str(), port).to_socket_addrs().ok()?.map(|a| a.ip()).collect();
    if addrs.is_empty() || !addrs.iter().all(|ip| public(*ip)) {
        return None;
    }
    let ip = *addrs.iter().find(|ip| ip.is_ipv4()).unwrap_or(&addrs[0]);
    Some((host, port, ip))
}

const MAX_REDIRECTS: usize = 5;

/// Fetches `url` (at most `max` bytes of body), following redirects one hop at a time so
/// each new host goes through the same `allowed` check (curl's own `-L` would follow them
/// unchecked). Returns the body (`max + 1` bytes means it was cut off) and its content type.
fn fetch(url: &str, max: usize, accept: &str) -> Option<(Vec<u8>, String)> {
    let mut url = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let (host, port, ip) = allowed(&url)?;
        let ip = match ip { IpAddr::V6(v6) => format!("[{v6}]"), v4 => v4.to_string() };
        let mut child = Command::new("curl")
            .env("PATH", crate::shell_env::path())
            .args([
                "-s",
                "--compressed",
                "--max-time", "6",
                "--max-redirs", "0",
                "--proto", "=http,https",
                "--resolve", &format!("{host}:{port}:{ip}"),
                "-A", "Mozilla/5.0 (compatible; daimon-link-preview)",
                "-H", &format!("Accept: {accept}"),
                // Redirect target (empty if none) and content type go to stderr, apart from the body.
                "-w", "%{stderr}%{redirect_url}\n%{content_type}",
                "--",
                &url,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .ok()?;
        let mut body = Vec::with_capacity(64 * 1024);
        let _ = child.stdout.take()?.take(max as u64 + 1).read_to_end(&mut body);
        let _ = child.kill();
        let mut meta = String::new();
        let _ = child.stderr.take()?.take(8192).read_to_string(&mut meta);
        let _ = child.wait();
        let (redirect, content_type) = meta.split_once('\n').unwrap_or((meta.as_str(), ""));
        let redirect = redirect.trim();
        if !redirect.is_empty() {
            url = redirect.to_string();
            continue;
        }
        return Some((body, content_type.trim().to_ascii_lowercase()));
    }
    None
}

/// The page's <head> (the tags we want live there; a huge body isn't scanned).
fn fetch_head(url: &str) -> Option<String> {
    let (body, _) = fetch(url, MAX_BYTES, "text/html,application/xhtml+xml")?;
    let text = String::from_utf8_lossy(&body);
    let end = text.find("</head>").or_else(|| text.find("</HEAD>")).unwrap_or(text.len());
    Some(text[..end].to_string())
}

const MAX_IMAGE_BYTES: usize = 2 << 20;

/// An image as a `data:` URL, or `null`. The webview shows remote images only through this,
/// so it never connects anywhere itself: every fetch goes through `allowed`, pinned.
pub fn image(url: &str) -> Value {
    use base64::Engine;
    let Some((body, ct)) = fetch(url, MAX_IMAGE_BYTES, "image/*") else { return Value::Null };
    let mime = ct.split(';').next().unwrap_or("").trim();
    let ok = mime.strip_prefix("image/").is_some_and(|sub| {
        !sub.is_empty() && sub.bytes().all(|b| b.is_ascii_alphanumeric() || b"+-.".contains(&b))
    });
    if !ok || body.is_empty() || body.len() > MAX_IMAGE_BYTES {
        return Value::Null;
    }
    Value::String(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(body)))
}

fn re(pat: &str) -> Regex {
    Regex::new(pat).expect("static regex")
}

fn attrs(tag: &str) -> HashMap<String, String> {
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let attr = ATTR.get_or_init(|| re(r#"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))"#));
    attr.captures_iter(tag)
        .map(|c| {
            let v = c.get(2).or(c.get(3)).or(c.get(4)).map(|m| m.as_str()).unwrap_or("");
            (c[1].to_ascii_lowercase(), decode_entities(v))
        })
        .collect()
}

fn parse(url: &str, html: &str) -> Value {
    static META: OnceLock<Regex> = OnceLock::new();
    static LINK: OnceLock<Regex> = OnceLock::new();
    static TITLE: OnceLock<Regex> = OnceLock::new();
    let meta_re = META.get_or_init(|| re(r"(?is)<meta\b[^>]*>"));
    let link_re = LINK.get_or_init(|| re(r"(?is)<link\b[^>]*>"));
    let title_re = TITLE.get_or_init(|| re(r"(?is)<title\b[^>]*>(.*?)</title>"));

    let mut meta: HashMap<String, String> = HashMap::new();
    for m in meta_re.find_iter(html) {
        let a = attrs(m.as_str());
        let key = a.get("property").or_else(|| a.get("name")).map(|k| k.to_ascii_lowercase());
        if let (Some(k), Some(v)) = (key, a.get("content")) {
            let v = v.trim();
            if !v.is_empty() {
                meta.entry(k).or_insert_with(|| v.to_string());
            }
        }
    }
    let get = |keys: &[&str]| keys.iter().find_map(|k| meta.get(*k).cloned());

    let title = get(&["og:title", "twitter:title"])
        .or_else(|| title_re.captures(html).map(|c| decode_entities(c[1].trim())))
        .filter(|t| !t.is_empty());
    let description = get(&["og:description", "twitter:description", "description"]);
    let image = get(&["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"])
        .map(|i| resolve(url, &i));
    let site_name = get(&["og:site_name", "application-name"]);

    let mut icon = None;
    for m in link_re.find_iter(html) {
        let a = attrs(m.as_str());
        let rel = a.get("rel").map(|r| r.to_ascii_lowercase()).unwrap_or_default();
        if rel.split_whitespace().any(|r| r == "icon") || rel.contains("apple-touch-icon") {
            if let Some(h) = a.get("href") {
                icon = Some(resolve(url, h));
                if rel.split_whitespace().any(|r| r == "icon") {
                    break; // prefer a plain icon over the touch icon
                }
            }
        }
    }
    let icon = icon.unwrap_or_else(|| resolve(url, "/favicon.ico"));

    if title.is_none() && description.is_none() && image.is_none() {
        return Value::Null;
    }
    json!({
        "url": url,
        "title": title.map(|t| clip(&t, 200)),
        "description": description.map(|d| clip(&d, 300)),
        "image": image,
        "siteName": site_name.map(|s| clip(&s, 80)),
        "icon": icon,
    })
}

fn clip(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= n { s } else { format!("{}…", s.chars().take(n).collect::<String>().trim_end()) }
}

/// Resolve `href` against the page `base` (enough for og:image / icon hrefs).
fn resolve(base: &str, href: &str) -> String {
    let href = href.trim();
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    let scheme = if base.starts_with("https://") { "https:" } else { "http:" };
    if let Some(rest) = href.strip_prefix("//") {
        return format!("{scheme}//{rest}");
    }
    let after = &base[scheme.len() + 2..];
    let host_end = after.find(['/', '?', '#']).unwrap_or(after.len());
    let origin = &base[..scheme.len() + 2 + host_end];
    if href.starts_with('/') {
        return format!("{origin}{href}");
    }
    let path = after[host_end..].split(['?', '#']).next().unwrap_or("");
    let dir = &path[..path.rfind('/').map(|i| i + 1).unwrap_or(0)];
    let dir = if dir.is_empty() { "/" } else { dir };
    format!("{origin}{dir}{href}")
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(semi) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..semi];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => { out.push(c); rest = &rest[semi + 1..]; }
            None => { out.push('&'); rest = &rest[1..]; }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_hosts() {
        for u in [
            "http://localhost:3000", "http://127.0.0.1/x", "http://127.1/", "http://0x7f.0.0.1/",
            "http://2130706433/", "http://192.168.1.5", "http://172.20.0.1", "http://10.0.0.1",
            "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1", "http://0.0.0.0/",
            "https://user:pw@example.com", "http://[::1]/", "ftp://example.com", "http://localhost./",
        ] {
            assert!(allowed(u).is_none(), "{u}");
        }
        assert!(!public("::ffff:127.0.0.1".parse().unwrap()));
        assert!(!public("fd00::1".parse().unwrap()));
        assert!(!public("fe80::1".parse().unwrap()));
        assert!(public("1.1.1.1".parse().unwrap()));
        assert!(public("2606:4700::1111".parse().unwrap()));
        assert_eq!(target("https://example.com:8443/a"), Some(("example.com".into(), 8443)));
    }

    #[test]
    fn parses_og_tags() {
        let html = r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="iammati/daimon" />
            <meta name="description" content="A &amp; B">
            <meta property='og:image' content='/img/card.png'>
            <link rel="icon" href="fav.svg"></head>"#;
        let v = parse("https://example.com/a/b", html);
        assert_eq!(v["title"], "iammati/daimon");
        assert_eq!(v["description"], "A & B");
        assert_eq!(v["image"], "https://example.com/img/card.png");
        assert_eq!(v["icon"], "https://example.com/a/fav.svg");
    }

    #[test]
    fn empty_page_is_null() {
        assert!(parse("https://example.com", "<html><head></head>").is_null());
    }
}

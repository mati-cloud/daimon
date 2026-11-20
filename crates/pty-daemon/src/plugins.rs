//! Runtime UI plugins: files in ~/.config/daimon/plugins/, handed to the UI as source text
//! so it can import them without a build step (it strips TS/JSX itself). Plus `exec`, so a
//! plugin can talk to system tools without a dedicated daemon command.
//!
//! A plugin runs with the user's full power (`exec`), so none loads until the user approves
//! that exact file. Approvals are SHA-256 hashes in a root-owned file (APPROVALS), written
//! only through an OS admin prompt (`approve`). Other software running as the user can drop
//! or edit a plugin, but can't approve it: the new or changed file is blocked and reported.

use crate::session::SessionEvent;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tokio::sync::mpsc;

/// Plugin protocol version, reported in `daemonInfo` so the UI can tell an old daemon apart.
pub const PROTOCOL: u32 = 1;

const EXTENSIONS: &[&str] = &["js", "mjs", "jsx", "ts", "tsx"];

pub fn plugins_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config/daimon/plugins"))
}

/// Plugin files, sorted. `*.d.ts` are type declarations, not plugins.
fn plugin_files() -> Vec<PathBuf> {
    let Some(dir) = plugins_dir() else { return vec![] };
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![] };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or_default();
            p.is_file() && EXTENSIONS.contains(&ext) && !name.ends_with(".d.ts") && !name.starts_with('.')
        })
        .collect();
    files.sort();
    files
}

/// `[{ name, file, sha256, findings, approved, source? }]`: `name` is the file stem, `file`
/// the full file name. `source` only for approved plugins; the rest are reported, not run.
/// Missing dir → empty list. Unreadable files are skipped with a warning.
pub fn list() -> Value {
    let approved = read_approvals();
    let plugins: Vec<Value> = plugin_files()
        .into_iter()
        .filter_map(|p| match std::fs::read_to_string(&p) {
            Ok(source) => {
                let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
                let file = p.file_name().and_then(|s| s.to_str()).unwrap_or_default();
                let sha256 = sha256_hex(&source);
                let findings = scan(&source);
                let ok = approved.iter().any(|(h, n)| *h == sha256 && n == name);
                let official = OFFICIAL.iter().any(|(n, src)| *n == name && sha256_hex(src) == sha256);
                let known = approved.iter().any(|(_, n)| n == name);
                let mut v = json!({
                    "name": name,
                    "file": file,
                    "sha256": sha256,
                    "findings": findings.iter().map(|f| json!({ "id": f.id, "what": f.what, "privileged": f.privileged })).collect::<Vec<_>>(),
                    "approved": ok,
                    "official": official,
                });
                if ok {
                    v["source"] = Value::String(source);
                } else {
                    let why = if known { "changed since it was approved" } else { "not approved" };
                    v["reason"] = Value::String(why.into());
                    tracing::warn!("plugin incident: blocked {} ({why}; sha256 {sha256})", p.display());
                }
                Some(v)
            }
            Err(e) => {
                tracing::warn!("plugin {}: {}", p.display(), e);
                None
            }
        })
        .collect();
    Value::Array(plugins)
}

/// The plugins that ship with daimon (`daimon plugin add`, same list in daimon-cli's
/// plugin.rs). An unmodified copy is reported as `official`.
const OFFICIAL: &[(&str, &str)] = &[
    ("kubernetes", include_str!("../../../plugins/kubernetes.tsx")),
    ("openstack", include_str!("../../../plugins/openstack.tsx")),
];

fn find_plugin(name: &str) -> Option<PathBuf> {
    plugin_files().into_iter().find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(name))
}

/// Take a blocked plugin out of the way: renamed to `.<file>.quarantined` in the same
/// folder (dotfiles aren't loaded), so it never runs but nothing is lost.
pub fn quarantine(name: &str) -> Value {
    let Some(path) = find_plugin(name) else {
        return json!({ "ok": false, "error": format!("no plugin named {name}") });
    };
    let file = path.file_name().and_then(|s| s.to_str()).unwrap_or_default();
    let mut dest = path.with_file_name(format!(".{file}.quarantined"));
    if dest.exists() {
        let ts = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        dest = path.with_file_name(format!(".{file}.{ts}.quarantined"));
    }
    match std::fs::rename(&path, &dest) {
        Ok(()) => {
            tracing::warn!("plugin incident: quarantined {} → {}", path.display(), dest.display());
            json!({ "ok": true, "path": dest.display().to_string() })
        }
        Err(e) => json!({ "ok": false, "error": format!("couldn't move {}: {e}", path.display()) }),
    }
}

// ── Approval ─────────────────────────────────────────────────────────────────────────────

/// Approved plugins, one `<sha256> <name>` per line. Root-owned: writing it takes an admin
/// password, so software running as the user can't approve anything.
#[cfg(target_os = "macos")]
pub const APPROVALS: &str = "/Library/Application Support/daimon/approved-plugins";
#[cfg(not(target_os = "macos"))]
pub const APPROVALS: &str = "/etc/daimon/approved-plugins";

fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Plugin names that may go into the approvals file (and the admin shell command).
fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

fn parse_approvals(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let (h, n) = l.trim().split_once(' ')?;
            (h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()) && valid_name(n)).then(|| (h.to_string(), n.to_string()))
        })
        .collect()
}

/// The approvals, if the file and its folder are owned by root and writable by no one else.
/// Anything else (missing, tampered with, a symlink) means nothing is approved.
fn read_approvals() -> Vec<(String, String)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let path = std::path::Path::new(APPROVALS);
        let trusted = |p: &std::path::Path| {
            std::fs::symlink_metadata(p).is_ok_and(|m| m.uid() == 0 && m.mode() & 0o022 == 0 && !m.file_type().is_symlink())
        };
        if !path.exists() {
            return vec![];
        }
        if !(trusted(path) && path.parent().is_some_and(trusted)) {
            tracing::warn!("plugin incident: {APPROVALS} isn't root-owned or is writable by others — ignoring it");
            return vec![];
        }
        std::fs::read_to_string(path).map(|t| parse_approvals(&t)).unwrap_or_default()
    }
    #[cfg(not(unix))]
    vec![]
}

/// Shell script (run as root) that writes `entries` as the approvals file.
/// Every value in it is hex or a `valid_name`, so nothing needs escaping.
fn approvals_script(entries: &[(String, String)]) -> String {
    let dir = std::path::Path::new(APPROVALS).parent().unwrap().display().to_string();
    let lines: Vec<String> = entries.iter().map(|(h, n)| format!("'{h} {n}'")).collect();
    format!(
        "umask 022 && mkdir -p '{dir}' && chown root '{dir}' && chmod 755 '{dir}' && \
         printf '%s\\n' {} > '{APPROVALS}.tmp' && chown root '{APPROVALS}.tmp' && chmod 644 '{APPROVALS}.tmp' && \
         mv -f '{APPROVALS}.tmp' '{APPROVALS}'",
        lines.join(" ")
    )
}

/// Approve plugin `name` as its file is now, behind an OS admin prompt (macOS: the system
/// password dialog; Linux: polkit). Without a graphical prompt, the error carries the
/// `sudo` command to run instead.
pub async fn approve(name: String) -> Value {
    if !valid_name(&name) {
        return json!({ "approved": false, "error": "rename the plugin file to letters, digits, '.', '_' or '-' to approve it" });
    }
    let Some(path) = find_plugin(&name) else {
        return json!({ "approved": false, "error": format!("no plugin named {name}") });
    };
    let Ok(source) = std::fs::read_to_string(&path) else {
        return json!({ "approved": false, "error": format!("can't read {}", path.display()) });
    };
    let sha256 = sha256_hex(&source);
    let mut entries: Vec<(String, String)> = read_approvals().into_iter().filter(|(_, n)| *n != name).collect();
    entries.push((sha256.clone(), name.clone()));
    let script = approvals_script(&entries);

    let findings = scan(&source);
    let can: Vec<&str> = findings.iter().map(|f| f.what).collect();
    let prompt = format!(
        "daimon: approve plugin \"{name}\" (sha256 {})?\n\n{}\n\nOnly approve a plugin you installed yourself.",
        &sha256[..12],
        if can.is_empty() { "No risky capabilities found.".to_string() } else { format!("It can: {}.", can.join("; ")) },
    );
    tracing::info!("plugin approval requested: {name} (sha256 {sha256})");

    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = tokio::process::Command::new("/usr/bin/osascript");
        c.args([
            "-e", "on run argv",
            "-e", "do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges",
            "-e", "end run",
            &script, &prompt,
        ]);
        c
    } else if std::env::var_os("DISPLAY").or_else(|| std::env::var_os("WAYLAND_DISPLAY")).is_some()
        && std::path::Path::new("/usr/bin/pkexec").exists()
    {
        let mut c = tokio::process::Command::new("/usr/bin/pkexec");
        c.args(["/bin/sh", "-c", &script]);
        c
    } else {
        return json!({ "approved": false, "error": "no graphical admin prompt here — run this in a terminal", "command": format!("sudo sh -c \"{script}\"") });
    };
    match cmd.stdin(std::process::Stdio::null()).output().await {
        Ok(out) if out.status.success() && read_approvals().iter().any(|(h, n)| *h == sha256 && *n == name) => {
            tracing::info!("plugin approved: {name} (sha256 {sha256})");
            json!({ "approved": true })
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let cancelled = err.contains("-128") || out.status.code() == Some(126);
            tracing::warn!("plugin approval of {name} failed: {err}");
            json!({ "approved": false, "error": if cancelled { "approval cancelled".to_string() } else { format!("approval failed: {err}") } })
        }
        Err(e) => json!({ "approved": false, "error": format!("couldn't ask for approval: {e}") }),
    }
}

// ── Static scan ──────────────────────────────────────────────────────────────────────────

pub struct Finding {
    pub id: &'static str,
    pub what: &'static str,
    /// Root-alike: could take over the shell, the daemon or the user's data.
    pub privileged: bool,
}

/// What a plugin's source looks able to do, shown when approving it. A heuristic, not a
/// sandbox: obfuscated code can hide (that's what approval of the exact hash is for), so
/// obfuscation is itself a finding.
pub fn scan(source: &str) -> Vec<Finding> {
    use regex_lite::Regex;
    use std::sync::OnceLock;
    static RULES: OnceLock<Vec<(Regex, Finding)>> = OnceLock::new();
    let rules = RULES.get_or_init(|| {
        let r = |re: &str, id, what, privileged| (Regex::new(re).unwrap(), Finding { id, what, privileged });
        vec![
            r(r"\bexec\b", "exec", "run any program as you", true),
            r(r"\brunCommand\b", "runCommand", "type commands into your terminal", true),
            r(r"\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b", "network", "make network connections", true),
            r(r"\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|setTimeout\s*\(\s*[\x22'`]", "dynamic-code", "run code built at runtime", true),
            r(r"sessionStorage|localStorage|indexedDB|document\.cookie|__daimonPlugin|__electrobun|daimon_token", "internals", "read daimon's internal storage (incl. the daemon token)", true),
            r(r"innerHTML|outerHTML|insertAdjacentHTML|document\.write|createElement\s*\(\s*[\x22'`](script|iframe)", "dom-injection", "inject HTML or scripts into daimon's window", true),
            r(r"\batob\s*\(|fromCharCode|(\\x[0-9a-fA-F]{2}){8}|(\\u[0-9a-fA-F]{4}){8}", "obfuscation", "contain encoded or obfuscated code", true),
            r(r"\bwatchEnv\b", "env", "read environment variables from your shell", false),
            r(r"navigator\.clipboard", "clipboard", "read and write your clipboard", false),
            r(r"\bprefSet\b", "prefs", "change stored settings", false),
        ]
    });
    let mut found: Vec<Finding> = rules
        .iter()
        .filter(|(re, _)| re.is_match(source))
        .map(|(_, f)| Finding { id: f.id, what: f.what, privileged: f.privileged })
        .collect();
    if source.lines().any(|l| l.len() > 1000) && !found.iter().any(|f| f.id == "obfuscation") {
        found.push(Finding { id: "obfuscation", what: "contain encoded or obfuscated code", privileged: true });
    }
    found
}

/// Name, size and mtime of every plugin file (and of the approvals file): cheap to take,
/// changes on any edit or approval.
fn snapshot() -> Vec<(PathBuf, u64, Option<SystemTime>)> {
    plugin_files()
        .into_iter()
        .chain(std::iter::once(PathBuf::from(APPROVALS)))
        .map(|p| {
            let meta = std::fs::metadata(&p).ok();
            let len = meta.as_ref().map_or(0, |m| m.len());
            let mtime = meta.and_then(|m| m.modified().ok());
            (p, len, mtime)
        })
        .collect()
}

/// Polls the plugins dir and emits `PluginsChanged` after an edit settles. Polling (not
/// inotify/FSEvents) keeps it dependency-free and works on WSL's /mnt drives too.
pub async fn watch(events: mpsc::Sender<SessionEvent>) {
    let mut last = tokio::task::spawn_blocking(snapshot).await.unwrap_or_default();
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let Ok(now) = tokio::task::spawn_blocking(snapshot).await else { continue };
        if now != last {
            last = now;
            if events.send(SessionEvent::PluginsChanged).await.is_err() {
                return;
            }
        }
    }
}

/// Stores the env var names plugins asked for (`watchEnv`) where `daimon precmd` reads
/// them, so each prompt's context carries their values. Only rewritten on change.
pub fn set_context_env(names: &[String]) -> std::io::Result<()> {
    let dir = dirs::data_dir().ok_or(std::io::ErrorKind::NotFound)?.join("daimon");
    let path = dir.join("context-env");
    let mut names: Vec<&str> = names
        .iter()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
        .collect();
    names.sort_unstable();
    names.dedup();
    let content: String = names.iter().map(|n| format!("{n}\n")).collect();
    if std::fs::read_to_string(&path).ok().as_deref() == Some(content.as_str()) {
        return Ok(());
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&path, content)
}

/// Run `cmd args…` (no shell) and collect its output. Times out after `timeout_ms`.
/// `{ code, stdout, stderr }`; `code` is null when killed by a signal.
pub async fn exec(
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: std::collections::HashMap<String, String>,
    timeout_ms: u64,
) -> (bool, Value) {
    // Audit trail: every program a plugin runs.
    tracing::info!("plugin exec: {cmd}");
    let mut c = tokio::process::Command::new(&cmd);
    c.args(&args)
        .env("PATH", crate::shell_env::path())
        .envs(env)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        c.current_dir(dir);
    }
    match tokio::time::timeout(Duration::from_millis(timeout_ms), c.output()).await {
        Err(_) => (false, json!({ "error": format!("{cmd}: timed out after {timeout_ms} ms") })),
        Ok(Err(e)) => (false, json!({ "error": format!("{cmd}: {e}") })),
        Ok(Ok(out)) => (true, json!({
            "code": out.status.code(),
            "stdout": String::from_utf8_lossy(&out.stdout),
            "stderr": String::from_utf8_lossy(&out.stderr),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_flags_risky_code() {
        let ids = |src: &str| scan(src).iter().map(|f| f.id).collect::<Vec<_>>();
        assert!(ids("import { exec } from 'daimon'; exec('rm', ['-rf'])").contains(&"exec"));
        assert!(ids("fetch('https://x')").contains(&"network"));
        assert!(ids("eval(x)").contains(&"dynamic-code"));
        assert!(ids("sessionStorage.getItem('daimon-daemon')").contains(&"internals"));
        assert!(ids("const s = '\\x65\\x76\\x61\\x6c\\x28\\x29\\x3b\\x0a'").contains(&"obfuscation"));
        assert!(ids(&"a".repeat(2000)).contains(&"obfuscation"));
        assert!(ids("registerHeaderButton('x', () => null)").is_empty());
    }

    #[test]
    fn official_plugins_have_valid_names() {
        assert!(OFFICIAL.iter().all(|(n, src)| valid_name(n) && !src.is_empty()));
    }

    #[test]
    fn approvals_parse_strictly() {
        let h = "a".repeat(64);
        let got = parse_approvals(&format!("{h} good\n{h} bad'name\nshort x\n\n{h} also.ok-1\n"));
        assert_eq!(got, vec![(h.clone(), "good".into()), (h, "also.ok-1".into())]);
    }

    #[test]
    fn script_has_only_safe_values() {
        let s = approvals_script(&[("b".repeat(64), "k8s".into())]);
        assert!(s.contains(&format!("'{} k8s'", "b".repeat(64))));
        assert!(s.contains(APPROVALS));
        assert!(!valid_name("a'b") && !valid_name("a b") && !valid_name("") && valid_name("kube-ctl.v2"));
    }
}

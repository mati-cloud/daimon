//! The PATH for the commands the daemon runs itself (plugin exec, git, curl, …).
//!
//! Started from Finder/Dock or a desktop launcher, the daemon inherits the session's bare
//! PATH (macOS launchd: /usr/bin:/bin:/usr/sbin:/sbin), so it builds its own in two layers:
//!
//! 1. The OS's standard PATH sources, read from files — no shell, so it can't fail or hang:
//!    macOS `/etc/paths` + `/etc/paths.d/*` (what path_helper reads for login shells),
//!    Linux `/etc/environment` (pam_env) and `ENV_PATH` in `/etc/login.defs` (login(1)),
//!    the XDG user bin `~/.local/bin`, and the well-known system and package-manager dirs.
//! 2. What the user's shell config adds (asdf, krew, …), which only the shell knows. It's
//!    resolved in the background and goes in front once known; until then commands get
//!    layer 1.
//!
//! Commands get it explicitly through `path()`; the process environment stays untouched
//! (setting it while other threads run is a data race). Shells in the terminal get the
//! inherited PATH (`inherited_path`): they run their startup files themselves.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

/// Well-known bin dirs, added when present: system dirs, Homebrew (Apple silicon, Linux),
/// snap and Nix.
const WELL_KNOWN_DIRS: &[&str] = &[
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/home/linuxbrew/.linuxbrew/sbin",
    "/snap/bin",
    "/nix/var/nix/profiles/default/bin",
];

/// The shell runs in the background, so this only bounds a startup file that never
/// finishes (it's killed); nothing waits on it.
const SHELL_LIMIT: Duration = Duration::from_secs(60);

const MARKER: &str = "__DAIMON_PATH__";

static INHERITED: OnceLock<Option<OsString>> = OnceLock::new();
static PATH: RwLock<Option<OsString>> = RwLock::new(None);

/// Builds the standard PATH and starts resolving the shell's. Call once at startup.
pub fn init() {
    let inherited = std::env::var_os("PATH");
    INHERITED.get_or_init(|| inherited.clone());

    let base = merge(&[split(inherited.as_deref()), standard_dirs()]);
    tracing::info!("PATH: {}", base.to_string_lossy());
    *PATH.write().unwrap() = Some(base.clone());

    std::thread::spawn(move || {
        let Some(shell) = login_shell_path() else { return };
        let full = merge(&[split(Some(&shell)), split(Some(&base))]);
        tracing::info!("PATH with shell config: {}", full.to_string_lossy());
        *PATH.write().unwrap() = Some(full);
    });
}

/// The PATH to run commands with.
pub fn path() -> OsString {
    PATH.read().unwrap().clone().or_else(|| std::env::var_os("PATH")).unwrap_or_default()
}

/// The PATH the daemon was started with, to hand to the terminal's shells.
pub fn inherited_path() -> Option<&'static OsStr> {
    INHERITED.get()?.as_deref()
}

/// Layer 1: the OS's standard PATH sources, then well-known dirs. Only existing dirs.
fn standard_dirs() -> Vec<PathBuf> {
    let read = |p: &str| std::fs::read_to_string(p).unwrap_or_default();
    let mut dirs = Vec::new();
    if cfg!(target_os = "macos") {
        dirs.extend(paths_file(&read("/etc/paths")));
        let mut entries: Vec<PathBuf> = std::fs::read_dir("/etc/paths.d")
            .map(|d| d.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        entries.sort(); // path_helper's order
        for entry in entries {
            dirs.extend(paths_file(&std::fs::read_to_string(entry).unwrap_or_default()));
        }
    } else {
        dirs.extend(split(etc_environment_path(&read("/etc/environment")).map(OsStr::new)));
        dirs.extend(split(login_defs_path(&read("/etc/login.defs")).map(OsStr::new)));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/bin"));
    }
    dirs.extend(WELL_KNOWN_DIRS.iter().map(PathBuf::from));
    dirs.retain(|d| d.is_dir());
    dirs
}

/// `/etc/paths` format: one dir per line.
fn paths_file(text: &str) -> Vec<PathBuf> {
    text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(PathBuf::from).collect()
}

/// `PATH=…` from pam_env's `/etc/environment` (`KEY=VALUE`, value optionally quoted).
fn etc_environment_path(text: &str) -> Option<&str> {
    text.lines().find_map(|l| {
        let l = l.trim();
        let value = l.strip_prefix("export ").unwrap_or(l).strip_prefix("PATH=")?;
        Some(value.trim_matches(|c| c == '"' || c == '\''))
    })
}

/// `ENV_PATH PATH=…` (or `ENV_PATH …`) from `/etc/login.defs`.
fn login_defs_path(text: &str) -> Option<&str> {
    text.lines().find_map(|l| {
        let mut parts = l.split_whitespace();
        (parts.next()? == "ENV_PATH").then(|| parts.next())?
            .map(|v| v.strip_prefix("PATH=").unwrap_or(v))
    })
}

fn split(path: Option<&OsStr>) -> Vec<PathBuf> {
    path.map(|p| std::env::split_paths(p).filter(|d| !d.as_os_str().is_empty()).collect()).unwrap_or_default()
}

/// Joins dir lists in order, keeping each dir's first occurrence.
fn merge(lists: &[Vec<PathBuf>]) -> OsString {
    let mut seen: Vec<&Path> = Vec::new();
    for dir in lists.iter().flatten() {
        if !seen.contains(&dir.as_path()) {
            seen.push(dir);
        }
    }
    std::env::join_paths(seen).unwrap_or_default()
}

/// Layer 2: PATH as the user's login shell sets it up (interactive too, since many people
/// set PATH in ~/.zshrc or ~/.bashrc). The marker separates it from anything the startup
/// files print.
fn login_shell_path() -> Option<OsString> {
    let (shell, _) = crate::session::pick_shell();
    let mut cmd = Command::new(&shell);
    cmd.args(["-l", "-i", "-c", &format!("echo {MARKER}; command printenv PATH")])
        .env("DAIMON_RESOLVING_ENV", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // Its own session, without a terminal. An interactive shell that finds one (the
    // daemon run from a terminal, in the background) and isn't its foreground group
    // stops its process group with SIGTTIN — which would be the daemon's group.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setsid is async-signal-safe; nothing else runs between fork and exec.
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    let mut child = cmd
        .spawn()
        .map_err(|err| tracing::warn!("PATH: can't run {shell}: {err}"))
        .ok()?;

    // Read on another thread so a startup file that never finishes can be killed.
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = tx.send(out);
    });
    let out = rx.recv_timeout(SHELL_LIMIT);
    let _ = child.kill();
    let _ = child.wait();
    let path = out.ok().as_deref().and_then(parse).map(OsString::from);
    if path.is_none() {
        tracing::warn!("PATH: {shell} didn't report its PATH; commands use the standard PATH");
    }
    path
}

/// The line after the marker.
fn parse(out: &str) -> Option<&str> {
    let mut lines = out.lines().skip_while(|l| l.trim() != MARKER);
    lines.next()?;
    lines.next().map(str::trim).filter(|p| !p.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_path_after_startup_noise() {
        let out = "Welcome!\n__DAIMON_PATH__\n/opt/homebrew/bin:/usr/bin\n";
        assert_eq!(parse(out), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(parse("no marker\n"), None);
        assert_eq!(parse("__DAIMON_PATH__\n"), None);
    }

    #[test]
    fn reads_os_path_files() {
        assert_eq!(paths_file("/usr/local/bin\n# c\n\n/usr/bin\n"), [PathBuf::from("/usr/local/bin"), PathBuf::from("/usr/bin")]);
        assert_eq!(etc_environment_path("LANG=C\nPATH=\"/usr/local/sbin:/usr/bin\"\n"), Some("/usr/local/sbin:/usr/bin"));
        assert_eq!(etc_environment_path("LANG=C\n"), None);
        let defs = "ENV_SUPATH\tPATH=/usr/sbin:/sbin\nENV_PATH\tPATH=/usr/local/bin:/usr/bin\n";
        assert_eq!(login_defs_path(defs), Some("/usr/local/bin:/usr/bin"));
        assert_eq!(login_defs_path("ENV_PATH /usr/bin\n"), Some("/usr/bin"));
    }

    #[test]
    fn merge_keeps_first_occurrence() {
        let a = vec![PathBuf::from("/a"), PathBuf::from("/b")];
        let b = vec![PathBuf::from("/b"), PathBuf::from("/c")];
        assert_eq!(merge(&[a, b]), OsString::from("/a:/b:/c"));
    }
}

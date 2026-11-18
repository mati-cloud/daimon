//! Undo what the app's launcher puts in the environment for its bundled Chromium (CEF).
//!
//! On Linux, Electrobun's launcher starts the app with
//! `LD_PRELOAD=./libcef.so:./libvk_swiftshader.so` (paths relative to the app's `bin/`)
//! and `LD_LIBRARY_PATH=<app>/bin`. The daemon inherits them from the app, and every shell
//! and program in the terminal would too: the dynamic loader would inject Chromium into each
//! of them — loading it for real wherever such a file resolves (the app's `bin/`), and
//! printing "object './libcef.so' from LD_PRELOAD cannot be preloaded" everywhere else.
//! Removing them here, before any shell or command starts, means nothing is preloaded.
//! Only the entries pointing at the bundle are removed; the user's own stay.

use std::ffi::OsString;
use std::path::Path;

/// Libraries the launcher preloads for CEF.
const CEF_PRELOADS: &[&str] = &["libcef.so", "libvk_swiftshader.so"];

/// Call first thing in `main`, before any thread starts (it changes the environment).
pub fn scrub() {
    if let Some(v) = std::env::var_os("LD_PRELOAD") {
        // ld.so separates LD_PRELOAD entries with spaces or colons.
        let kept: Vec<String> = v
            .to_string_lossy()
            .split([' ', ':'])
            .filter(|e| !e.is_empty())
            .filter(|e| {
                let name = Path::new(e).file_name().and_then(|n| n.to_str()).unwrap_or("");
                !CEF_PRELOADS.contains(&name)
            })
            .map(String::from)
            .collect();
        set_or_remove("LD_PRELOAD", (!kept.is_empty()).then(|| kept.join(":").into()));
    }
    if let Some(v) = std::env::var_os("LD_LIBRARY_PATH") {
        // A directory holding libcef.so is the app bundle's bin/.
        let kept: Vec<_> = std::env::split_paths(&v)
            .filter(|d| !d.as_os_str().is_empty() && !d.join("libcef.so").is_file())
            .collect();
        let joined = std::env::join_paths(&kept).ok().filter(|j| !j.is_empty());
        set_or_remove("LD_LIBRARY_PATH", if kept.is_empty() { None } else { joined });
    }
}

fn set_or_remove(key: &str, value: Option<OsString>) {
    match value {
        Some(v) => std::env::set_var(key, v),
        None => std::env::remove_var(key),
    }
}

//! Locating daimon's zsh integration (OSC 133 hooks) and the CLI its hooks call.
//!
//! Release builds carry the integration files inside the binary and write them to the
//! user's data directory, since an installed app has no source checkout to read them
//! from. Debug builds use the checkout directly, so edits apply without a rebuild.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The files zsh loads from ZDOTDIR: `.zshrc` sources the user's own ~/.zshrc, then daimon.zsh.
const FILES: &[(&str, &str)] = &[
    (".zshrc", include_str!("../../../shell-integration/.zshrc")),
    ("daimon.zsh", include_str!("../../../shell-integration/daimon.zsh")),
];

/// Directory to use as ZDOTDIR, or None if it can't be set up (the shell then starts plain).
pub fn zdotdir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = if cfg!(debug_assertions) {
            checkout_dir().filter(|d| d.join(".zshrc").exists()).or_else(installed_dir)
        } else {
            installed_dir()
        };
        if dir.is_none() {
            tracing::warn!("shell integration unavailable: no writable data directory");
        }
        dir
    })
    .as_deref()
}

/// The daimon CLI the hooks run (`daimon precmd` / `preexec`), or None to fall back to
/// a `daimon` on PATH. `DAIMON_BIN` overrides it.
pub fn cli_bin() -> Option<&'static Path> {
    static BIN: OnceLock<Option<PathBuf>> = OnceLock::new();
    BIN.get_or_init(|| {
        if let Some(bin) = std::env::var_os("DAIMON_BIN") {
            return Some(bin.into());
        }
        // The app bundle ships it as `daimon-cli` next to pty-daemon; cargo builds it as
        // `daimon` in the same target directory.
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?;
        ["daimon-cli", "daimon"].iter().map(|name| dir.join(name)).find(|p| p.is_file())
    })
    .as_deref()
}

fn checkout_dir() -> Option<PathBuf> {
    Some(Path::new(env!("CARGO_MANIFEST_DIR")).parent()?.parent()?.join("shell-integration"))
}

/// Writes the embedded files to `<data dir>/daimon/shell-integration`, only rewriting
/// files whose content changed (so an upgrade refreshes them).
fn installed_dir() -> Option<PathBuf> {
    let dir = dirs::data_dir()?.join("daimon").join("shell-integration");
    if let Err(err) = write_files(&dir) {
        tracing::warn!("shell integration: can't write {}: {err}", dir.display());
        return None;
    }
    Some(dir)
}

fn write_files(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for (name, content) in FILES {
        let path = dir.join(name);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(*content) {
            std::fs::write(&path, content)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_refreshes_files() {
        let dir = std::env::temp_dir().join(format!("daimon-integration-{}", std::process::id()));
        write_files(&dir).unwrap();
        std::fs::write(dir.join("daimon.zsh"), "stale").unwrap();
        write_files(&dir).unwrap();
        for (name, content) in FILES {
            assert_eq!(std::fs::read_to_string(dir.join(name)).unwrap(), *content);
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

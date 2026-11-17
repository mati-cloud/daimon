//! Daimon's shell integration (OSC 133 hooks) for zsh, bash and fish: how each shell is
//! started so it loads them, and the CLI the hooks call. Other shells run without it.
//!
//! Release builds carry the integration files inside the binary and write them to the
//! user's data directory, since an installed app has no source checkout to read them
//! from. Debug builds use the checkout directly, so edits apply without a rebuild.

use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The integration directory's files. zsh loads the dotfiles from ZDOTDIR: each sources
/// the user's own copy from their real ZDOTDIR, and `.zshrc` then adds daimon.zsh.
const FILES: &[(&str, &str)] = &[
    (".zshenv", include_str!("../../../shell-integration/.zshenv")),
    (".zprofile", include_str!("../../../shell-integration/.zprofile")),
    (".zshrc", include_str!("../../../shell-integration/.zshrc")),
    (".zlogin", include_str!("../../../shell-integration/.zlogin")),
    ("daimon.zsh", include_str!("../../../shell-integration/daimon.zsh")),
    ("daimon.bash", include_str!("../../../shell-integration/daimon.bash")),
    ("fish/vendor_conf.d/daimon.fish", include_str!("../../../shell-integration/fish/vendor_conf.d/daimon.fish")),
];

/// A shell daimon has integration for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shell {
    Zsh,
    Bash,
    Fish,
}

impl Shell {
    /// The shell a path like `/opt/homebrew/bin/fish` runs, if daimon supports it.
    pub fn of(path: &str) -> Option<Self> {
        match Path::new(path).file_name()?.to_str()? {
            "zsh" => Some(Self::Zsh),
            "bash" => Some(Self::Bash),
            "fish" => Some(Self::Fish),
            _ => None,
        }
    }
}

/// Starts `cmd` (the shell) as a login shell, like Terminal.app/iTerm do, so it runs the
/// user's profile files: that's where Homebrew's `brew shellenv` and macOS's path_helper
/// set PATH. An app started from Finder/Dock otherwise only has launchd's bare PATH.
/// Also makes it load daimon's hooks, unless the integration files can't be written.
pub fn configure(cmd: &mut CommandBuilder, shell: Option<Shell>) {
    let dir = dir();
    match (shell, dir) {
        (Some(Shell::Zsh), Some(dir)) => {
            cmd.arg("-l");
            // The integration files source the user's startup files from their own ZDOTDIR.
            if let Some(user) = std::env::var_os("ZDOTDIR") {
                cmd.env("DAIMON_USER_ZDOTDIR", user);
            }
            cmd.env("ZDOTDIR", dir);
        }
        (Some(Shell::Bash), Some(dir)) => {
            // POSIX mode reads only $ENV; daimon.bash leaves it and runs the login files.
            cmd.arg("--posix");
            if let Some(user) = std::env::var_os("ENV") {
                cmd.env("DAIMON_USER_ENV", user);
            }
            cmd.env("ENV", dir.join("daimon.bash"));
        }
        (Some(Shell::Fish), Some(dir)) => {
            cmd.arg("-l");
            // fish loads `<dir>/fish/vendor_conf.d/*.fish` for each XDG_DATA_DIRS entry;
            // daimon.fish restores the original value.
            let user = std::env::var("XDG_DATA_DIRS").ok().filter(|v| !v.is_empty());
            if let Some(user) = &user {
                cmd.env("DAIMON_USER_XDG_DATA_DIRS", user);
            }
            // Unset means these defaults; setting it drops them unless listed.
            let rest = user.as_deref().unwrap_or("/usr/local/share:/usr/share");
            cmd.env("XDG_DATA_DIRS", format!("{}:{rest}", dir.display()));
        }
        // No integration: still a login shell. `-l` is understood by zsh, bash and fish.
        (Some(_), None) => {
            cmd.arg("-l");
        }
        (None, _) => {}
    }
    if dir.is_some() && shell.is_some() {
        if let Some(bin) = cli_bin() {
            cmd.env("DAIMON_BIN", bin);
        }
    }
}

/// The integration directory, or None if it can't be set up (the shell then starts plain).
fn dir() -> Option<&'static Path> {
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
fn cli_bin() -> Option<&'static Path> {
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
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
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

use crate::registry::global;
use crate::spec::ArgKind;
use crate::tokenize::tokenize;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct Suggestion {
    pub text: String,
    pub description: Option<String>,
    pub kind: SuggestionKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionKind {
    Subcommand,
    Flag,
    File,
    Dir,
    GitBranch,
    GitTag,
    GitRemote,
    Choice,
    History,
}

/// A folder's entries as another machine reported them (name, is a folder) — an ssh
/// session's remote cwd, which this machine's disk doesn't have.
pub type Listing = [(String, bool)];

/// Main entry point — given a buffer and cwd, return completions.
pub fn complete(buffer: &str, cwd: &str) -> Vec<Suggestion> {
    complete_with(buffer, cwd, None)
}

/// `complete`, for a shell on another machine when `remote` is given: paths come from that
/// listing of `cwd` (only `cwd` itself is known), and nothing reads this machine's disk or git.
pub fn complete_with(buffer: &str, cwd: &str, remote: Option<&Listing>) -> Vec<Suggestion> {
    let cursor = buffer.len();
    let (words, idx, partial) = tokenize(buffer, cursor);

    if words.is_empty() && partial.is_empty() {
        return vec![];
    }

    let cmd = if idx == 0 { &partial } else { &words[0] };
    if idx == 0 {
        // Completing the command name itself — no spec needed
        return filesystem_completions(&partial, cwd, true, remote);
    }

    let Some(spec) = global().get(cmd) else {
        // No spec — fall back to filesystem
        return filesystem_completions(&partial, cwd, false, remote);
    };

    // Walk subcommand tree
    let mut subcommands = &spec.subcommands;
    let mut flags = &spec.flags;
    let mut args = &spec.args;
    let mut sub_depth = 1usize;

    while sub_depth < idx {
        let word = &words[sub_depth];
        if let Some(sub) = subcommands.iter().find(|s| &s.name == word || s.aliases.contains(word)) {
            subcommands = &sub.subcommands;
            flags = &sub.flags;
            args = &sub.args;
            sub_depth += 1;
        } else {
            break;
        }
    }

    let mut out = Vec::new();

    // If partial starts with '-', complete flags
    if partial.starts_with('-') {
        for f in flags {
            if f.name.starts_with(&partial) {
                out.push(Suggestion { text: f.name.clone(), description: f.description.clone(), kind: SuggestionKind::Flag });
            }
            if let Some(short) = &f.short {
                if short.starts_with(&partial) {
                    out.push(Suggestion { text: short.clone(), description: f.description.clone(), kind: SuggestionKind::Flag });
                }
            }
        }
        return out;
    }

    // Subcommand completions at the right depth
    if sub_depth == idx {
        for s in subcommands {
            if s.name.starts_with(&partial) {
                out.push(Suggestion { text: s.name.clone(), description: s.description.clone(), kind: SuggestionKind::Subcommand });
            }
        }
        if !out.is_empty() { return out; }
    }

    // Arg completions based on arg kind
    let arg_pos = idx.saturating_sub(sub_depth);
    let arg = args.get(arg_pos)
        .or_else(|| args.last().filter(|a| matches!(a.kind, ArgKind::Rest)));

    if let Some(arg) = arg {
        return complete_arg(&arg.kind, &partial, cwd, remote);
    }

    // Last resort: filesystem
    filesystem_completions(&partial, cwd, false, remote)
}

fn complete_arg(kind: &ArgKind, partial: &str, cwd: &str, remote: Option<&Listing>) -> Vec<Suggestion> {
    match kind {
        ArgKind::File | ArgKind::Rest => filesystem_completions(partial, cwd, false, remote),
        ArgKind::Dir                  => filesystem_completions(partial, cwd, true, remote),
        // The repository is on the other machine: this one's git would answer for the wrong one.
        ArgKind::GitBranch | ArgKind::GitTag | ArgKind::GitRemote | ArgKind::GitDirty if remote.is_some() => vec![],
        ArgKind::Choice { choices }   => choices.iter()
            .filter(|c| c.starts_with(partial))
            .map(|c| Suggestion { text: c.clone(), description: None, kind: SuggestionKind::Choice })
            .collect(),
        ArgKind::GitBranch  => git_refs(partial, cwd, GitRefKind::Branch),
        ArgKind::GitTag     => git_refs(partial, cwd, GitRefKind::Tag),
        ArgKind::GitRemote  => git_refs(partial, cwd, GitRefKind::Remote),
        ArgKind::GitDirty   => git_dirty(partial, cwd),
        ArgKind::String     => vec![],
    }
}

/// `~` / `~/…` → the home directory, for reading the disk; suggestions keep what was typed.
fn expand_tilde(path: &str) -> std::path::PathBuf {
    let home = || std::env::var_os("HOME").map(std::path::PathBuf::from);
    match path.strip_prefix('~') {
        Some("") => home().unwrap_or_else(|| path.into()),
        Some(rest) if rest.starts_with('/') => home().map_or_else(|| path.into(), |h| h.join(&rest[1..])),
        _ => path.into(),
    }
}

/// Files and folders matching the path being typed. The typed path is split into the
/// folder to list (everything up to the last `/`, `~` expanded, relative to `cwd`) and
/// the name prefix after it; `foo/` lists inside `foo`. Folders end in `/` (symlinks to
/// folders too), so accepting one keeps completing inside it. Hidden entries are listed
/// too, after the others.
fn filesystem_completions(partial: &str, cwd: &str, dirs_only: bool, remote: Option<&Listing>) -> Vec<Suggestion> {
    let (typed_dir, prefix) = match partial.rfind('/') {
        Some(i) => (&partial[..=i], &partial[i + 1..]),
        // `~` alone: complete it to the home folder.
        None if partial == "~" => ("", "~"),
        None => ("", partial),
    };
    if prefix == "~" && typed_dir.is_empty() {
        return vec![Suggestion { text: "~/".into(), description: None, kind: SuggestionKind::Dir }];
    }
    if let Some(entries) = remote {
        // Only the remote cwd is known; a path into another folder has nothing to offer.
        if !typed_dir.is_empty() {
            return vec![];
        }
        let out = entries
            .iter()
            .filter(|(name, is_dir)| name.starts_with(prefix) && (*is_dir || !dirs_only))
            .map(|(name, is_dir)| (*is_dir, name.clone()))
            .collect();
        return ranked(out, typed_dir);
    }
    let dir = expand_tilde(typed_dir);
    let base = if typed_dir.is_empty() { Path::new(cwd).to_path_buf() } else if dir.is_absolute() { dir } else { Path::new(cwd).join(dir) };
    if !base.is_dir() {
        return vec![];
    }
    let Ok(entries) = std::fs::read_dir(&base) else { return vec![] };

    let out: Vec<(bool, String)> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            if !name.starts_with(prefix) {
                return None;
            }
            // metadata() follows symlinks: a link to a folder completes like a folder.
            let is_dir = std::fs::metadata(e.path()).map(|m| m.is_dir()).unwrap_or(false);
            if dirs_only && !is_dir {
                return None;
            }
            Some((is_dir, name))
        })
        .collect();
    ranked(out, typed_dir)
}

/// Visible entries first, then hidden ones, each by name; folders end in `/`.
fn ranked(mut out: Vec<(bool, String)>, typed_dir: &str) -> Vec<Suggestion> {
    out.sort_by(|a, b| (a.1.starts_with('.'), &a.1).cmp(&(b.1.starts_with('.'), &b.1)));
    out.into_iter()
        .take(50)
        .map(|(is_dir, name)| Suggestion {
            text: format!("{typed_dir}{name}{}", if is_dir { "/" } else { "" }),
            description: None,
            kind: if is_dir { SuggestionKind::Dir } else { SuggestionKind::File },
        })
        .collect()
}

#[cfg(test)]
mod fs_tests {
    use super::*;

    fn texts(partial: &str, cwd: &str) -> Vec<String> {
        filesystem_completions(partial, cwd, false, None).into_iter().map(|s| s.text).collect()
    }

    #[test]
    fn completes_from_a_remote_listing_only() {
        let remote = vec![("gitlab.mati.cloud".to_string(), true), ("notes.txt".to_string(), false), (".env".to_string(), false)];
        let texts = |b: &str| complete_with(b, "/srv", Some(&remote)).into_iter().map(|s| s.text).collect::<Vec<_>>();
        assert_eq!(texts("cd gi"), ["gitlab.mati.cloud/"]);
        assert_eq!(texts("cat "), ["gitlab.mati.cloud/", "notes.txt", ".env"]);
        // Only the remote cwd is known: nothing from this machine's disk.
        assert!(texts("cat /etc/").is_empty());
    }

    #[test]
    fn completes_relative_absolute_and_home_paths() {
        let root = std::env::temp_dir().join(format!("daimon-complete-{}", std::process::id()));
        std::fs::create_dir_all(root.join("sub/inner")).unwrap();
        std::fs::write(root.join("sub/file.txt"), "").unwrap();
        std::fs::write(root.join("sub/.hidden"), "").unwrap();
        let cwd = root.to_str().unwrap();

        assert_eq!(texts("sub/", cwd), ["sub/file.txt", "sub/inner/", "sub/.hidden"]);
        assert_eq!(texts("sub/i", cwd), ["sub/inner/"]);
        assert_eq!(texts("sub/.h", cwd), ["sub/.hidden"]);
        assert_eq!(texts("su", cwd), ["sub/"]);
        assert_eq!(texts(&format!("{cwd}/sub/f"), "/"), [format!("{cwd}/sub/file.txt")]);
        assert!(texts("missing/", cwd).is_empty());
        assert!(texts("sub/file.txt/", cwd).is_empty()); // a file isn't listed into

        // ~ expands for reading but stays as typed in the suggestion.
        std::env::set_var("HOME", &root);
        assert_eq!(texts("~/sub/.h", "/"), ["~/sub/.hidden"]);
        assert_eq!(texts("~/s", "/"), ["~/sub/"]);
        assert_eq!(texts("~", "/"), ["~/"]);
        std::fs::remove_dir_all(&root).unwrap();
    }
}

enum GitRefKind { Branch, Tag, Remote }

fn git_refs(partial: &str, cwd: &str, kind: GitRefKind) -> Vec<Suggestion> {
    let Ok(repo) = git2::Repository::discover(cwd) else { return vec![] };
    let mut out = Vec::new();
    match kind {
        GitRefKind::Branch => {
            let Ok(branches) = repo.branches(Some(git2::BranchType::Local)) else { return vec![] };
            for b in branches.flatten() {
                if let Some(name) = b.0.name().ok().flatten() {
                    if name.starts_with(partial) {
                        out.push(Suggestion { text: name.to_string(), description: None, kind: SuggestionKind::GitBranch });
                    }
                }
            }
        }
        GitRefKind::Tag => {
            let Ok(tags) = repo.tag_names(None) else { return vec![] };
            for tag in tags.iter().flatten() {
                if tag.starts_with(partial) {
                    out.push(Suggestion { text: tag.to_string(), description: None, kind: SuggestionKind::GitTag });
                }
            }
        }
        GitRefKind::Remote => {
            let Ok(remotes) = repo.remotes() else { return vec![] };
            for r in remotes.iter().flatten() {
                if r.starts_with(partial) {
                    out.push(Suggestion { text: r.to_string(), description: None, kind: SuggestionKind::GitRemote });
                }
            }
        }
    }
    out
}

fn git_dirty(partial: &str, cwd: &str) -> Vec<Suggestion> {
    let Ok(repo) = git2::Repository::discover(cwd) else { return vec![] };
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false)  // collapse untracked dirs, don't explode into files
        .exclude_submodules(true);
    let Ok(statuses) = repo.statuses(Some(&mut opts)) else { return vec![] };
    let mut out = Vec::new();
    for entry in statuses.iter() {
        let s = entry.status();
        let is_modified = s.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED,
        );
        let is_untracked = s.contains(git2::Status::WT_NEW);
        if !is_modified && !is_untracked { continue; }
        let Some(path) = entry.path() else { continue };
        if !path.starts_with(partial) { continue; }
        // Modified files get File kind; untracked entries may be dirs — use Dir kind for those
        let kind = if is_untracked && path.ends_with('/') {
            SuggestionKind::Dir
        } else {
            SuggestionKind::File
        };
        out.push(Suggestion { text: path.to_string(), description: None, kind });
    }
    out
}

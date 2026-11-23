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

    complete_against(spec, &words, idx, &partial, cwd, remote)
}

/// Spec-dependent completion: walk the subcommand tree and suggest subcommands/flags/args for
/// the token at `idx`. Split out from `complete_with` so a spec can be supplied directly in tests.
fn complete_against(spec: &crate::spec::Spec, words: &[String], idx: usize, partial: &str, cwd: &str, remote: Option<&Listing>) -> Vec<Suggestion> {
    // Walk subcommand tree, accumulating flags from every level (parent flags stay in scope).
    let mut subcommands = &spec.subcommands;
    let mut all_flags: Vec<&crate::spec::Flag> = spec.flags.iter().collect();
    let mut args = &spec.args;
    let mut sub_source = &spec.subcommand_source;
    let mut no_fallback = spec.no_file_fallback;
    let mut sub_depth = 1usize;

    while sub_depth < idx {
        let word = &words[sub_depth];
        if let Some(sub) = subcommands.iter().find(|s| &s.name == word || s.aliases.contains(word)) {
            subcommands = &sub.subcommands;
            all_flags.extend(sub.flags.iter());
            args = &sub.args;
            sub_source = &sub.subcommand_source;
            no_fallback = sub.no_file_fallback;
            sub_depth += 1;
        } else {
            break;
        }
    }

    let flags = all_flags;
    let mut out: Vec<Suggestion> = Vec::new();

    // If partial starts with '-', complete flags
    if partial.starts_with('-') {
        for f in &flags {
            if f.name.starts_with(partial) {
                out.push(Suggestion { text: f.name.clone(), description: f.description.clone(), kind: SuggestionKind::Flag });
            }
            if let Some(short) = &f.short {
                if short.starts_with(partial) {
                    out.push(Suggestion { text: short.clone(), description: f.description.clone(), kind: SuggestionKind::Flag });
                }
            }
        }
        return out;
    }

    // Subcommand completions at the right depth. A tool whose first positional is itself
    // completable (and that also accepts subcommands at this position) merges those arg
    // suggestions in, so position 1 offers subcommands ∪ args, like the tool itself.
    if sub_depth == idx {
        for s in subcommands {
            if s.name.starts_with(partial) {
                out.push(Suggestion { text: s.name.clone(), description: s.description.clone(), kind: SuggestionKind::Subcommand });
            }
        }
        // Dynamic subcommands from a completer command (e.g. git config aliases). Skipped for
        // remote shells: the command would run against this machine, not the remote one.
        // Dedup against static names and each other — git config lists an alias once per scope
        // (repo + global), so the same name can arrive twice.
        if let (Some(command), None) = (sub_source, remote) {
            for (text, description) in command_rows(command, "lines", partial, cwd) {
                if out.iter().all(|s| s.text != text) {
                    out.push(Suggestion { text, description, kind: SuggestionKind::Subcommand });
                }
            }
        }
        if !out.is_empty() {
            if let Some(arg) = args.first() {
                out.extend(complete_arg(&arg.kind, partial, cwd, remote));
            }
            return out;
        }
    }

    // If the previous token is a flag that takes a value, complete that value.
    if idx > 0 {
        let prev = &words[idx - 1];
        if let Some(flag) = flags.iter().find(|f| &f.name == prev || f.short.as_ref() == Some(prev)) {
            if let Some(arg_kind) = &flag.arg {
                return complete_arg(arg_kind, partial, cwd, remote);
            }
        }
    }

    // Arg completions based on arg kind
    let arg_pos = idx.saturating_sub(sub_depth);
    let arg = args.get(arg_pos)
        .or_else(|| args.last().filter(|a| matches!(a.kind, ArgKind::Rest)));

    if let Some(arg) = arg {
        return complete_arg(&arg.kind, partial, cwd, remote);
    }

    // No declared arg covers this position. A tool that takes no file args suppresses the
    // filesystem fallback so the prompt doesn't list the cwd.
    if no_fallback {
        return vec![];
    }
    // Last resort: filesystem
    filesystem_completions(partial, cwd, false, remote)
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
        // Can't run a completer command for a shell on another machine.
        ArgKind::Command { .. } if remote.is_some() => vec![],
        ArgKind::Command { command, split } => command_choices(command, split, partial, cwd),
        ArgKind::GitBranch  => git_refs(partial, cwd, GitRefKind::Branch),
        ArgKind::GitTag     => git_refs(partial, cwd, GitRefKind::Tag),
        ArgKind::GitRemote  => git_refs(partial, cwd, GitRefKind::Remote),
        ArgKind::GitDirty   => git_dirty(partial, cwd),
        ArgKind::String     => vec![],
    }
}

/// Run a user-declared completer command in `cwd`, split stdout, filter by `partial`.
/// Killed after ~1s so a slow/hung completer can't stall completion. Output capped.
fn command_choices(command: &[String], split: &str, partial: &str, cwd: &str) -> Vec<Suggestion> {
    command_rows(command, split, partial, cwd)
        .into_iter()
        .map(|(text, description)| Suggestion { text, description, kind: SuggestionKind::Choice })
        .collect()
}

/// Spawn a completer command, parse its stdout into `(value, description)` rows filtered by
/// `partial`. Shared by arg-value completion (`Choice`) and dynamic subcommands (`Subcommand`).
fn command_rows(command: &[String], split: &str, partial: &str, cwd: &str) -> Vec<(String, Option<String>)> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let Some((prog, args)) = command.split_first() else { return vec![] };
    let Ok(mut child) = Command::new(prog)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return vec![];
    };

    let deadline = Instant::now() + Duration::from_millis(1000);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return vec![];
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return vec![],
        }
    }

    let Ok(out) = child.wait_with_output() else { return vec![] };
    let raw = if out.stdout.len() > 1 << 20 { &out.stdout[..1 << 20] } else { &out.stdout[..] }; // cap 1 MiB
    let text = String::from_utf8_lossy(raw);

    // whitespace: each token is a value. lines: each line is `value` or `value<TAB>description`,
    // so a completer can annotate its choices (shown inline like subcommand descriptions).
    let rows: Vec<(&str, Option<&str>)> = if split == "lines" {
        text.lines()
            .map(|l| match l.split_once('\t') {
                Some((v, d)) => (v.trim(), Some(d.trim())),
                None => (l.trim(), None),
            })
            .collect()
    } else {
        text.split_whitespace().map(|v| (v, None)).collect()
    };
    rows.into_iter()
        .filter(|(v, _)| !v.is_empty() && v.starts_with(partial))
        .map(|(v, d)| (v.to_string(), d.filter(|s| !s.is_empty()).map(str::to_string)))
        .collect()
}


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
        let prev_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &root);
        assert_eq!(texts("~/sub/.h", "/"), ["~/sub/.hidden"]);
        assert_eq!(texts("~/s", "/"), ["~/sub/"]);
        assert_eq!(texts("~", "/"), ["~/"]);
        // restore so later tests that shell out to git don't inherit a removed HOME
        match prev_home { Some(h) => std::env::set_var("HOME", h), None => std::env::remove_var("HOME") }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn command_choices_runs_splits_and_filters() {
        let out = command_choices(
            &["printf".into(), "na-us-1 ap-jp-2 eu-nl-1".into()],
            "whitespace",
            "ap",
            "/tmp",
        );
        assert_eq!(out.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(), ["ap-jp-2"]);
        assert!(matches!(out[0].kind, SuggestionKind::Choice));

        // lines split reads an optional tab-separated description per line
        let out = command_choices(
            &["printf".into(), "eu-de-1\\tFrankfurt\\neu-nl-1\\tAmsterdam\\n".into()],
            "lines",
            "eu",
            "/tmp",
        );
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].text, "eu-de-1");
        assert_eq!(out[0].description.as_deref(), Some("Frankfurt"));
        assert_eq!(out[1].description.as_deref(), Some("Amsterdam"));

        // missing binary yields nothing, never panics
        assert!(command_choices(&["definitely-not-a-binary-xyz".into()], "whitespace", "", "/tmp").is_empty());
    }

    #[test]
    fn git_aliases_surface_as_deduped_subcommands() {
        let root = std::env::temp_dir().join(format!("daimon-gitalias-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let repo = git2::Repository::init(&root).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("alias.ai-commit", "!git-ai-commit").unwrap();
        let cwd = root.to_str().unwrap();

        // The formatter the git spec uses, driven directly so the test is independent of the
        // real user's ~/.gitconfig (which git config --get-regexp would otherwise also read).
        let src = vec![
            "sh".to_string(),
            "-c".to_string(),
            // --local: only this repo's config, so the result is deterministic in CI.
            r"git config --local --get-regexp '^alias\.' | sed 's/^alias\.//;s/ /\tAlias for /'".to_string(),
        ];
        let rows = command_rows(&src, "lines", "ai", cwd);
        assert_eq!(rows, vec![("ai-commit".to_string(), Some("Alias for !git-ai-commit".to_string()))]);
        assert!(command_rows(&src, "lines", "zz", cwd).is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn dynamic_subcommands_merge_and_dedup() {
        // Engine-level: static subcommand + a generator that emits one new and one duplicate
        // name. Result merges them and drops the dup, keeping the static entry's description.
        use crate::spec::{Spec, Subcommand};
        let spec = Spec {
            name: "demo".into(),
            description: None,
            subcommands: vec![Subcommand {
                name: "build".into(), description: Some("static".into()), aliases: vec![],
                subcommands: vec![], flags: vec![], args: vec![], subcommand_source: None, no_file_fallback: false,
            }],
            flags: vec![], args: vec![],
            // emits `build` (dup of static) and `deploy` (new), tab-annotated
            subcommand_source: Some(vec![
                "printf".into(), r"build\tgen\ndeploy\tgenerated\n".into(),
            ]),
            no_file_fallback: false,
        };
        let (words, idx, partial) = crate::tokenize::tokenize("demo ", 5);
        let out = complete_against(&spec, &words, idx, &partial, "/tmp", None);
        let texts: Vec<_> = out.iter().map(|s| s.text.as_str()).collect();
        assert!(texts.contains(&"deploy"), "generated subcommand missing: {texts:?}");
        assert_eq!(texts.iter().filter(|t| **t == "build").count(), 1, "build not deduped: {texts:?}");
        // static description wins over the generator's for the duplicate
        assert_eq!(out.iter().find(|s| s.text == "build").unwrap().description.as_deref(), Some("static"));
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

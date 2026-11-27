/// Emits OSC 133 prompt mark with context JSON.
/// Called on every precmd — must be fast.
/// Git info is fetched asynchronously by the daemon after this exits; env vars that
/// plugins asked for (`watchEnv`) are included directly since they're just env reads.
pub fn run() -> anyhow::Result<()> {
    let pwd = std::env::var("PWD").unwrap_or_else(|_| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    });

    let exit_code: i32 = std::env::var("DAIMON_EXIT_CODE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let mut obj = serde_json::Map::new();
    obj.insert("pwd".into(),        serde_json::Value::String(pwd));
    obj.insert("exitCode".into(),   serde_json::Value::Number(exit_code.into()));
    // Signal the daemon to fetch git info and push a GitContext event.
    obj.insert("gitPending".into(), serde_json::Value::Bool(true));

    // Env vars plugins asked for (`watchEnv`), e.g. KUBECONFIG or OS_REGION_NAME: only
    // the shell has them, and only the requested ones leave it.
    let env: serde_json::Map<String, serde_json::Value> = watched_env_names()
        .into_iter()
        .filter_map(|name| std::env::var(&name).ok().map(|v| (name, v.into())))
        .collect();
    obj.insert("env".into(), serde_json::Value::Object(env));

    let json = serde_json::Value::Object(obj).to_string();
    // OSC 133 ; A — prompt start, with daimon context payload
    print!("\x1b]133;A{json}\x1b\\");
    Ok(())
}

pub struct GitInfo {
    branch: String,
    dirty: bool,
    ahead: u32,
    behind: u32,
    added: usize,
    removed: usize,
}

/// Names in the file the daemon keeps from the plugins' `watchEnv` calls, one per line.
pub(crate) fn watched_env_names() -> Vec<String> {
    let Some(path) = dirs::data_dir().map(|d| d.join("daimon/context-env")) else { return vec![] };
    std::fs::read_to_string(path)
        .map(|s| s.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
        .unwrap_or_default()
}

pub fn git_info_pub(path: &str) -> Option<GitInfo> { git_info(path) }

/// Git status via the `git` CLI rather than libgit2.
///
/// On large repos (multi-GB .git, big worktrees) libgit2's status/diff take seconds because it
/// has no fsmonitor support and ignores the index's untracked-cache — it always stat()s the whole
/// worktree. The `git` CLI reuses fsmonitor + untracked-cache + commit-graph, so the same query is
/// sub-second. precmd runs on every prompt, so speed here is the whole game.
///
/// One `git status --porcelain=v2 --branch` gives branch + ahead/behind + tracked dirty in a single
/// process; `--no-optional-locks` avoids touching the index lock from a background prompt.
/// Whether `path` may be inside a git repository: a `.git` (directory, or file for worktrees
/// and submodules) in it or above. Starting git just to learn "not a repository" costs a
/// process start on every prompt; GIT_DIR can point anywhere, so then git is asked.
fn maybe_repo(path: &str) -> bool {
    if std::env::var_os("GIT_DIR").is_some() { return true; }
    let mut dir = Some(std::path::Path::new(path));
    while let Some(d) = dir {
        if d.join(".git").exists() { return true; }
        dir = d.parent();
    }
    false
}

fn git_info(path: &str) -> Option<GitInfo> {
    use std::process::{Command, Stdio};

    if !maybe_repo(path) { return None; }
    // The line counts run alongside status; they're only used if status finds changes.
    let numstat = Command::new("git")
        .args(["-C", path, "--no-optional-locks", "diff", "--numstat", "HEAD"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok();
    let status = Command::new("git")
        .args(["-C", path, "--no-optional-locks", "status", "--porcelain=v2", "--branch", "--untracked-files=no"])
        .output()
        .ok()?;
    if !status.status.success() { return None; } // not a repo
    let text = String::from_utf8_lossy(&status.stdout);

    let mut branch = String::from("HEAD");
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut dirty = false;
    for line in text.lines() {
        if let Some(h) = line.strip_prefix("# branch.head ") {
            if h != "(detached)" { branch = h.to_string(); }
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            // format: "+<ahead> -<behind>"
            let mut it = ab.split_whitespace();
            ahead = it.next().and_then(|s| s.strip_prefix('+')).and_then(|s| s.parse().ok()).unwrap_or(0);
            behind = it.next().and_then(|s| s.strip_prefix('-')).and_then(|s| s.parse().ok()).unwrap_or(0);
        } else if line.starts_with('1') || line.starts_with('2') || line.starts_with('u') {
            // changed (1), renamed/copied (2), or unmerged (u) tracked entry → dirty
            dirty = true;
        }
    }
    // detached HEAD → short sha
    if branch == "HEAD" {
        if let Ok(o) = Command::new("git").args(["-C", path, "rev-parse", "--short", "HEAD"]).output() {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !s.is_empty() { branch = s; }
            }
        }
    }

    // No tracked changes (status lists them all, staged or not): nothing to count.
    let numstat = numstat.and_then(|c| c.wait_with_output().ok());
    let (added, removed) = if dirty { diff_line_counts(numstat) } else { (0, 0) };
    Some(GitInfo { branch, dirty, ahead, behind, added, removed })
}

/// Insertions/deletions of TRACKED changes (worktree + index) vs HEAD, via `git diff --numstat`.
/// Untracked files are excluded (new files aren't "diff lines", and skipping them keeps the walk
/// cheap). Binary files report "-\t-\t<path>" in numstat and are ignored.
fn diff_line_counts(out: Option<std::process::Output>) -> (usize, usize) {
    let out = match out {
        Some(o) if o.status.success() => o.stdout,
        _ => return (0, 0),
    };
    let text = String::from_utf8_lossy(&out);
    let mut added = 0usize;
    let mut removed = 0usize;
    for line in text.lines() {
        let mut cols = line.split('\t');
        let a = cols.next().unwrap_or("");
        let r = cols.next().unwrap_or("");
        if let Ok(n) = a.parse::<usize>() { added += n; }
        if let Ok(n) = r.parse::<usize>() { removed += n; }
    }
    (added, removed)
}


/// Git context fetch for the async statusline push.
/// Same logic as daimon-cli precmd's git_info, run by the daemon after prompt fires.

pub fn git_context(path: &str) -> Option<serde_json::Value> {
    use std::process::{Command, Stdio};

    if !maybe_repo(path) { return None; }

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
    if !status.status.success() { return None; }
    let text = String::from_utf8_lossy(&status.stdout);

    let mut branch = String::from("HEAD");
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut dirty = false;
    for line in text.lines() {
        if let Some(h) = line.strip_prefix("# branch.head ") {
            if h != "(detached)" { branch = h.to_string(); }
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            let mut it = ab.split_whitespace();
            ahead  = it.next().and_then(|s| s.strip_prefix('+')).and_then(|s| s.parse().ok()).unwrap_or(0);
            behind = it.next().and_then(|s| s.strip_prefix('-')).and_then(|s| s.parse().ok()).unwrap_or(0);
        } else if line.starts_with('1') || line.starts_with('2') || line.starts_with('u') {
            dirty = true;
        }
    }
    if branch == "HEAD" {
        if let Ok(o) = Command::new("git").args(["-C", path, "rev-parse", "--short", "HEAD"]).output() {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !s.is_empty() { branch = s; }
            }
        }
    }

    let numstat = numstat.and_then(|c| c.wait_with_output().ok());
    let (added, removed) = if dirty { diff_line_counts(numstat) } else { (0, 0) };

    Some(serde_json::json!({
        "gitBranch":  branch,
        "gitDirty":   dirty,
        "gitAhead":   ahead,
        "gitBehind":  behind,
        "gitAdded":   added,
        "gitRemoved": removed,
    }))
}

fn maybe_repo(path: &str) -> bool {
    if std::env::var_os("GIT_DIR").is_some() { return true; }
    let mut dir = Some(std::path::Path::new(path));
    while let Some(d) = dir {
        if d.join(".git").exists() { return true; }
        dir = d.parent();
    }
    false
}

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

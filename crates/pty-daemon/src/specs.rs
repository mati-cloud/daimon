//! Declarative output specs: JSON files in ~/.config/daimon/specs/ that tell the UI how to
//! render a known command's plaintext output (e.g. `df` as a table). Unlike plugins,
//! a spec is data only — it describes a match + a transform into an existing block shape, runs
//! no code, so there is no approval gate, scan or sandbox. The UI parses and applies them.

use crate::session::SessionEvent;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tokio::sync::mpsc;

pub fn specs_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config/daimon/specs"))
}

/// Spec files (`*.json`), sorted. Dotfiles are skipped.
fn spec_files() -> Vec<PathBuf> {
    let Some(dir) = specs_dir() else { return vec![] };
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![] };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or_default();
            p.is_file() && ext == "json" && !name.starts_with('.')
        })
        .collect();
    files.sort();
    files
}

/// Specs that ship with daimon: an unmodified copy of one of these is the built-in example.
const BUILTIN: &[(&str, &str)] = &[("df", include_str!("../../../specs/df.json"))];

/// `[{ name, file, source }]`, user specs first then any built-ins not shadowed by a user file
/// of the same name. `source` is the raw JSON; the UI parses and validates it.
pub fn list() -> Value {
    let mut specs: Vec<Value> = vec![];
    let mut names: Vec<String> = vec![];
    for p in spec_files() {
        match std::fs::read_to_string(&p) {
            Ok(source) => {
                let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
                let file = p.file_name().and_then(|s| s.to_str()).unwrap_or_default().to_string();
                names.push(name.clone());
                specs.push(json!({ "name": name, "file": file, "source": source }));
            }
            Err(e) => tracing::warn!("spec {}: {}", p.display(), e),
        }
    }
    for (name, source) in BUILTIN {
        if !names.iter().any(|n| n == name) {
            specs.push(json!({ "name": name, "file": format!("{name}.json"), "source": *source }));
        }
    }
    Value::Array(specs)
}

/// Name, size and mtime of every spec file: cheap, changes on any edit.
fn snapshot() -> Vec<(PathBuf, u64, Option<SystemTime>)> {
    spec_files()
        .into_iter()
        .map(|p| {
            let meta = std::fs::metadata(&p).ok();
            let len = meta.as_ref().map_or(0, |m| m.len());
            let mtime = meta.and_then(|m| m.modified().ok());
            (p, len, mtime)
        })
        .collect()
}

/// Polls the specs dir and emits `SpecsChanged` after an edit settles (same polling approach
/// as `plugins::watch`, for the same dependency-free / WSL reasons).
pub async fn watch(events: mpsc::Sender<SessionEvent>) {
    let mut last = tokio::task::spawn_blocking(snapshot).await.unwrap_or_default();
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let Ok(now) = tokio::task::spawn_blocking(snapshot).await else { continue };
        if now != last {
            last = now;
            if events.send(SessionEvent::SpecsChanged).await.is_err() {
                return;
            }
        }
    }
}

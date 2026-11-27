use daimon_complete::{complete_with, Listing};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct CompletionItem {
    pub text: String,
    pub description: Option<String>,
    pub kind: String,
}

/// `remote`: an ssh session's remote folder listing (session.rs), used instead of this disk.
/// `cd_hist`: recent `cd`/`pushd` command strings from history (most-recent first).
pub fn complete(buffer: &str, cwd: &str, remote: Option<&Listing>, cd_hist: &[String]) -> Value {
    let suggestions = complete_with(buffer, cwd, remote, cd_hist);
    let items: Vec<CompletionItem> = suggestions
        .into_iter()
        .map(|s| CompletionItem {
            text: s.text,
            description: s.description,
            kind: format!("{:?}", s.kind).to_lowercase(),
        })
        .collect();
    serde_json::to_value(items).unwrap_or(Value::Array(vec![]))
}

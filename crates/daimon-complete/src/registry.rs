use crate::spec::Spec;
use anyhow::Result;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static REGISTRY: OnceLock<Registry> = OnceLock::new();

pub struct Registry {
    specs: HashMap<String, Spec>,
}

impl Registry {
    /// Load built-in specs (embedded at compile time) + user specs from
    /// ~/.config/daimon/specs/*.{yaml,json} (user files override built-ins by name).
    pub fn load() -> Result<Self> {
        let mut specs: HashMap<String, Spec> = HashMap::new();

        // Built-in specs embedded at compile time
        for (name, yaml) in BUILTIN_SPECS {
            match parse_spec_yaml(yaml) {
                Ok(Some(s)) => { specs.insert(name.to_string(), s); }
                Ok(None) => {}
                Err(e) => eprintln!("daimon-complete: bad built-in spec {name}: {e}"),
            }
        }

        // User overrides / additions
        if let Some(dir) = user_spec_dir() {
            load_dir(&dir, &mut specs);
        }

        Ok(Self { specs })
    }

    pub fn get(&self, cmd: &str) -> Option<&Spec> {
        self.specs.get(cmd)
    }
}

pub fn global() -> &'static Registry {
    REGISTRY.get_or_init(|| Registry::load().unwrap_or(Registry { specs: HashMap::new() }))
}

/// A spec file may be a flat completion spec (`name`/`subcommands`/… at the top — the
/// original form, and what every built-in uses), or a unified file with a `completion:`
/// section (alongside an `output:` render section the UI consumes and we ignore). Returns
/// the completion Spec, or None when the file carries only an `output` section.
fn extract_completion(doc: serde_json::Value) -> Result<Option<Spec>> {
    if let Some(obj) = doc.as_object() {
        if let Some(c) = obj.get("completion") {
            return Ok(Some(serde_json::from_value(c.clone())?));
        }
        // No completion grammar here (e.g. an output-only spec) — nothing to register.
        if !obj.contains_key("subcommands") && !obj.contains_key("flags") && !obj.contains_key("args") {
            return Ok(None);
        }
    }
    Ok(Some(serde_json::from_value(doc)?))
}

fn parse_spec_yaml(text: &str) -> Result<Option<Spec>> {
    extract_completion(serde_yaml::from_str(text)?)
}

fn parse_spec_json(text: &str) -> Result<Option<Spec>> {
    extract_completion(serde_json::from_str(text)?)
}

fn load_dir(dir: &Path, specs: &mut HashMap<String, Spec>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        if name.starts_with('.') { continue; }
        let parsed = match path.extension().and_then(|e| e.to_str()) {
            Some("yaml") | Some("yml") => std::fs::read_to_string(&path).map_err(anyhow::Error::from).and_then(|s| parse_spec_yaml(&s)),
            Some("json") => std::fs::read_to_string(&path).map_err(anyhow::Error::from).and_then(|s| parse_spec_json(&s)),
            _ => continue,
        };
        match parsed {
            Ok(Some(s)) => { specs.insert(s.name.clone(), s); }
            Ok(None) => {} // output-only spec, no completion grammar
            Err(e) => eprintln!("daimon-complete: bad spec {}: {e}", path.display()),
        }
    }
}

fn user_spec_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config").join("daimon").join("specs"))
}

// Built-in specs embedded at compile time via include_str!
// Each entry: (command_name, yaml_content)
const BUILTIN_SPECS: &[(&str, &str)] = &[
    ("git",     include_str!("../../../specs/git.yaml")),
    ("docker",  include_str!("../../../specs/docker.yaml")),
    ("kubectl", include_str!("../../../specs/kubectl.yaml")),
    ("cargo",   include_str!("../../../specs/cargo.yaml")),
    ("bun",     include_str!("../../../specs/bun.yaml")),
    ("npm",     include_str!("../../../specs/npm.yaml")),
    ("brew",    include_str!("../../../specs/brew.yaml")),
    ("ssh",     include_str!("../../../specs/ssh.yaml")),
    ("curl",    include_str!("../../../specs/curl.yaml")),
    ("jq",      include_str!("../../../specs/jq.yaml")),
    ("df",      include_str!("../../../specs/df.json")),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_file_parses_as_completion() {
        let s = parse_spec_yaml("name: foo\nsubcommands:\n  - name: bar\n").unwrap().unwrap();
        assert_eq!(s.name, "foo");
        assert_eq!(s.subcommands[0].name, "bar");
    }

    #[test]
    fn unified_file_uses_completion_section() {
        let json = r#"{ "name": "tool",
            "completion": { "name": "tool", "subcommands": [{ "name": "sub" }] },
            "output": { "match": { "command": "^tool" }, "render": { "kind": "table" } } }"#;
        let s = parse_spec_json(json).unwrap().unwrap();
        assert_eq!(s.name, "tool");
        assert_eq!(s.subcommands[0].name, "sub");
    }

    #[test]
    fn output_only_file_registers_no_completion() {
        let json = r#"{ "match": { "command": "^df" }, "render": { "kind": "table" } }"#;
        assert!(parse_spec_json(json).unwrap().is_none());
    }

    #[test]
    fn no_file_fallback_parses() {
        let json = r#"{ "name": "df", "no_file_fallback": true, "flags": [{ "name": "-h" }] }"#;
        let s = parse_spec_json(json).unwrap().unwrap();
        assert!(s.no_file_fallback);
    }

    #[test]
    fn command_arg_kind_parses() {
        let json = r#"{ "name": "tool", "subcommands": [
            { "name": "sub", "args": [{ "name": "item", "kind": "command", "command": ["some-binary", "list"] }] } ] }"#;
        let s = parse_spec_json(json).unwrap().unwrap();
        match &s.subcommands[0].args[0].kind {
            crate::spec::ArgKind::Command { command, split } => {
                assert_eq!(command, &["some-binary", "list"]);
                assert_eq!(split, "whitespace"); // default
            }
            k => panic!("expected Command, got {k:?}"),
        }
    }
}

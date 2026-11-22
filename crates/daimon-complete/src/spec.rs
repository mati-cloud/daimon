use serde::{Deserialize, Serialize};

/// A single CLI tool spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Spec {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub subcommands: Vec<Subcommand>,
    #[serde(default)]
    pub flags: Vec<Flag>,
    #[serde(default)]
    pub args: Vec<Arg>,
    /// Don't fall back to filesystem completion at a position no declared arg covers.
    /// For tools that take no file arguments (e.g. `df`), so the prompt doesn't list files.
    #[serde(default)]
    pub no_file_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subcommand {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub subcommands: Vec<Subcommand>,
    #[serde(default)]
    pub flags: Vec<Flag>,
    #[serde(default)]
    pub args: Vec<Arg>,
    /// See `Spec::no_file_fallback`.
    #[serde(default)]
    pub no_file_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Flag {
    pub name: String,
    #[serde(default)]
    pub short: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// If present, the flag takes a value of this kind.
    #[serde(default)]
    pub arg: Option<ArgKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arg {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(flatten)]
    pub kind: ArgKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ArgKind {
    /// Freeform string, no completion.
    String,
    /// File path completion.
    File,
    /// Directory path completion.
    Dir,
    /// Fixed set of choices.
    Choice { choices: Vec<String> },
    /// Choices produced by running a command in the cwd and splitting its stdout.
    /// `split` defaults to "whitespace"; "lines" keeps whole lines and reads an optional
    /// tab-separated description per line (`value<TAB>description`), shown inline.
    /// Use the real binary, not a shell wrapper whose stdout gets sourced/eval'd.
    Command {
        command: Vec<String>,
        #[serde(default = "default_split")]
        split: String,
    },
    /// Git branch names.
    GitBranch,
    /// Git tag names.
    GitTag,
    /// Git remote names.
    GitRemote,
    /// Any remaining args (variadic).
    Rest,
    /// Modified or untracked files in the working tree (for git add).
    GitDirty,
}

impl Default for ArgKind {
    fn default() -> Self { Self::String }
}

fn default_split() -> String { "whitespace".to_string() }

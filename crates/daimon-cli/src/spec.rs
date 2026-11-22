use anyhow::Result;
use std::path::PathBuf;

fn config_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("can't find home dir"))?;
    Ok(home.join(".config/daimon"))
}

/// Specs that ship with daimon (the repo's specs/ folder), for `daimon spec add`.
const BUNDLED: &[(&str, &str)] = &[("df", include_str!("../../../specs/df.json"))];

const README: &str = r#"# daimon specs

JSON (or YAML) files here describe a command-line tool for daimon. One file can do two
jobs, independently:

- **completion** — subcommands, flags and args, fed to daimon's completion engine.
- **output** — recast the tool's plaintext output into a table / pairs / lines block.

Specs are data only — no code runs, so there is no approval prompt. daimon watches this
folder and reloads on save. (Completion specs may be `.yaml`; output rendering needs
`.json`, since the UI parses JSON only.)

## Unified file

```jsonc
{
  "name": "df",
  "completion": {
    "name": "df",
    "description": "Report file system disk space usage",
    "no_file_fallback": true,
    "flags": [
      { "name": "--human-readable", "short": "-h", "description": "Sizes in powers of 1024" },
      { "name": "--inodes", "short": "-i", "description": "List inode information" }
    ]
  },
  "output": {
    "match": { "command": "^df(\\s|$)" },
    "render": { "kind": "table", "columns": ["Filesystem", "Size", "Used", "Avail", "Use%", "Mounted on"], "split": "fields", "skipHeader": true }
  }
}
```

A file may also be output-only (`{ "match": …, "render": … }` at the top) or
completion-only (`{ "name": …, "subcommands": … }` at the top) — the two halves are
independent.

Output splits: `whitespace` slices by the header's column positions (like kubectl
tables); `fields` splits on runs of spaces, the last column keeping the remainder;
`indent` splits each line at its first gap into two columns; `regex` uses `render.pattern`'s
capture groups.
"#;

const EXAMPLE: &str = include_str!("../../../specs/df.json");

pub fn run_init() -> Result<()> {
    let dir = config_dir()?.join("specs");
    std::fs::create_dir_all(&dir)?;
    for (file, content) in [("README.md", README), ("df.json", EXAMPLE)] {
        let path = dir.join(file);
        if path.exists() {
            println!("kept    {}", path.display());
        } else {
            std::fs::write(&path, content)?;
            println!("created {}", path.display());
        }
    }
    println!("\nedit {} in your editor; daimon picks up saved changes live", dir.display());
    println!("note: specs are data only — no approval prompt, unlike plugins");
    Ok(())
}

/// Copies a bundled spec into the specs folder. Without a name, lists them. Kept unless `force`.
pub fn run_add(name: Option<&str>, force: bool) -> Result<()> {
    let Some(name) = name else {
        println!("specs that ship with daimon (add with `daimon spec add <name>`):");
        for (name, _) in BUNDLED {
            println!("  {name}");
        }
        return Ok(());
    };
    let Some((_, source)) = BUNDLED.iter().find(|(n, _)| *n == name) else {
        let names: Vec<&str> = BUNDLED.iter().map(|(n, _)| *n).collect();
        anyhow::bail!("no bundled spec '{name}' (available: {})", names.join(", "));
    };
    let dir = config_dir()?.join("specs");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{name}.json"));
    if path.exists() && !force {
        println!("kept    {} (already there; --force replaces it)", path.display());
    } else {
        std::fs::write(&path, source)?;
        println!("added   {}", path.display());
    }
    Ok(())
}

pub fn run_list() -> Result<()> {
    let dir = config_dir()?.join("specs");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    files.retain(|p| {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        p.extension().and_then(|e| e.to_str()) == Some("json") && !name.starts_with('.')
    });
    files.sort();
    if files.is_empty() {
        println!("no specs in {} (run `daimon spec init`)", dir.display());
    }
    for p in files {
        println!("{}", p.display());
    }
    Ok(())
}

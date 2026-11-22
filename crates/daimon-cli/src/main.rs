mod precmd;
mod preexec;
mod plugin;
mod setup;
mod shell_profiling;
mod spec;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("precmd")          => precmd::run(),
        Some("preexec")         => preexec::run(),
        Some("setup")           => setup::run(),
        Some("shell-profiling") => shell_profiling::run(),
        Some("plugin") => {
            match args.next().as_deref() {
                Some("init") => plugin::run_init(),
                Some("list") => plugin::run_list(),
                Some("add") => {
                    let rest: Vec<String> = args.collect();
                    let force = rest.iter().any(|a| a == "--force");
                    plugin::run_add(rest.iter().find(|a| !a.starts_with("--")).map(String::as_str), force)
                }
                _ => {
                    eprintln!("usage: daimon plugin <init|list|add [name] [--force]>");
                    std::process::exit(1)
                }
            }
        }
        Some("spec") => {
            match args.next().as_deref() {
                Some("init") => spec::run_init(),
                Some("list") => spec::run_list(),
                Some("add") => {
                    let rest: Vec<String> = args.collect();
                    let force = rest.iter().any(|a| a == "--force");
                    spec::run_add(rest.iter().find(|a| !a.starts_with("--")).map(String::as_str), force)
                }
                _ => {
                    eprintln!("usage: daimon spec <init|list|add [name] [--force]>");
                    std::process::exit(1)
                }
            }
        }
        Some(cmd) => {
            eprintln!("daimon: unknown command '{cmd}'");
            eprintln!("usage: daimon <precmd|preexec|setup|shell-profiling|plugin|spec>");
            std::process::exit(1)
        }
        None => {
            eprintln!("usage: daimon <precmd|preexec|setup|shell-profiling|plugin|spec>");
            std::process::exit(1)
        }
    }
}

//! Packaged runner: initialize diagnostics before loading NSH or app code.
#[cfg(target_os = "macos")]
fn main() -> std::process::ExitCode {
    use nsh_app_difflens::diagnostics;
    let arguments: Vec<_> = std::env::args().collect();
    if arguments.get(1).is_some_and(|argument| argument == "--apply-update") {
        let Some(path) = arguments.get(2) else { return std::process::ExitCode::FAILURE; };
        return match nsh_app_difflens::update_install::apply_from_argument(std::path::Path::new(path)) {
            Ok(()) => std::process::ExitCode::SUCCESS,
            Err(error) => { eprintln!("{error}"); std::process::ExitCode::FAILURE }
        };
    }
    nsh_app_difflens::update_install::register_startup(&arguments);
    if arguments.iter().any(|argument| argument == "--diagnostics") {
        return match diagnostics::print_configuration() {
            Ok(()) => std::process::ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("{error}");
                std::process::ExitCode::FAILURE
            }
        };
    }
    if arguments
        .get(1)
        .is_some_and(|argument| argument == "--scan")
    {
        let Some(path) = arguments.get(2) else {
            eprintln!("Usage: DiffLens --scan /path/to/workspace");
            return std::process::ExitCode::FAILURE;
        };
        let started = std::time::Instant::now();
        return match nsh_app_difflens::scan_read_only(path.into()) {
            Ok(scan) => {
                fn count(nodes: &[nsh_app_difflens::RepositoryNode]) -> (usize, usize) {
                    nodes.iter().fold((0, 0), |(total, errors), node| {
                        let (children, child_errors) = count(&node.children);
                        (
                            total + children + 1,
                            errors + child_errors + usize::from(node.error.is_some()),
                        )
                    })
                }
                let (repositories, errors) = count(&scan.repositories);
                println!(
                    "Read-only scan: {repositories} repositories, {errors} repository errors, {} warnings, {} ms",
                    scan.warnings.len(),
                    started.elapsed().as_millis()
                );
                if errors == 0 {
                    std::process::ExitCode::SUCCESS
                } else {
                    std::process::ExitCode::FAILURE
                }
            }
            Err(error) => {
                eprintln!("{error}");
                std::process::ExitCode::FAILURE
            }
        };
    }
    if let Err(error) = diagnostics::start_installed() {
        eprintln!("Cannot initialize DiffLens diagnostics: {error}");
        return std::process::ExitCode::FAILURE;
    }
    if let Err(error) = diagnostics::capture_output() {
        eprintln!("Cannot capture DiffLens runtime output: {error}");
        diagnostics::finish(false);
        return std::process::ExitCode::FAILURE;
    }
    nsh_platform_macos::set_ui_sets(vec![
        nsh_base::registry(),
        nsh_app_difflens::__nsh_native_module(),
    ]);
    let result = nsh_macos_app::main();
    nsh_app_difflens::updates::shutdown();
    diagnostics::finish(result == std::process::ExitCode::SUCCESS);
    result
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This runner packages the macOS application.");
}

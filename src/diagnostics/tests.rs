use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let unique = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "difflens-diagnostics-{}-{}-{}",
            std::process::id(),
            now_ms(),
            unique
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn session(&self) -> Session {
        Session::new(self.0.join("logs"), self.0.join("os-reports")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn rotation_preserves_recent_events_and_bounds_backups() {
    let fixture = Fixture::new();
    let log = RotatingLog {
        path: fixture.0.join("events.jsonl"),
        max_bytes: 10,
    };
    for value in 0..12 {
        log.write(format!("event-{value}\n").as_bytes()).unwrap();
    }
    assert!(fs::read_to_string(&log.path).unwrap().contains("event-11"));
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 4);
    assert!(
        fs::read_to_string(fixture.0.join("events.jsonl.3"))
            .unwrap()
            .contains("event-8")
    );
}

#[test]
fn clean_exit_does_not_report_a_crash() {
    let fixture = Fixture::new();
    let session = fixture.session();
    session.finish(true).unwrap();
    let reopened = fixture.session();
    assert!(!reopened.info().previous_unclean_exit);
    let state: SessionState =
        serde_json::from_slice(&fs::read(fixture.0.join("logs/session.json")).unwrap()).unwrap();
    assert_eq!(state.status, SessionStatus::Running);
}

// Runs only when invoked by the parent test, in an isolated test process.
#[test]
fn panic_probe() {
    let Some(path) = std::env::var_os("DIFFLENS_TEST_DIAGNOSTICS_DIR") else {
        return;
    };
    let path = PathBuf::from(path);
    attach(Session::new(path.join("logs"), path.join("os-reports")).unwrap()).unwrap();
    capture_output().unwrap();
    static LOGGER: RuntimeLogger = RuntimeLogger;
    log::set_logger(&LOGGER).unwrap();
    log::set_max_level(log::LevelFilter::Info);
    log::warn!(target: "js", "fixture runtime warning");
    println!("fixture stdout");
    eprintln!("fixture stderr");
    panic!("diagnostics fixture panic");
}

#[test]
fn subprocess_panic_saves_backtrace_and_next_launch_detects_unclean_exit() {
    let fixture = Fixture::new();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "diagnostics::tests::panic_probe", "--nocapture"])
        .env("DIFFLENS_TEST_DIAGNOSTICS_DIR", &fixture.0)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(!status.success());
    let reopened = fixture.session();
    assert!(reopened.info().previous_unclean_exit);
    let report = fs::read_to_string(reopened.info().latest_report.unwrap()).unwrap();
    assert!(report.contains("diagnostics fixture panic"));
    assert!(report.contains("diagnostics::tests::panic_probe"));
    assert!(report.contains(&format!("DiffLens {}", env!("CARGO_PKG_VERSION"))));
    let runtime = fs::read_to_string(fixture.0.join("logs/runtime.log")).unwrap();
    assert!(runtime.contains("fixture stdout"));
    assert!(runtime.contains("fixture stderr"));
    assert!(runtime.contains("diagnostics fixture panic"));
    let events = fs::read_to_string(fixture.0.join("logs/events.jsonl")).unwrap();
    assert!(events.contains("fixture runtime warning"));
}

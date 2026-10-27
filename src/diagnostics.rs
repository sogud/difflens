//! Local session logs and panic reports. No telemetry leaves this machine.
use nsh_core::ui::prelude::JsObject;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    backtrace::Backtrace,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, Once, OnceLock},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const LOG_BACKUPS: usize = 3;
static SESSION: OnceLock<Session> = OnceLock::new();
static INITIALIZING: Mutex<()> = Mutex::new(());
static PANIC_HOOK: Once = Once::new();

#[derive(Deserialize)]
struct Metadata {
    version: String,
    build: u32,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SessionStatus {
    Running,
    Clean,
    Failed,
}

#[derive(Serialize, Deserialize)]
struct SessionState {
    pid: u32,
    status: SessionStatus,
    started_ms: u64,
    version: String,
}

/// Local paths and version information shown in Settings.
#[derive(Clone, Debug, JsObject)]
pub struct DiagnosticsInfo {
    pub version: String,
    pub build: u32,
    pub architecture: String,
    pub log_directory: String,
    pub crash_directory: String,
    pub previous_unclean_exit: bool,
    pub latest_report: Option<String>,
    pub crash_report_error: Option<String>,
}

struct RotatingLog {
    path: PathBuf,
    max_bytes: u64,
}

impl RotatingLog {
    fn write(&self, bytes: &[u8]) -> std::io::Result<()> {
        if self.path.metadata().map(|m| m.len()).unwrap_or(0) + bytes.len() as u64 > self.max_bytes
        {
            rotate(&self.path)?;
        }
        let mut file = private_file(&self.path)?;
        file.write_all(bytes)?;
        file.flush()
    }
}

struct Session {
    directory: PathBuf,
    crash_directory: PathBuf,
    metadata: Metadata,
    state: Mutex<SessionState>,
    events: Mutex<RotatingLog>,
    previous_unclean_exit: bool,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn private_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn rotate(path: &Path) -> std::io::Result<()> {
    for index in (1..=LOG_BACKUPS).rev() {
        let source = if index == 1 {
            path.to_path_buf()
        } else {
            PathBuf::from(format!("{}.{}", path.display(), index - 1))
        };
        let destination = PathBuf::from(format!("{}.{}", path.display(), index));
        if destination.exists() {
            fs::remove_file(&destination)?;
        }
        if source.exists() {
            fs::rename(source, destination)?;
        }
    }
    Ok(())
}

fn process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // A zero signal checks existence without sending a signal to the process.
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

impl Session {
    fn new(directory: PathBuf, crash_directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let metadata: Metadata =
            serde_json::from_str(include_str!("../nsh.json")).map_err(|e| e.to_string())?;
        let state_path = directory.join("session.json");
        let previous_unclean_exit = if state_path.exists() {
            let text = fs::read(&state_path).map_err(|e| e.to_string())?;
            match serde_json::from_slice::<SessionState>(&text) {
                Ok(state) => state.status == SessionStatus::Running && !process_alive(state.pid),
                Err(_) => {
                    fs::rename(
                        &state_path,
                        directory.join(format!("session-corrupt-{}.json", now_ms())),
                    )
                    .map_err(|e| e.to_string())?;
                    true
                }
            }
        } else {
            false
        };
        let session = Self {
            events: Mutex::new(RotatingLog {
                path: directory.join("events.jsonl"),
                max_bytes: MAX_LOG_BYTES,
            }),
            state: Mutex::new(SessionState {
                pid: std::process::id(),
                status: SessionStatus::Running,
                started_ms: now_ms(),
                version: metadata.version.clone(),
            }),
            directory,
            crash_directory,
            metadata,
            previous_unclean_exit,
        };
        session.save_state()?;
        session.write(
            "info",
            "session.started",
            json!({ "previousUncleanExit": previous_unclean_exit }),
        )?;
        session.prune_panic_reports()?;
        Ok(session)
    }

    fn save_state(&self) -> Result<(), String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        let path = self.directory.join("session.json");
        // Another process may have opened the app after this session.
        if state.status != SessionStatus::Running && path.exists() {
            let current = fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<SessionState>(&bytes).ok());
            if current.is_some_and(|current| current.pid != state.pid) {
                return Ok(());
            }
        }
        let temporary = self
            .directory
            .join(format!("session-{}.tmp", std::process::id()));
        {
            let mut file = private_file(&temporary).map_err(|e| e.to_string())?;
            file.set_len(0).map_err(|e| e.to_string())?;
            serde_json::to_writer(&mut file, &*state).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
        }
        fs::rename(temporary, path).map_err(|e| e.to_string())
    }

    fn write(&self, level: &str, event: &str, fields: Value) -> Result<(), String> {
        let record = json!({ "timeUnixMs": now_ms(), "pid": std::process::id(), "version": self.metadata.version,
            "build": self.metadata.build, "level": level, "event": event, "fields": fields });
        let mut line = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
        line.push(b'\n');
        self.events
            .lock()
            .map_err(|e| e.to_string())?
            .write(&line)
            .map_err(|e| e.to_string())
    }

    fn finish(&self, success: bool) -> Result<(), String> {
        self.write(
            if success { "info" } else { "error" },
            "session.ended",
            json!({ "success": success }),
        )?;
        self.state.lock().map_err(|e| e.to_string())?.status = if success {
            SessionStatus::Clean
        } else {
            SessionStatus::Failed
        };
        self.save_state()
    }

    fn info(&self) -> DiagnosticsInfo {
        let own = latest_file(&self.directory, |name| {
            name.starts_with("panic-") && name.ends_with(".txt")
        });
        let system = latest_file(&self.crash_directory, |name| {
            name.starts_with("DiffLens") && (name.ends_with(".ips") || name.ends_with(".crash"))
        });
        let error = own.as_ref().err().or(system.as_ref().err()).cloned();
        let latest = [own.ok().flatten(), system.ok().flatten()]
            .into_iter()
            .flatten()
            .max_by_key(|(time, _)| *time);
        DiagnosticsInfo {
            version: self.metadata.version.clone(),
            build: self.metadata.build,
            architecture: std::env::consts::ARCH.to_owned(),
            log_directory: self.directory.to_string_lossy().into_owned(),
            crash_directory: self.crash_directory.to_string_lossy().into_owned(),
            previous_unclean_exit: self.previous_unclean_exit,
            latest_report: latest.map(|(_, path)| path.to_string_lossy().into_owned()),
            crash_report_error: error,
        }
    }

    fn prune_panic_reports(&self) -> Result<(), String> {
        let mut reports = Vec::new();
        for entry in fs::read_dir(&self.directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("panic-")
                && name.ends_with(".txt")
                && entry.file_type().map_err(|e| e.to_string())?.is_file()
            {
                reports.push(entry.path());
            }
        }
        reports.sort();
        let old_count = reports.len().saturating_sub(10);
        for path in reports.into_iter().take(old_count) {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

fn latest_file(
    directory: &Path,
    accepts: impl Fn(&str) -> bool,
) -> Result<Option<(SystemTime, PathBuf)>, String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut latest = None;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if accepts(&entry.file_name().to_string_lossy()) {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() {
                continue;
            }
            let modified = metadata.modified().map_err(|e| e.to_string())?;
            if latest.as_ref().is_none_or(|(time, _)| modified > *time) {
                latest = Some((modified, entry.path()));
            }
        }
    }
    Ok(latest)
}

fn attach(session: Session) -> Result<DiagnosticsInfo, String> {
    // Initialization runs once per process, before any user operations.
    let _ = SESSION.set(session);
    PANIC_HOOK.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if let Some(session) = SESSION.get() {
                let path = session.directory.join(format!(
                    "panic-{}-{}.txt",
                    now_ms(),
                    std::process::id()
                ));
                let report = format!(
                    "DiffLens {} ({})\n{}\n{}\n",
                    session.metadata.version,
                    session.metadata.build,
                    info,
                    Backtrace::force_capture()
                );
                if let Ok(mut file) = private_file(&path) {
                    let _ = file.write_all(report.as_bytes());
                    let _ = file.sync_all();
                }
            }
            previous(info);
        }));
    });
    Ok(SESSION.get().expect("session was attached").info())
}

/// Initializes development/test sessions inside the host's own data directory.
/// Installed apps initialize earlier in their native runner.
pub fn initialize(data_directory: Option<PathBuf>) -> Result<DiagnosticsInfo, String> {
    let _initializing = INITIALIZING.lock().map_err(|e| e.to_string())?;
    if let Some(session) = SESSION.get() {
        return Ok(session.info());
    }
    let data =
        data_directory.ok_or_else(|| "The host has no diagnostics data directory.".to_owned())?;
    attach(Session::new(
        data.join("diagnostics"),
        data.join("crash-reports"),
    )?)
}

/// Initializes the installed macOS app before the UI runtime starts.
pub fn start_installed() -> Result<DiagnosticsInfo, String> {
    let _initializing = INITIALIZING.lock().map_err(|e| e.to_string())?;
    if let Some(session) = SESSION.get() {
        return Ok(session.info());
    }
    let (logs, crash_reports) = installed_directories()?;
    let info = attach(Session::new(logs, crash_reports)?)?;
    static LOGGER: RuntimeLogger = RuntimeLogger;
    log::set_logger(&LOGGER).map_err(|e| e.to_string())?;
    log::set_max_level(log::LevelFilter::Info);
    Ok(info)
}

struct RuntimeLogger;
impl log::Log for RuntimeLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::Level::Warn
            || metadata.target() == "js"
            || metadata.target().starts_with("difflens")
    }
    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            event(
                &record.level().to_string().to_lowercase(),
                record.target(),
                json!({ "message": record.args().to_string().chars().take(4096).collect::<String>() }),
            );
        }
    }
    fn flush(&self) {}
}

/// Captures messages printed outside Rust's logger (including early runtime errors).
#[cfg(unix)]
pub fn capture_output() -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let session = SESSION.get().ok_or("Diagnostics are not initialized.")?;
    let path = session.directory.join("runtime.log");
    if path.metadata().map(|m| m.len()).unwrap_or(0) > MAX_LOG_BYTES {
        rotate(&path).map_err(|e| e.to_string())?;
    }
    let file = private_file(&path).map_err(|e| e.to_string())?;
    // Called by main before the runtime starts threads; dup2 owns the duplicate descriptors.
    unsafe {
        if libc::dup2(file.as_raw_fd(), libc::STDERR_FILENO) < 0
            || libc::dup2(file.as_raw_fd(), libc::STDOUT_FILENO) < 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}

/// Records a coarse event. Action arguments and successful command output are excluded.
pub fn event(level: &str, name: &str, fields: Value) {
    if let Some(session) = SESSION.get() {
        if let Err(error) = session.write(level, name, fields) {
            eprintln!("DiffLens diagnostics write failed: {error}");
        }
    }
}

/// Measures one native action without recording its input or output.
pub fn operation_started(name: &str) -> Instant {
    event("info", "operation.started", json!({ "operation": name }));
    Instant::now()
}

pub fn operation_finished(name: &str, started: Instant, error: Option<&str>) {
    event(
        if error.is_none() { "info" } else { "error" },
        "operation.finished",
        json!({ "operation": name, "durationMs": started.elapsed().as_millis() as u64, "success": error.is_none(), "error": error.map(|message| message.chars().take(4096).collect::<String>()) }),
    );
}

pub fn info() -> Result<DiagnosticsInfo, String> {
    SESSION
        .get()
        .map(Session::info)
        .ok_or_else(|| "Diagnostics are not initialized.".to_owned())
}

pub fn record_ui_error(message: String) -> Result<(), String> {
    let session = SESSION.get().ok_or("Diagnostics are not initialized.")?;
    session.write(
        "error",
        "ui.error",
        json!({ "message": message.chars().take(4096).collect::<String>() }),
    )
}

pub fn open_logs() -> Result<(), String> {
    open_path(&PathBuf::from(info()?.log_directory))
}
pub fn open_crash_reports() -> Result<(), String> {
    let path = PathBuf::from(info()?.crash_directory);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    open_path(&path)
}
pub fn open_latest_report() -> Result<(), String> {
    let path = info()?
        .latest_report
        .ok_or("No crash report is available.")?;
    open_path(&PathBuf::from(path))
}
fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let program = "xdg-open";
    let status = std::process::Command::new(program)
        .arg(path)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("The system could not open this path.".to_owned())
    }
}

/// Writes the final exit status when the native runner returns normally.
pub fn finish(success: bool) {
    if let Some(session) = SESSION.get() {
        if let Err(error) = session.finish(success) {
            eprintln!("DiffLens session close failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests;

fn installed_directories() -> Result<(PathBuf, PathBuf), String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("HOME is unavailable.")?;
    Ok((
        home.join("Library/Logs/DiffLens"),
        home.join("Library/Logs/DiagnosticReports"),
    ))
}

/// Prints configuration without taking ownership of a running GUI's session marker.
pub fn print_configuration() -> Result<(), String> {
    let metadata: Metadata =
        serde_json::from_str(include_str!("../nsh.json")).map_err(|error| error.to_string())?;
    let (logs, crash_reports) = installed_directories()?;
    println!(
        "DiffLens {} ({}) {}\nLogs: {}\nCrash reports: {}",
        metadata.version,
        metadata.build,
        std::env::consts::ARCH,
        logs.display(),
        crash_reports.display()
    );
    Ok(())
}

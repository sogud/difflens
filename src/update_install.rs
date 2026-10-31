use crate::updates::{self, Manifest, Package};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

#[derive(Serialize, Deserialize)]
struct Ticket {
    parent: u32,
    target: PathBuf,
    staging: PathBuf,
    build: u32,
}
#[derive(Serialize, Deserialize)]
struct Healthy {
    pid: u32,
    build: u32,
}
static STARTUP: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

pub fn register_startup(arguments: &[String]) {
    if arguments
        .get(1)
        .is_some_and(|arg| arg == "--update-startup")
    {
        if let Some(path) = arguments.get(2) {
            let _ = STARTUP.set(Mutex::new(Some(PathBuf::from(path))));
        }
    }
}
fn read_ticket(directory: &Path) -> Result<Ticket, String> {
    let bytes = fs::read(directory.join("install.json"))
        .map_err(|_| "Cannot read the update installation ticket.")?;
    if bytes.len() > 16 * 1024 {
        return Err("Invalid update installation ticket.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid update installation ticket.".into())
}
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}

pub fn mark_healthy() -> Result<(), String> {
    let Some(startup) = STARTUP.get() else {
        return Ok(());
    };
    let directory = startup.lock().unwrap_or_else(|e| e.into_inner()).take();
    let Some(directory) = directory else {
        return Ok(());
    };
    let directory = updates::validate_directory(&directory)?;
    let ticket = read_ticket(&directory)?;
    if ticket.build != updates::current_build() || updates::installed_bundle()? != ticket.target {
        return Err("The update startup acknowledgement does not match this app.".into());
    }
    let receipt = serde_json::to_vec(&Healthy {
        pid: std::process::id(),
        build: ticket.build,
    })
    .map_err(|e| e.to_string())?;
    write_private(&directory.join("healthy.json"), &receipt)
}

pub(crate) fn prepare(package: &Package, target: &Path) -> Result<(), String> {
    let directory = updates::validate_directory(&package.directory)?;
    let manifest = updates::read_manifest(&directory)?;
    if manifest.build <= updates::current_build() || manifest.build != package.manifest.build {
        return Err("The update is not newer than this app.".into());
    }
    updates::verify_archive(&directory.join(&manifest.archive), &manifest)?;
    updates::verify_bundle(&package.bundle, Some(&manifest))?;
    let parent = target.parent().ok_or("Cannot locate the app folder.")?;
    let name = directory
        .file_name()
        .ok_or("Invalid update identifier.")?
        .to_string_lossy();
    let staging = parent.join(format!(".DiffLens-{name}.app"));
    if staging.exists() {
        return Err(
            "An update installation is already staged. Restart the app and try again.".into(),
        );
    }
    // A sibling keeps the atomic exchange on the same filesystem as the installed app.
    updates::run(
        Command::new("/usr/bin/ditto")
            .arg(&package.bundle)
            .arg(&staging),
        "Cannot stage the update in Applications. Check folder permissions.",
    )?;
    if let Err(error) = updates::verify_bundle(&staging, Some(&manifest)) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let setup = (|| {
        let ticket = Ticket {
            parent: std::process::id(),
            target: target.to_owned(),
            staging: staging.clone(),
            build: manifest.build,
        };
        for name in ["install.json", "helper-ready", "healthy.json"] {
            let _ = fs::remove_file(directory.join(name));
        }
        write_private(
            &directory.join("install.json"),
            &serde_json::to_vec(&ticket).map_err(|e| e.to_string())?,
        )?;
        let helper = directory.join("installer");
        fs::copy(std::env::current_exe().map_err(|e| e.to_string())?, &helper)
            .map_err(|_| "Cannot prepare the update installer.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&helper, fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let mut command = Command::new(helper);
        command
            .arg("--apply-update")
            .arg(&directory)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|_| "Cannot start the update installer.")?;
        let started = Instant::now();
        while !directory.join("helper-ready").is_file() {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err("The update installer could not prepare a safe replacement.".into());
            }
            if started.elapsed() > Duration::from_secs(8) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(
                    "The update installer did not become ready. The current app was not changed."
                        .into(),
                );
            }
            thread::sleep(Duration::from_millis(40));
        }
        Ok(())
    })();
    if setup.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    setup
}

#[cfg(target_os = "macos")]
struct ParentExit {
    descriptor: i32,
}
#[cfg(target_os = "macos")]
impl ParentExit {
    fn register(pid: u32) -> Result<Self, String> {
        if pid == 0 || pid == std::process::id() {
            return Err("Invalid update parent process.".into());
        }
        let descriptor = unsafe { libc::kqueue() };
        if descriptor < 0 {
            return Err("Cannot monitor the original app.".into());
        }
        let change = libc::kevent {
            ident: pid as usize,
            filter: libc::EVFILT_PROC,
            flags: libc::EV_ADD | libc::EV_ENABLE | libc::EV_ONESHOT,
            fflags: libc::NOTE_EXIT,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        let count = unsafe {
            libc::kevent(
                descriptor,
                &change,
                1,
                std::ptr::null_mut(),
                0,
                std::ptr::null(),
            )
        };
        if count < 0 {
            unsafe {
                libc::close(descriptor);
            }
            return Err("Cannot monitor the original app's exit.".into());
        }
        Ok(Self { descriptor })
    }
    fn wait(&self) -> Result<(), String> {
        let mut event: libc::kevent = unsafe { std::mem::zeroed() };
        let timeout = libc::timespec {
            tv_sec: 120,
            tv_nsec: 0,
        };
        let count = unsafe {
            libc::kevent(
                self.descriptor,
                std::ptr::null(),
                0,
                &mut event,
                1,
                &timeout,
            )
        };
        if count == 1 && event.fflags & libc::NOTE_EXIT != 0 {
            Ok(())
        } else {
            Err("The original app did not exit. Its files were left unchanged.".into())
        }
    }
}
#[cfg(target_os = "macos")]
impl Drop for ParentExit {
    fn drop(&mut self) {
        unsafe {
            libc::close(self.descriptor);
        }
    }
}

#[cfg(target_os = "macos")]
fn exchange(left: &Path, right: &Path) -> Result<(), String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let left = CString::new(left.as_os_str().as_bytes()).map_err(|_| "Invalid app path.")?;
    let right = CString::new(right.as_os_str().as_bytes()).map_err(|_| "Invalid app path.")?;
    let result = unsafe {
        libc::renameatx_np(
            libc::AT_FDCWD,
            left.as_ptr(),
            libc::AT_FDCWD,
            right.as_ptr(),
            libc::RENAME_SWAP,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Cannot atomically replace the app: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(target_os = "macos")]
struct InstallLock(std::fs::File);
#[cfg(target_os = "macos")]
impl InstallLock {
    fn take() -> Result<Self, String> {
        use std::os::fd::AsRawFd;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(updates::cache_root()?.join("install.lock"))
            .map_err(|_| "Cannot lock the update installer.")?;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("Another update installer is already running.".into());
        }
        Ok(Self(file))
    }
}
#[cfg(target_os = "macos")]
impl Drop for InstallLock {
    fn drop(&mut self) {
        use std::os::fd::AsRawFd;
        unsafe {
            libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

fn app_processes(target: &Path) -> Result<Vec<u32>, String> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()
        .map_err(|_| "Cannot inspect running app instances.")?;
    if !output.status.success() {
        return Err("Cannot inspect running app instances.".into());
    }
    let executable = target.join("Contents/MacOS/DiffLens");
    let expected = executable.to_str().ok_or("The app path is not UTF-8.")?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (pid, command) = line.trim().split_once(char::is_whitespace)?;
            if command.trim() == expected {
                pid.parse().ok()
            } else {
                None
            }
        })
        .collect())
}

fn valid_scope(directory: &Path, ticket: &Ticket) -> bool {
    let Some(home) = std::env::var_os("HOME") else {
        return false;
    };
    let Some(parent) = ticket.target.parent() else {
        return false;
    };
    let Some(name) = directory.file_name() else {
        return false;
    };
    ticket
        .target
        .file_name()
        .is_some_and(|name| name == "DiffLens.app")
        && (parent == Path::new("/Applications")
            || parent == PathBuf::from(home).join("Applications"))
        && ticket.staging == parent.join(format!(".DiffLens-{}.app", name.to_string_lossy()))
}

fn validate_ticket(directory: &Path, ticket: &Ticket, manifest: &Manifest) -> Result<(), String> {
    if !valid_scope(directory, ticket)
        || ticket.build != manifest.build
        || ticket.build <= updates::current_build()
    {
        return Err("Invalid update installation scope.".into());
    }
    updates::verify_bundle(&ticket.target, None)?;
    if updates::plist(&ticket.target, "CFBundleVersion")? != updates::current_build().to_string() {
        return Err("The installed app changed while the update was prepared.".into());
    }
    updates::verify_bundle(&ticket.staging, Some(manifest))
}

#[cfg(target_os = "macos")]
fn apply(directory: &Path) -> Result<(), String> {
    let directory = updates::validate_directory(directory)?;
    let _lock = InstallLock::take()?;
    let manifest = updates::read_manifest(&directory)?;
    let ticket = read_ticket(&directory)?;
    validate_ticket(&directory, &ticket, &manifest)?;
    if app_processes(&ticket.target)? != vec![ticket.parent] {
        return Err("Close other DiffLens instances before installing an update.".into());
    }
    let parent = ParentExit::register(ticket.parent)?;
    write_private(
        &directory.join("helper-ready"),
        std::process::id().to_string().as_bytes(),
    )?;
    parent.wait()?;
    // Revalidate after the old process has exited, immediately before changing its bundle.
    validate_ticket(&directory, &ticket, &manifest)?;
    if !app_processes(&ticket.target)?.is_empty() {
        return Err("Another DiffLens instance is still running. The app was not replaced.".into());
    }
    exchange(&ticket.target, &ticket.staging)?;
    let launched = (|| {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new(ticket.target.join("Contents/MacOS/DiffLens"))
            .process_group(0)
            .arg("--update-startup")
            .arg(&directory)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "The updated app could not start.")?;
        let health: Result<(), String> = (|| {
            let started = Instant::now();
            loop {
                let healthy = fs::read(directory.join("healthy.json"))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Healthy>(&bytes).ok())
                    .is_some_and(|receipt| {
                        receipt.pid == child.id() && receipt.build == manifest.build
                    });
                if healthy {
                    thread::sleep(Duration::from_secs(2));
                    if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                        return Ok(());
                    }
                }
                if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                    return Err("The updated app exited during startup.".to_owned());
                }
                if started.elapsed() > Duration::from_secs(45) {
                    return Err("The updated app did not acknowledge startup.".into());
                }
                thread::sleep(Duration::from_millis(150));
            }
        })();
        // Only the newly launched child is stopped on failure, never the original app.
        if health.is_err() {
            if child.try_wait().ok().flatten().is_none() {
                unsafe {
                    libc::killpg(child.id() as i32, libc::SIGTERM);
                }
                thread::sleep(Duration::from_millis(300));
                if child.try_wait().ok().flatten().is_none() {
                    unsafe {
                        libc::killpg(child.id() as i32, libc::SIGKILL);
                    }
                }
            }
            let _ = child.wait();
        }
        health
    })();
    match launched {
        Ok(()) => {
            let _ = fs::remove_dir_all(&ticket.staging);
            let _ = fs::remove_dir_all(&directory);
            Ok(())
        }
        Err(error) => {
            if let Err(rollback) = exchange(&ticket.target, &ticket.staging) {
                let message = format!(
                    "{error} The app folder could not be restored: {rollback}. The previous version is being opened from {}. Quit it before moving it back to Applications.",
                    ticket.staging.display()
                );
                if let Ok(root) = updates::cache_root() {
                    let _ = fs::write(root.join("last-install-error.txt"), &message);
                }
                let _ = Command::new("/usr/bin/open")
                    .arg("-n")
                    .arg(&ticket.staging)
                    .status();
                return Err(message);
            }
            let message = format!("{error} The previous version was restored.");
            if let Ok(root) = updates::cache_root() {
                let _ = fs::write(root.join("last-install-error.txt"), &message);
            }
            let _ = Command::new("/usr/bin/open").arg(&ticket.target).status();
            let _ = fs::remove_dir_all(&ticket.staging);
            Err(message)
        }
    }
}

pub fn apply_from_argument(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = apply(path);
    #[cfg(not(target_os = "macos"))]
    let result: Result<(), String> = Err("Application updates require macOS.".into());
    if let Err(error) = &result {
        if let Ok(directory) = updates::validate_directory(path) {
            let _ = fs::write(directory.join("install-error.txt"), error);
            if let Ok(ticket) = read_ticket(&directory) {
                // Failed before exchange: only remove a staging bundle that is still the new build.
                if valid_scope(&directory, &ticket)
                    && updates::plist(&ticket.staging, "CFBundleVersion")
                        .ok()
                        .is_some_and(|build| build == ticket.build.to_string())
                {
                    let _ = fs::remove_dir_all(ticket.staging);
                }
            }
        }
    }
    result
}

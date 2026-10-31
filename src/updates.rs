use nsh_core::prelude::JsObject;
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
    signature,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

const CONFIG: &str = include_str!("../update-config.json");
const APP_CONFIG: &str = include_str!("../nsh.json");
const MAX_ARCHIVE: u64 = 200 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);
static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
static ACTIVE_FETCH: Mutex<Option<Arc<Mutex<Child>>>> = Mutex::new(None);

struct FetchGuard(Arc<Mutex<Child>>);
impl Drop for FetchGuard {
    fn drop(&mut self) {
        let mut active = ACTIVE_FETCH.lock().unwrap_or_else(|e| e.into_inner());
        if active
            .as_ref()
            .is_some_and(|child| Arc::ptr_eq(child, &self.0))
        {
            *active = None;
        }
        let mut child = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn shutdown() {
    let active = ACTIVE_FETCH
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    if let Some(active) = active {
        let mut child = active.lock().unwrap_or_else(|e| e.into_inner());
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    repository: String,
    channel: String,
    public_key: String,
}

#[derive(Clone, Debug, JsObject)]
pub struct UpdateStatus {
    pub phase: String,
    pub supported: bool,
    pub current_version: String,
    pub current_build: u32,
    pub channel: String,
    pub version: Option<String>,
    pub build: Option<u32>,
    pub release_url: Option<String>,
    pub received_bytes: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Manifest {
    pub schema: u32,
    pub version: String,
    pub build: u32,
    pub tag: String,
    pub channel: String,
    pub bundle_id: String,
    pub architecture: String,
    pub minimum_system_version: String,
    pub archive: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Deserialize)]
struct Asset {
    id: u64,
    name: String,
    size: u64,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
#[derive(Clone)]
struct Offer {
    manifest: Manifest,
    asset: Asset,
    directory: PathBuf,
}
#[derive(Clone)]
pub(crate) struct Package {
    pub manifest: Manifest,
    pub directory: PathBuf,
    pub bundle: PathBuf,
}
struct Runtime {
    status: UpdateStatus,
    offer: Option<Offer>,
    package: Option<Package>,
}

fn config() -> Config {
    serde_json::from_str(CONFIG).expect("embedded update configuration")
}
pub(crate) fn current_build() -> u32 {
    serde_json::from_str::<serde_json::Value>(APP_CONFIG).expect("embedded app configuration")["build"].as_u64().expect("app build") as u32
}
fn current_version() -> String {
    serde_json::from_str::<serde_json::Value>(APP_CONFIG).expect("embedded app configuration")["version"].as_str().expect("app version").to_owned()
}
fn runtime() -> &'static Mutex<Runtime> {
    RUNTIME.get_or_init(|| {
        let recovery = cache_root()
            .ok()
            .and_then(|path| fs::read_to_string(path.join("last-install-error.txt")).ok())
            .filter(|text| text.len() < 8192);
        Mutex::new(Runtime {
            status: UpdateStatus {
                phase: if recovery.is_some() {
                    "recovered".into()
                } else {
                    "idle".into()
                },
                supported: installed_bundle().is_ok(),
                current_version: current_version(),
                current_build: current_build(),
                channel: config().channel,
                version: None,
                build: None,
                release_url: Some(format!(
                    "https://github.com/{}/releases",
                    config().repository
                )),
                received_bytes: 0,
                total_bytes: 0,
                error: recovery,
            },
            offer: None,
            package: None,
        })
    })
}
pub fn state() -> UpdateStatus {
    runtime()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .status
        .clone()
}
fn change(update: impl FnOnce(&mut Runtime)) {
    update(&mut runtime().lock().unwrap_or_else(|e| e.into_inner()));
}
struct Lease;
impl Lease {
    fn take() -> Result<Self, String> {
        BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "An update task is already running.".to_owned())?;
        if state().phase == "installing" {
            BUSY.store(false, Ordering::Release);
            return Err("The update installer is already running.".into());
        }
        Ok(Self)
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}
fn failed(error: String) -> String {
    change(|r| {
        r.status.phase = "failed".into();
        r.status.error = Some(error.clone());
    });
    error
}

pub(crate) fn cache_root() -> Result<PathBuf, String> {
    let root = PathBuf::from(std::env::var_os("HOME").ok_or("The home directory is unavailable.")?)
        .join("Library/Caches/com.sogud.difflens/updates");
    fs::create_dir_all(&root).map_err(|_| "Cannot create the update cache.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    if fs::symlink_metadata(&root)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("The update cache must not be a symbolic link.".into());
    }
    root.canonicalize().map_err(|e| e.to_string())
}
fn new_directory() -> Result<PathBuf, String> {
    let mut bytes = [0u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "Cannot create a secure update identifier.")?;
    let path = cache_root()?.join(format!("job-{}", hex(&bytes)));
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(path)
}
pub(crate) fn validate_directory(path: &Path) -> Result<PathBuf, String> {
    let root = cache_root()?;
    let canonical = path
        .canonicalize()
        .map_err(|_| "The prepared update is missing.")?;
    if canonical.parent() != Some(root.as_path())
        || !canonical
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("job-"))
    {
        return Err("Invalid update directory.".into());
    }
    Ok(canonical)
}
fn gh_path() -> Option<PathBuf> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin/gh"),
        PathBuf::from("/usr/local/bin/gh"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        paths.push(PathBuf::from(home).join(".local/bin/gh"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path).map(|p| p.join("gh")));
    }
    paths.into_iter().find(|p| p.is_file())
}

// Authentication stays inside gh; no token is extracted or included in a URL, log or state.
fn fetch(
    endpoint: &str,
    binary: bool,
    destination: &Path,
    maximum: u64,
    progress: bool,
) -> Result<(), String> {
    if !endpoint.starts_with(&format!("repos/{}/releases", config().repository))
        || endpoint.contains(['\n', '\r', '\0'])
    {
        return Err("Invalid GitHub update endpoint.".into());
    }
    let mut command = if let Some(gh) = gh_path() {
        let mut command = Command::new(gh);
        command.args([
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            "-H",
            if binary {
                "Accept: application/octet-stream"
            } else {
                "Accept: application/vnd.github+json"
            },
            endpoint,
        ]);
        command
    } else {
        let mut command = Command::new("/usr/bin/curl");
        command.args([
            "--silent",
            "--show-error",
            "--fail",
            "--location",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--connect-timeout",
            "10",
            "--max-time",
            "180",
            "--max-filesize",
            &maximum.to_string(),
            "-H",
            if binary {
                "Accept: application/octet-stream"
            } else {
                "Accept: application/vnd.github+json"
            },
            &format!("https://api.github.com/{endpoint}"),
        ]);
        command
    };
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let output = options
        .open(destination)
        .map_err(|_| "Cannot create an update download.")?;
    let child = Arc::new(Mutex::new(
        command
            .stdout(Stdio::from(output))
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|_| "Cannot start the GitHub download client.")?,
    ));
    *ACTIVE_FETCH.lock().unwrap_or_else(|e| e.into_inner()) = Some(child.clone());
    let _guard = FetchGuard(child.clone());
    let started = Instant::now();
    loop {
        let received = fs::metadata(destination).map(|m| m.len()).unwrap_or(0);
        if progress {
            change(|r| r.status.received_bytes = received);
        }
        if received > maximum || started.elapsed() > Duration::from_secs(180) {
            let _ = fs::remove_file(destination);
            return Err(
                "The update download exceeded its size or time limit. Please retry.".into(),
            );
        }
        let observed = child.lock().unwrap_or_else(|e| e.into_inner()).try_wait();
        match observed {
            Ok(Some(status)) => {
                if !status.success() {
                    let _ = fs::remove_file(destination);
                    return Err("GitHub update access failed. Check the network; private Beta releases require GitHub CLI (gh), signed in with access to sogud/difflens.".into());
                }
                if fs::metadata(destination)
                    .map_err(|_| "The update download is missing.")?
                    .len()
                    > maximum
                {
                    let _ = fs::remove_file(destination);
                    return Err("The update download exceeded its size limit.".into());
                }
                if received == 0 {
                    return Err("GitHub returned an empty update download.".into());
                }
                return Ok(());
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(_) => return Err("Cannot observe the update download.".into()),
        }
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 || !value.is_ascii() {
        return Err("Invalid update signature encoding.".into());
    }
    (0..value.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&value[i..i + 2], 16)
                .map_err(|_| "Invalid update signature encoding.".into())
        })
        .collect()
}
pub(crate) fn read_manifest(directory: &Path) -> Result<Manifest, String> {
    let bytes = fs::read(directory.join("DiffLens-update.json"))
        .map_err(|_| "The update manifest is missing.")?;
    let signature_text = fs::read_to_string(directory.join("DiffLens-update.sig"))
        .map_err(|_| "The update signature is missing.")?;
    if bytes.len() > 32 * 1024 || signature_text.len() > 256 {
        return Err("The update manifest is too large.".into());
    }
    signature::UnparsedPublicKey::new(&signature::ED25519, unhex(&config().public_key)?)
        .verify(&bytes, &unhex(signature_text.trim())?)
        .map_err(|_| "The update signature is invalid. Nothing was installed.".to_owned())?;
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| "The signed update manifest is invalid.")?;
    let valid_tag = manifest.tag.len() <= 80
        && manifest.tag.starts_with('v')
        && manifest
            .tag
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b));
    if manifest.schema != 1
        || manifest.bundle_id != "com.sogud.difflens"
        || manifest.architecture != "arm64"
        || std::env::consts::ARCH != "aarch64"
        || manifest.minimum_system_version != "14.0"
        || !valid_tag
        || !(manifest.channel == "beta" || manifest.channel == "stable")
        || manifest.size == 0
        || manifest.size > MAX_ARCHIVE
        || manifest.sha256.len() != 64
        || unhex(&manifest.sha256)?.len() != 32
        || manifest.archive
            != format!(
                "DiffLens-{}-macos-arm64.zip",
                manifest.tag.trim_start_matches('v')
            )
    {
        return Err("The signed update is not compatible with this application.".into());
    }
    Ok(manifest)
}

pub fn check() -> Result<UpdateStatus, String> {
    let _lease = Lease::take()?;
    let result = (|| {
        installed_bundle()?;
        let _ = fs::remove_file(cache_root()?.join("last-install-error.txt"));
        let directory = new_directory()?;
        // Remove only our previous prepared job, never application settings or repositories.
        change(|r| {
            if let Some(old) = r.offer.take() {
                let _ = fs::remove_dir_all(old.directory);
            }
            r.package = None;
            r.status.phase = "checking".into();
            r.status.error = None;
            r.status.version = None;
            r.status.build = None;
            r.status.release_url = Some(format!(
                "https://github.com/{}/releases",
                config().repository
            ));
            r.status.received_bytes = 0;
            r.status.total_bytes = 0;
        });
        let outcome = (|| {
            fetch(
                &format!("repos/{}/releases?per_page=20", config().repository),
                false,
                &directory.join("releases.json"),
                2 * 1024 * 1024,
                false,
            )?;
            let releases: Vec<Release> = serde_json::from_slice(
                &fs::read(directory.join("releases.json")).map_err(|e| e.to_string())?,
            )
            .map_err(|_| "GitHub returned invalid release metadata.")?;
            let mut best: Option<Offer> = None;
            let mut examined = 0;
            for release in releases
                .into_iter()
                .filter(|r| !r.draft && (config().channel == "beta" || !r.prerelease))
            {
                let Some(manifest_asset) = release
                    .assets
                    .iter()
                    .find(|a| a.name == "DiffLens-update.json")
                else {
                    continue;
                };
                let Some(signature_asset) = release
                    .assets
                    .iter()
                    .find(|a| a.name == "DiffLens-update.sig")
                else {
                    continue;
                };
                if examined >= 5 {
                    break;
                }
                examined += 1;
                let candidate = directory.join(format!("candidate-{examined}"));
                fs::create_dir(&candidate).map_err(|e| e.to_string())?;
                fetch(
                    &format!(
                        "repos/{}/releases/assets/{}",
                        config().repository,
                        manifest_asset.id
                    ),
                    true,
                    &candidate.join("DiffLens-update.json"),
                    32 * 1024,
                    false,
                )?;
                fetch(
                    &format!(
                        "repos/{}/releases/assets/{}",
                        config().repository,
                        signature_asset.id
                    ),
                    true,
                    &candidate.join("DiffLens-update.sig"),
                    256,
                    false,
                )?;
                let manifest = read_manifest(&candidate)?;
                if config().channel != "beta" && manifest.channel != "stable" {
                    continue;
                }
                if manifest.tag != release.tag_name || manifest.build <= current_build() {
                    continue;
                }
                let Some(asset) = release
                    .assets
                    .into_iter()
                    .find(|a| a.name == manifest.archive && a.size == manifest.size)
                else {
                    return Err("The signed update archive is missing from its release.".into());
                };
                if best
                    .as_ref()
                    .is_none_or(|old| old.manifest.build < manifest.build)
                {
                    best = Some(Offer {
                        manifest,
                        asset,
                        directory: candidate,
                    });
                }
            }
            if let Some(mut offer) = best {
                for name in ["DiffLens-update.json", "DiffLens-update.sig"] {
                    fs::copy(offer.directory.join(name), directory.join(name))
                        .map_err(|e| e.to_string())?;
                }
                offer.directory = directory.clone();
                change(|r| {
                    r.status.phase = "available".into();
                    r.status.version = Some(offer.manifest.tag.trim_start_matches('v').to_owned());
                    r.status.build = Some(offer.manifest.build);
                    r.status.total_bytes = offer.manifest.size;
                    r.status.release_url = Some(format!(
                        "https://github.com/{}/releases/tag/{}",
                        config().repository,
                        offer.manifest.tag
                    ));
                    r.offer = Some(offer);
                });
                Ok(true)
            } else {
                change(|r| r.status.phase = "current".into());
                Ok(false)
            }
        })();
        match outcome {
            Ok(true) => {}
            Ok(false) => {
                let _ = fs::remove_dir_all(&directory);
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&directory);
                return Err(error);
            }
        }
        Ok(state())
    })();
    result.map_err(failed)
}

pub(crate) fn verify_archive(path: &Path, manifest: &Manifest) -> Result<(), String> {
    if fs::metadata(path)
        .map_err(|_| "The downloaded archive is missing.")?
        .len()
        != manifest.size
    {
        return Err("The update archive size is incorrect.".into());
    }
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = digest::Context::new(&digest::SHA256);
    let mut bytes = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    if hex(hash.finish().as_ref()) != manifest.sha256 {
        return Err("The update archive checksum is invalid. Nothing was installed.".into());
    }
    let mut zip = zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
        .map_err(|_| "The update archive is invalid.")?;
    if zip.len() > 20_000 {
        return Err("The update archive has too many entries.".into());
    }
    let mut total = 0u64;
    for index in 0..zip.len() {
        let entry = zip
            .by_index_raw(index)
            .map_err(|_| "Cannot inspect the update archive.")?;
        let enclosed = entry
            .enclosed_name()
            .ok_or("Unsafe path in the update archive.")?;
        let mut parts = enclosed.components();
        let first = parts.next().ok_or("Empty path in the update archive.")?;
        let allowed = first.as_os_str() == "DiffLens.app"
            || (first.as_os_str() == "__MACOSX"
                && parts.next().is_none_or(|p| p.as_os_str() == "DiffLens.app"));
        if !allowed
            || entry.name().contains('\\')
            || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("Unsafe entry in the update archive.".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("The update archive is too large.")?;
        if total > 512 * 1024 * 1024 {
            return Err("The expanded update is too large.".into());
        }
    }
    Ok(())
}

pub fn download() -> Result<UpdateStatus, String> {
    let _lease = Lease::take()?;
    let result = (|| {
        let offer = runtime()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .offer
            .clone()
            .ok_or("Check for updates before downloading.")?;
        let directory = validate_directory(&offer.directory)?;
        let manifest = read_manifest(&directory)?;
        if manifest.build <= current_build() {
            return Err("The update is not newer than this application.".into());
        }
        change(|r| {
            r.status.phase = "downloading".into();
            r.status.received_bytes = 0;
            r.status.error = None;
        });
        let archive = directory.join(&manifest.archive);
        let _ = fs::remove_file(&archive);
        fetch(
            &format!(
                "repos/{}/releases/assets/{}",
                config().repository,
                offer.asset.id
            ),
            true,
            &archive,
            manifest.size,
            true,
        )?;
        verify_archive(&archive, &manifest)?;
        let extracted = directory.join("extracted");
        if extracted.exists() {
            fs::remove_dir_all(&extracted).map_err(|e| e.to_string())?;
        }
        fs::create_dir(&extracted).map_err(|e| e.to_string())?;
        run(
            &mut Command::new("/usr/bin/ditto")
                .args(["-x", "-k"])
                .arg(&archive)
                .arg(&extracted),
            "Cannot extract the update.",
        )?;
        let bundle = extracted.join("DiffLens.app");
        verify_bundle(&bundle, Some(&manifest))?;
        change(|r| {
            r.package = Some(Package {
                manifest: manifest.clone(),
                directory,
                bundle,
            });
            r.status.phase = "ready".into();
            r.status.received_bytes = manifest.size;
        });
        Ok(state())
    })();
    result.map_err(failed)
}

pub(crate) fn run(command: &mut Command, error: &str) -> Result<(), String> {
    let status = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| error.to_owned())?;
    if status.success() {
        Ok(())
    } else {
        Err(error.into())
    }
}
pub(crate) fn plist(bundle: &Path, field: &str) -> Result<String, String> {
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", field, "raw", "-o", "-"])
        .arg(bundle.join("Contents/Info.plist"))
        .output()
        .map_err(|_| "Cannot read the app bundle.")?;
    if !output.status.success() {
        return Err("The app bundle metadata is invalid.".into());
    }
    String::from_utf8(output.stdout)
        .map(|s| s.trim().to_owned())
        .map_err(|_| "The app bundle metadata is invalid.".into())
}
pub(crate) fn verify_bundle(bundle: &Path, manifest: Option<&Manifest>) -> Result<(), String> {
    if fs::symlink_metadata(bundle)
        .map_err(|_| "The app bundle is missing.")?
        .file_type()
        .is_symlink()
        || plist(bundle, "CFBundleIdentifier")? != "com.sogud.difflens"
        || plist(bundle, "CFBundleExecutable")? != "DiffLens"
    {
        return Err("The update is not a DiffLens app bundle.".into());
    }
    if let Some(manifest) = manifest {
        if plist(bundle, "CFBundleVersion")? != manifest.build.to_string()
            || plist(bundle, "CFBundleShortVersionString")? != manifest.version
        {
            return Err("The update bundle version does not match its signed manifest.".into());
        }
    }
    run(
        Command::new("/usr/bin/codesign")
            .args(["--verify", "--deep", "--strict"])
            .arg(bundle),
        "The app bundle signature is invalid.",
    )?;
    run(
        Command::new("/usr/bin/lipo")
            .args(["-verify_arch", "arm64"])
            .arg(bundle.join("Contents/MacOS/DiffLens")),
        "The update app does not support Apple Silicon.",
    )
}
pub(crate) fn installed_bundle() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("Application updates require macOS.".into());
    }
    let executable = std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .map_err(|_| "Cannot locate this app.")?;
    let bundle = executable
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or("Updates require an installed DiffLens.app.")?;
    if bundle.file_name().is_none_or(|n| n != "DiffLens.app")
        || plist(bundle, "CFBundleIdentifier")? != "com.sogud.difflens"
    {
        return Err("Updates require an installed DiffLens.app.".into());
    }
    let home_apps =
        PathBuf::from(std::env::var_os("HOME").ok_or("The home directory is unavailable.")?)
            .join("Applications");
    let parent = bundle.parent().ok_or("Cannot locate the app folder.")?;
    if parent != Path::new("/Applications") && parent != home_apps {
        return Err("Move DiffLens.app into Applications before installing updates.".into());
    }
    Ok(bundle.to_owned())
}
pub fn install() -> Result<(), String> {
    let _lease = Lease::take()?;
    let result = (|| {
        let package = runtime()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .package
            .clone()
            .ok_or("Download and verify an update before installing it.")?;
        let target = installed_bundle()?;
        crate::update_install::prepare(&package, &target)?;
        change(|r| r.status.phase = "installing".into());
        Ok(())
    })();
    result.map_err(failed)
}

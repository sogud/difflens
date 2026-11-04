//! Short-lived positive validation for read-only workdir access; writes always revalidate Git.
use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};

const CAPACITY: usize = 8;
const LIFETIME: Duration = Duration::from_secs(1);
static ROOTS: OnceLock<Mutex<VecDeque<Entry>>> = OnceLock::new();

#[derive(Clone, PartialEq, Eq)]
struct MetadataStamp {
    path: PathBuf,
    length: u64,
    modified: Option<SystemTime>,
    device: u64,
    inode: u64,
}
struct Entry {
    root: PathBuf,
    stamps: Vec<MetadataStamp>,
    validated: Instant,
}

fn stamp(path: &Path) -> Option<MetadataStamp> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() {
        return None;
    }
    #[cfg(unix)]
    let (device, inode) = {
        use std::os::unix::fs::MetadataExt;
        (metadata.dev(), metadata.ino())
    };
    #[cfg(not(unix))]
    let (device, inode) = (0, 0);
    Some(MetadataStamp {
        path: path.to_owned(),
        length: metadata.len(),
        modified: metadata.modified().ok(),
        device,
        inode,
    })
}

fn fingerprint(root: &Path) -> Option<Vec<MetadataStamp>> {
    let marker = root.join(".git");
    let mut stamps = vec![stamp(root)?, stamp(&marker)?];
    let metadata = fs::symlink_metadata(&marker).ok()?;
    let git_dir = if metadata.is_file() {
        if metadata.len() > 16 * 1024 {
            return None;
        }
        let text = fs::read_to_string(&marker).ok()?;
        let path = PathBuf::from(text.trim().strip_prefix("gitdir: ")?);
        (if path.is_absolute() {
            path
        } else {
            root.join(path)
        })
        .canonicalize()
        .ok()?
    } else if metadata.is_dir() {
        marker
    } else {
        return None;
    };
    stamps.push(stamp(&git_dir)?);
    let common_file = git_dir.join("commondir");
    let common = if common_file.exists() {
        let meta = stamp(&common_file)?;
        if meta.length > 16 * 1024 {
            return None;
        }
        stamps.push(meta);
        git_dir
            .join(fs::read_to_string(&common_file).ok()?.trim())
            .canonicalize()
            .ok()?
    } else {
        git_dir.clone()
    };
    for path in [common.join("config"), git_dir.join("config.worktree")] {
        if path.exists() {
            stamps.push(stamp(&path)?);
        }
    }
    Some(stamps)
}

pub(super) fn validate(requested: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(requested).map_err(|e| format!("Cannot open repository: {e}"))?;
    let observed = fingerprint(&root);
    let cache = ROOTS.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Some(stamps) = &observed {
        let mut entries = cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(index) = entries.iter().position(|entry| {
            entry.root == root && entry.stamps == *stamps && entry.validated.elapsed() < LIFETIME
        }) {
            let entry = entries.remove(index).expect("matched read scope");
            entries.push_back(entry);
            return Ok(root);
        }
    }
    let verified = super::git::validate_repository_root(&root)?;
    // Never cache an entry whose marker/config changed while Git resolved it.
    if let Some(stamps) = observed.filter(|before| fingerprint(&verified).as_ref() == Some(before))
    {
        let mut entries = cache.lock().unwrap_or_else(|e| e.into_inner());
        entries.retain(|entry| entry.root != verified);
        entries.push_back(Entry {
            root: verified.clone(),
            stamps,
            validated: Instant::now(),
        });
        while entries.len() > CAPACITY {
            entries.pop_front();
        }
    }
    Ok(verified)
}

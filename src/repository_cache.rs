//! Versioned local discovery snapshots. A stale writer cannot overwrite a newer scan.
use crate::RepositoryNode;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    hash::{Hash, Hasher},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Cache {
    version: u32,
    root: PathBuf,
    pub complete: bool,
    pub nodes: Vec<RepositoryNode>,
}
struct Entry {
    generation: u64,
    cache: Cache,
}
static MEMORY: Mutex<BTreeMap<PathBuf, Entry>> = Mutex::new(BTreeMap::new());

fn filename(root: &Path, data: &Path) -> PathBuf {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    root.hash(&mut hash);
    data.join("repository-cache-v1")
        .join(format!("{:016x}.json", hash.finish()))
}

pub(super) fn load(root: &Path, data: Option<&Path>) -> Result<Option<Cache>, String> {
    if let Some(entry) = MEMORY.lock().map_err(|error| error.to_string())?.get(root) {
        return Ok(Some(entry.cache.clone()));
    }
    let Some(data) = data else {
        return Ok(None);
    };
    let file = filename(root, data);
    let metadata = match file.metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.len() > 16 * 1024 * 1024 {
        return Err("The repository cache exceeds its size limit.".to_owned());
    }
    let mut cache: Cache =
        serde_json::from_slice(&fs::read(file).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    if cache.version != 1 || cache.root != root {
        return Err("The repository cache has an incompatible version or root.".to_owned());
    }
    cache.nodes.retain(|node| {
        let path = Path::new(&node.path);
        path.is_absolute()
            && path.starts_with(root)
            && !path
                .components()
                .any(|component| component == Component::ParentDir)
    });
    Ok(Some(cache))
}

pub(super) fn store(
    root: &Path,
    data: Option<&Path>,
    complete: bool,
    nodes: Vec<RepositoryNode>,
    generation: u64,
) -> Result<(), String> {
    let cache = Cache {
        version: 1,
        root: root.to_owned(),
        complete,
        nodes,
    };
    {
        let mut memory = MEMORY.lock().map_err(|error| error.to_string())?;
        if memory
            .get(root)
            .is_some_and(|entry| entry.generation > generation)
        {
            return Ok(());
        }
        memory.insert(
            root.to_owned(),
            Entry {
                generation,
                cache: cache.clone(),
            },
        );
    }
    let Some(data) = data else {
        return Ok(());
    };
    let file = filename(root, data);
    let directory = file.parent().ok_or("Invalid cache directory.")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    let temporary = file.with_extension(format!("{}-{generation}.tmp", std::process::id()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut output, &cache).map_err(|error| error.to_string())?;
    output.flush().map_err(|error| error.to_string())?;
    drop(output);
    let memory = MEMORY.lock().map_err(|error| error.to_string())?;
    if memory
        .get(root)
        .is_some_and(|entry| entry.generation > generation)
    {
        fs::remove_file(temporary).map_err(|error| error.to_string())?;
        return Ok(());
    }
    fs::rename(temporary, file).map_err(|error| error.to_string())
}

#[cfg(test)]
pub(super) fn forget_memory(root: &Path) {
    MEMORY.lock().unwrap().remove(root);
}

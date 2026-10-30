//! Cancellable discovery: publish usable repositories while a large tree is still being walked.
use crate::{RepositoryNode, ScanWarning, WorkspaceScan, git};
use ignore::{WalkBuilder, WalkState};
use nsh_core::prelude::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::Instant,
};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static JOBS: Mutex<BTreeMap<u64, Arc<Job>>> = Mutex::new(BTreeMap::new());

#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum ScanPhase {
    Running,
    Complete,
    Stopped,
    Failed,
}

/// One incremental directory scan. An unchanged revision has no repository payload.
#[derive(Clone, Debug, JsObject)]
pub struct ScanProgress {
    pub id: u64,
    pub revision: u64,
    pub phase: ScanPhase,
    pub visited_directories: usize,
    pub repository_count: usize,
    pub scan: WorkspaceScan,
    pub error: Option<String>,
    pub discovering: bool,
    pub inventory_complete: bool,
}

struct Data {
    revision: u64,
    nodes: BTreeMap<PathBuf, RepositoryNode>,
    observed: BTreeSet<PathBuf>,
    warnings: Vec<ScanWarning>,
    phase: ScanPhase,
    inventory_complete: bool,
    error: Option<String>,
}
struct Job {
    root: PathBuf,
    data_directory: Option<PathBuf>,
    discovering: bool,
    data: Mutex<Data>,
    cancelled: AtomicBool,
    visited: AtomicUsize,
    git_slots: Mutex<usize>,
    git_slot_available: Condvar,
}

struct GitPermit<'a>(&'a Job);
impl Drop for GitPermit<'_> {
    fn drop(&mut self) {
        let mut slots = self.0.git_slots.lock().expect("scan Git slots lock");
        *slots -= 1;
        self.0.git_slot_available.notify_one();
    }
}

impl Job {
    fn snapshot(&self, id: u64, known_revision: u64) -> Result<ScanProgress, String> {
        let data = self.data.lock().map_err(|error| error.to_string())?;
        let changed = data.revision != known_revision;
        Ok(ScanProgress {
            id,
            revision: data.revision,
            phase: data.phase,
            visited_directories: self.visited.load(Ordering::Relaxed),
            repository_count: data.nodes.len(),
            scan: WorkspaceScan {
                root_path: self.root.to_string_lossy().into_owned(),
                repositories: if changed {
                    git::assemble_nodes(data.nodes.clone())
                } else {
                    Vec::new()
                },
                warnings: if changed {
                    data.warnings.clone()
                } else {
                    Vec::new()
                },
            },
            error: data.error.clone(),
            discovering: self.discovering,
            inventory_complete: data.inventory_complete,
        })
    }

    fn inspect(&self, path: &Path) {
        {
            let mut data = self.data.lock().expect("scan data lock");
            if !data.observed.insert(path.to_owned()) {
                return;
            }
        }
        let mut slots = self.git_slots.lock().expect("scan Git slots lock");
        while *slots >= 4 && !self.cancelled.load(Ordering::Relaxed) {
            slots = self
                .git_slot_available
                .wait(slots)
                .expect("scan Git slots lock");
        }
        if self.cancelled.load(Ordering::Relaxed) {
            return;
        }
        *slots += 1;
        drop(slots);
        let _permit = GitPermit(self);
        let node = git::repository_node(path, &self.root, Vec::new());
        let mut data = self.data.lock().expect("scan data lock");
        data.nodes.insert(path.to_owned(), node);
        data.revision += 1;
    }

    fn walk(&self) {
        let mut builder = WalkBuilder::new(&self.root);
        builder.standard_filters(false).follow_links(false).threads(
            std::thread::available_parallelism()
                .map_or(1, |n| n.get())
                .min(8),
        );
        builder.build_parallel().run(|| {
            Box::new(|result| {
                if self.cancelled.load(Ordering::Relaxed) {
                    return WalkState::Quit;
                }
                let entry = match result {
                    Ok(entry) => entry,
                    Err(error) => {
                        let mut data = self.data.lock().expect("scan data lock");
                        data.warnings.push(ScanWarning {
                            relative_path: ".".to_owned(),
                            message: error.to_string(),
                        });
                        data.revision += 1;
                        return WalkState::Continue;
                    }
                };
                let Some(kind) = entry.file_type() else {
                    return WalkState::Continue;
                };
                if kind.is_symlink() {
                    return WalkState::Skip;
                }
                if entry.file_name() == ".git" {
                    if entry.depth() > 0
                        && (kind.is_dir() || kind.is_file())
                        && let Some(parent) = entry.path().parent()
                    {
                        self.inspect(parent);
                    }
                    return WalkState::Skip;
                }
                if kind.is_dir() {
                    if entry.depth() > 0
                        && git::generated_directory(
                            entry.file_name(),
                            entry.path().parent().unwrap_or(&self.root),
                        )
                    {
                        return WalkState::Skip;
                    }
                    self.visited.fetch_add(1, Ordering::Relaxed);
                }
                WalkState::Continue
            })
        });
    }

    fn refresh_known(&self) {
        let paths: Vec<_> = self
            .data
            .lock()
            .expect("scan data lock")
            .nodes
            .keys()
            .cloned()
            .collect();
        let next = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..paths.len().min(4) {
                scope.spawn(|| {
                    loop {
                        if self.cancelled.load(Ordering::Relaxed) {
                            break;
                        }
                        let index = next.fetch_add(1, Ordering::Relaxed);
                        let Some(path) = paths.get(index) else {
                            break;
                        };
                        if let Ok(path) = std::fs::canonicalize(path) {
                            if path.starts_with(&self.root) && marker(&path) {
                                self.inspect(&path);
                            }
                        }
                        self.visited.fetch_add(1, Ordering::Relaxed);
                    }
                });
            }
        });
    }

    fn persist(&self, id: u64) {
        let (complete, nodes) = {
            let data = self.data.lock().expect("scan data lock");
            (
                data.inventory_complete,
                data.nodes.values().cloned().collect(),
            )
        };
        if let Err(error) = crate::repository_cache::store(
            &self.root,
            self.data_directory.as_deref(),
            complete,
            nodes,
            id,
        ) {
            crate::diagnostics::event(
                "warn",
                "cache.save.failed",
                serde_json::json!({ "error": error }),
            );
        }
    }

    fn finish(&self, id: u64) {
        {
            let mut data = self.data.lock().expect("scan data lock");
            if !self.cancelled.load(Ordering::Relaxed) {
                let observed = data.observed.clone();
                data.nodes.retain(|path, _| observed.contains(path));
                if self.discovering {
                    data.inventory_complete = true;
                }
            }
        }
        self.persist(id);
        let mut data = self.data.lock().expect("scan data lock");
        data.phase = if self.cancelled.load(Ordering::Relaxed) {
            ScanPhase::Stopped
        } else {
            ScanPhase::Complete
        };
        data.revision += 1;
    }
}

fn marker(path: &Path) -> bool {
    std::fs::symlink_metadata(path.join(".git")).is_ok_and(|metadata| {
        let kind = metadata.file_type();
        !kind.is_symlink() && (kind.is_dir() || kind.is_file())
    })
}

pub(super) fn start(
    root: PathBuf,
    preferred: Option<PathBuf>,
    rescan: bool,
    data_directory: Option<PathBuf>,
) -> Result<ScanProgress, String> {
    let root = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err("Choose a workspace directory.".to_owned());
    }
    git::ensure_git_available()?;
    let cached = match crate::repository_cache::load(&root, data_directory.as_deref()) {
        Ok(cached) => cached,
        Err(error) => {
            crate::diagnostics::event(
                "warn",
                "cache.load.failed",
                serde_json::json!({ "error": error }),
            );
            None
        }
    };
    let discovering = rescan || cached.is_none();
    let inventory_complete = !discovering && cached.as_ref().is_some_and(|cache| cache.complete);
    let mut nodes = BTreeMap::new();
    if let Some(cached) = cached {
        for mut node in cached.nodes {
            node.cached = true;
            node.children.clear();
            nodes.insert(PathBuf::from(&node.path), node);
        }
    }
    let job = Arc::new(Job {
        root: root.clone(),
        data_directory,
        discovering,
        data: Mutex::new(Data {
            revision: 1,
            nodes,
            observed: BTreeSet::new(),
            warnings: Vec::new(),
            phase: ScanPhase::Running,
            inventory_complete,
            error: None,
        }),
        cancelled: AtomicBool::new(false),
        visited: AtomicUsize::new(0),
        git_slots: Mutex::new(0),
        git_slot_available: Condvar::new(),
    });
    if marker(&root) {
        job.inspect(&root);
    }
    if let Some(path) = preferred.and_then(|path| std::fs::canonicalize(path).ok()) {
        if path.starts_with(&root) && marker(&path) {
            job.inspect(&path);
        }
    }
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    JOBS.lock()
        .map_err(|error| error.to_string())?
        .insert(id, job.clone());
    let initial = job.snapshot(id, 0)?;
    std::thread::spawn(move || {
        let started = Instant::now();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if job.discovering {
                job.walk();
            } else {
                job.refresh_known();
            }
            job.finish(id);
        }));
        if result.is_err() {
            job.cancelled.store(true, Ordering::Relaxed);
            job.git_slot_available.notify_all();
            if let Ok(mut data) = job.data.lock() {
                data.phase = ScanPhase::Failed;
                data.error = Some("Background scan failed. Open the logs for details.".to_owned());
                data.revision += 1;
            }
        }
        crate::diagnostics::event(
            if result.is_err() { "error" } else { "info" },
            "scan.background.ended",
            serde_json::json!({ "id": id, "durationMs": started.elapsed().as_millis() as u64, "cancelled": job.cancelled.load(Ordering::Relaxed), "failed": result.is_err() }),
        );
    });
    Ok(initial)
}

pub(super) fn progress(id: u64, known_revision: u64) -> Result<ScanProgress, String> {
    let job = JOBS
        .lock()
        .map_err(|error| error.to_string())?
        .get(&id)
        .cloned()
        .ok_or("This scan is no longer active.")?;
    let snapshot = job.snapshot(id, known_revision)?;
    if snapshot.phase != ScanPhase::Running {
        JOBS.lock().map_err(|error| error.to_string())?.remove(&id);
    }
    Ok(snapshot)
}

pub(super) fn stop(id: u64) -> Result<(), String> {
    let job = JOBS.lock().map_err(|error| error.to_string())?.remove(&id);
    if let Some(job) = job {
        job.cancelled.store(true, Ordering::Relaxed);
        job.git_slot_available.notify_all();
        job.persist(id);
    }
    Ok(())
}

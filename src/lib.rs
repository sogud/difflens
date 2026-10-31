use nsh_core::prelude::*;
use std::path::PathBuf;

mod code_diff;
pub mod diagnostics;
mod files;
mod git;
mod history;
mod operations;
pub mod updates;
pub mod update_install;
pub use updates::UpdateStatus;
pub use operations::{
    GitContext, GitOperationOutcome, GitOperationPlan, GitOperationRequest, GitReference, GitStash,
};
mod repository_cache;
mod scan_jobs;
mod scan_rules;
use diagnostics::DiagnosticsInfo;
use files::{FileEntry, FilePreview};
use scan_jobs::ScanProgress;

#[cfg(test)]
mod tests;

#[native_module("difflens/native")]
fn native(registry: &mut Registry) {
    registry.module::<Workspace>();
    registry.module::<Diagnostics>();
    registry.module::<Updater>();
    registry.register::<code_diff::CodeDiff>();
}

/// Workspace discovery and selected-repository Git operations.
#[module]
pub struct Workspace;

#[module]
impl Workspace {
    /// Creates a new repository or clones into a new directory after an explicit UI request.
    pub async fn setup_repository(
        parent_path: String,
        name: String,
        url: String,
        clone: bool,
    ) -> Result<WorkspaceScan, String> {
        background("workspace.setup_repository", move || {
            let parent = std::fs::canonicalize(parent_path).map_err(|e| e.to_string())?;
            if !parent.is_dir() || name.is_empty() || name.trim() != name || name.starts_with('-') || std::path::Path::new(&name).components().any(|part| !matches!(part, std::path::Component::Normal(_))) || std::path::Path::new(&name).components().count() != 1 {
                return Err("Choose an existing parent folder and a single new directory name.".into());
            }
            let destination = parent.join(&name);
            if destination.exists() { return Err("The destination already exists. Choose a new directory name.".into()); }
            if clone {
                let url = url.trim();
                let ordinary_url = ["https://", "http://", "ssh://", "git://", "file://"].iter().any(|prefix| url.starts_with(prefix));
                if url.is_empty() || url.starts_with('-') || (url.contains("::") && !ordinary_url) || url.contains(['\n', '\r', '\0']) {
                    return Err("Enter a Git URL or a local repository path; remote helper commands are not accepted.".into());
                }
                std::fs::create_dir(&destination).map_err(|e| format!("Cannot reserve the new directory: {e}"))?;
                git::run_git(&parent, &["clone", "--", url, destination.to_str().ok_or("The destination is not valid UTF-8.")?])?;
            } else {
                std::fs::create_dir(&destination).map_err(|e| format!("Cannot reserve the new directory: {e}"))?;
                git::run_git(&parent, &["init", "--initial-branch=main", "--", destination.to_str().ok_or("The destination is not valid UTF-8.")?])?;
            }
            git::open_repository(destination)
        }).await
    }

    /// Opens a contained working file in the system editor, including conflict resolution files.
    pub async fn open_working_file(
        repository_path: String,
        file_path: String,
    ) -> Result<(), String> {
        background("files.open_editor", move || {
            operations::open_file(PathBuf::from(repository_path), file_path)
        })
        .await
    }

    /// Reads local/remote references, stashes and resumable Git state without changing it.
    pub async fn git_context(repository_path: String) -> Result<GitContext, String> {
        background("workspace.git_context", move || {
            operations::context(PathBuf::from(repository_path))
        })
        .await
    }

    /// Validates a requested operation and captures the exact HEAD/target for confirmation.
    pub async fn prepare_operation(
        repository_path: String,
        request: GitOperationRequest,
    ) -> Result<GitOperationPlan, String> {
        background("workspace.prepare_operation", move || {
            operations::prepare(PathBuf::from(repository_path), request)
        })
        .await
    }

    /// Revalidates a confirmed plan, then reports completed/paused/failed with fresh data.
    pub async fn execute_operation(
        repository_path: String,
        plan: GitOperationPlan,
    ) -> Result<GitOperationOutcome, String> {
        background("workspace.execute_operation", move || {
            operations::execute(PathBuf::from(repository_path), plan)
        })
        .await
    }

    /// Opens the system folder picker; cancellation leaves the library unchanged.
    pub async fn choose_folder(title: String) -> Result<Option<String>, String> {
        let folder = rfd::AsyncFileDialog::new()
            .set_title(title)
            .set_can_create_directories(false)
            .pick_folder()
            .await;
        folder
            .map(|folder| {
                folder
                    .path()
                    .to_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "The selected path is not valid UTF-8.".to_owned())
            })
            .transpose()
    }

    /// Opens one existing repository, resolving a selected subfolder to its root.
    pub async fn open_repository(folder_path: String) -> Result<WorkspaceScan, String> {
        background("workspace.open_repository", move || {
            git::open_repository(PathBuf::from(folder_path))
        })
        .await
    }

    /// Opens a saved folder in the system file manager.
    pub async fn reveal_directory(folder_path: String) -> Result<(), String> {
        background("workspace.reveal_directory", move || {
            let path = std::fs::canonicalize(folder_path).map_err(|error| error.to_string())?;
            if !path.is_dir() {
                return Err("This path is not a folder.".to_owned());
            }
            #[cfg(target_os = "macos")]
            let program = "open";
            #[cfg(target_os = "windows")]
            let program = "explorer";
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let program = "xdg-open";
            let status = std::process::Command::new(program)
                .arg(path)
                .status()
                .map_err(|error| format!("Cannot open the folder: {error}"))?;
            if !status.success() {
                return Err("The file manager could not open this folder.".to_owned());
            }
            Ok(())
        })
        .await
    }

    /// Starts a cancellable directory scan and returns immediately with cached or initial repositories.
    pub async fn start_scan(
        root_path: String,
        preferred_path: Option<String>,
        rescan: bool,
        data_directory: Option<String>,
    ) -> Result<ScanProgress, String> {
        background("workspace.start_scan", move || {
            scan_jobs::start(
                PathBuf::from(root_path),
                preferred_path.map(PathBuf::from),
                rescan,
                data_directory.map(PathBuf::from),
            )
        })
        .await
    }

    /// Reads incremental repositories; unchanged revisions omit their tree payload.
    pub fn scan_progress(id: u64, known_revision: u64) -> Result<ScanProgress, String> {
        scan_jobs::progress(id, known_revision)
    }

    /// Stops directory discovery and retains repositories already returned to the UI.
    pub fn stop_scan(id: u64) -> Result<(), String> {
        scan_jobs::stop(id)
    }

    /// Lists one folder for the selected repository's read-only file browser.
    pub async fn read_directory(
        repository_path: String,
        relative_path: String,
    ) -> Result<Vec<FileEntry>, String> {
        background("files.read_directory", move || {
            files::read_directory(PathBuf::from(repository_path), relative_path)
        })
        .await
    }

    /// Reads a bounded file preview without changing the worktree or index.
    pub async fn read_file(
        repository_path: String,
        relative_path: String,
    ) -> Result<FilePreview, String> {
        background("files.read_file", move || {
            files::read_file(PathBuf::from(repository_path), relative_path)
        })
        .await
    }

    /// Reads changes, branches, upstream state, and recent history for one repository.
    pub async fn inspect_repository(repository_path: String) -> Result<RepositoryDetails, String> {
        background("workspace.inspect_repository", move || {
            git::inspect_repository(PathBuf::from(repository_path))
        })
        .await
    }

    /// Returns a staged or working-tree diff for one changed file.
    pub async fn diff_file(
        repository_path: String,
        file_path: String,
        staged: bool,
    ) -> Result<String, String> {
        background("workspace.diff_file", move || {
            git::diff_file(PathBuf::from(repository_path), file_path, staged)
        })
        .await
    }

    /// Reads one bounded page from a fixed commit snapshot, without checking out commits.
    pub async fn history_page(
        repository_path: String,
        query: String,
        search_field: String,
        anchor: Option<String>,
        offset: u32,
    ) -> Result<HistoryPage, String> {
        background("history.page", move || {
            history::history_page(
                PathBuf::from(repository_path),
                query,
                search_field,
                anchor,
                offset,
            )
        })
        .await
    }

    /// Reads a commit and its changed files without touching the worktree or index.
    pub async fn inspect_commit(
        repository_path: String,
        commit_id: String,
    ) -> Result<CommitDetails, String> {
        background("history.inspect_commit", move || {
            history::inspect_commit(PathBuf::from(repository_path), commit_id)
        })
        .await
    }

    /// Reads a committed file against the first parent, or the empty tree for a root commit.
    pub async fn commit_diff(
        repository_path: String,
        commit_id: String,
        file_path: String,
    ) -> Result<String, String> {
        background("history.commit_diff", move || {
            history::commit_diff(PathBuf::from(repository_path), commit_id, file_path)
        })
        .await
    }

    /// Stages one currently changed file in the selected repository.
    pub async fn stage_file(
        repository_path: String,
        file_path: String,
    ) -> Result<RepositoryDetails, String> {
        background("workspace.stage_file", move || {
            git::stage_file(PathBuf::from(repository_path), file_path)
        })
        .await
    }

    /// Removes one staged file from the index without changing its worktree content.
    pub async fn unstage_file(
        repository_path: String,
        file_path: String,
    ) -> Result<RepositoryDetails, String> {
        background("workspace.unstage_file", move || {
            git::unstage_file(PathBuf::from(repository_path), file_path)
        })
        .await
    }

    /// Stages all non-ignored changes in the selected repository.
    pub async fn stage_all(repository_path: String) -> Result<RepositoryDetails, String> {
        background("workspace.stage_all", move || {
            git::stage_all(PathBuf::from(repository_path))
        })
        .await
    }

    /// Commits the selected repository's staged changes.
    pub async fn commit(
        repository_path: String,
        message: String,
    ) -> Result<RepositoryDetails, String> {
        background("workspace.commit", move || {
            git::commit(PathBuf::from(repository_path), message)
        })
        .await
    }

    /// Creates and switches to a local branch.
    pub async fn create_branch(
        repository_path: String,
        branch_name: String,
    ) -> Result<RepositoryDetails, String> {
        background("workspace.create_branch", move || {
            git::create_branch(PathBuf::from(repository_path), branch_name)
        })
        .await
    }

    /// Switches to an existing local branch without discarding local changes.
    pub async fn switch_branch(
        repository_path: String,
        branch_name: String,
    ) -> Result<RepositoryDetails, String> {
        background("workspace.switch_branch", move || {
            git::switch_branch(PathBuf::from(repository_path), branch_name)
        })
        .await
    }

    /// Fetches all configured remotes and prunes deleted remote-tracking branches.
    pub async fn fetch(repository_path: String) -> Result<RepositoryDetails, String> {
        background("workspace.fetch", move || {
            git::fetch(PathBuf::from(repository_path))
        })
        .await
    }

    /// Pulls the current upstream only when the update is a fast-forward.
    pub async fn pull(repository_path: String) -> Result<RepositoryDetails, String> {
        background("workspace.pull", move || {
            git::pull(PathBuf::from(repository_path))
        })
        .await
    }

    /// Pushes the current branch to its upstream, or configures origin for a new branch.
    pub async fn push(repository_path: String) -> Result<RepositoryDetails, String> {
        background("workspace.push", move || {
            git::push(PathBuf::from(repository_path))
        })
        .await
    }
}

/// Local logs, crash reports and runtime version details.
#[module]
pub struct Diagnostics;

#[module]
impl Diagnostics {
    /// Initializes local diagnostics in the installed runner or host data directory.
    pub async fn initialize(data_directory: Option<String>) -> Result<DiagnosticsInfo, String> {
        background("diagnostics.initialize", move || {
            diagnostics::initialize(data_directory.map(PathBuf::from))
        })
        .await
    }
    /// Opens the application log directory in the system file manager.
    pub async fn open_logs() -> Result<(), String> {
        background("diagnostics.open_logs", diagnostics::open_logs).await
    }
    /// Opens the operating system crash-report directory.
    pub async fn open_crash_reports() -> Result<(), String> {
        background(
            "diagnostics.open_crash_reports",
            diagnostics::open_crash_reports,
        )
        .await
    }
    /// Opens the newest available panic or native crash report.
    pub async fn open_latest_report() -> Result<(), String> {
        background(
            "diagnostics.open_latest_report",
            diagnostics::open_latest_report,
        )
        .await
    }
    /// Records an unexpected UI error without sending it off this machine.
    pub async fn record_ui_error(message: String) -> Result<(), String> {
        background("diagnostics.record_ui_error", move || {
            diagnostics::record_ui_error(message)
        })
        .await
    }
}

/// Signed GitHub Beta updates for the installed macOS application.
#[module]
pub struct Updater;

#[module]
impl Updater {
    /// Reads update progress without starting network work.
    pub fn state() -> UpdateStatus { updates::state() }
    /// Checks signed releases in the configured update channel.
    pub async fn check() -> Result<UpdateStatus, String> { background("updates.check", updates::check).await }
    /// Downloads and verifies the checked native offer.
    pub async fn download() -> Result<UpdateStatus, String> { background("updates.download", updates::download).await }
    /// Stages the verified app and prepares an exit-watching installer.
    pub async fn install() -> Result<(), String> { background("updates.install", updates::install).await }
    /// Acknowledges a restored first layout after an update launch.
    pub async fn mark_healthy() -> Result<(), String> { background("updates.startup", update_install::mark_healthy).await }
}

async fn background<T, F>(name: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let started = diagnostics::operation_started(name);
    let result = blocking(operation)
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
    diagnostics::operation_finished(name, started, result.as_ref().err().map(String::as_str));
    result
}

/// One complete workspace scan.
#[derive(Clone, Debug, JsObject)]
pub struct WorkspaceScan {
    pub root_path: String,
    pub repositories: Vec<RepositoryNode>,
    pub warnings: Vec<ScanWarning>,
}

/// A repository and the nearest repositories nested below it.
#[derive(Clone, Debug, JsObject, serde::Serialize, serde::Deserialize)]
pub struct RepositoryNode {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub head_label: String,
    pub changed_files: usize,
    pub staged_files: usize,
    pub unstaged_files: usize,
    pub untracked_files: usize,
    pub has_upstream: bool,
    pub ahead: usize,
    pub behind: usize,
    pub error: Option<String>,
    pub children: Vec<RepositoryNode>,
    #[serde(default)]
    pub cached: bool,
}

/// A selected repository's status and common local context.
#[derive(Clone, Debug, JsObject)]
pub struct RepositoryDetails {
    pub path: String,
    pub head_label: String,
    pub branch_name: Option<String>,
    pub has_commits: bool,
    pub has_upstream: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub remote_names: Vec<String>,
    pub changes: Vec<ChangedFile>,
    pub branches: Vec<String>,
    pub history: Vec<CommitSummary>,
    pub worktrees: Vec<WorktreeInfo>,
}

/// One file record from Git's porcelain status.
#[derive(Clone, Debug, JsObject)]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status_label: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
    pub actionable: bool,
}

/// A short item from the selected repository's recent history.
#[derive(Clone, Debug, JsObject)]
pub struct CommitSummary {
    pub id: String,
    pub short_id: String,
    pub subject: String,
    pub author: String,
    pub authored_at: String,
}

/// A bounded page in an immutable history query; current_tip_id detects newer history.
#[derive(Clone, Debug, JsObject)]
pub struct HistoryPage {
    pub commits: Vec<CommitSummary>,
    pub tip_id: Option<String>,
    pub current_tip_id: Option<String>,
    pub offset: u32,
    pub next_offset: Option<u32>,
    pub page_size: u32,
}

/// Immutable commit context, independent of the current worktree and index.
#[derive(Clone, Debug, JsObject)]
pub struct CommitDetails {
    pub id: String,
    pub short_id: String,
    pub author: String,
    pub authored_at: String,
    pub message: String,
    pub parent_ids: Vec<String>,
    pub files: Vec<CommitFile>,
}

#[derive(Clone, Debug, JsObject)]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
}

/// A directory the scanner could not read.
#[derive(Clone, Debug, JsObject)]
pub struct ScanWarning {
    pub relative_path: String,
    pub message: String,
}

/// One working directory registered with the selected repository's common Git data.
#[derive(Clone, Debug, JsObject)]
pub struct WorktreeInfo {
    pub path: String,
    pub head_label: String,
    pub is_current: bool,
    pub is_main: bool,
    pub is_bare: bool,
    pub locked: bool,
    pub prunable: bool,
    pub available: bool,
}

/// Runs the same read-only workspace scan for the local diagnostics CLI.
pub fn scan_read_only(path: PathBuf) -> Result<WorkspaceScan, String> {
    git::scan_workspace(path)
}

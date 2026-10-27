use super::{
    ChangedFile, CommitSummary, RepositoryDetails, RepositoryNode, ScanWarning, WorkspaceScan,
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
    str,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Instant,
};

struct RepositoryStatus {
    branch_head: String,
    branch_oid: String,
    head_label: String,
    upstream: Option<String>,
    ahead: usize,
    behind: usize,
    changes: Vec<ChangedFile>,
}

impl RepositoryStatus {
    fn has_commits(&self) -> bool {
        self.branch_oid != "(initial)"
    }

    fn staged_files(&self) -> usize {
        self.changes.iter().filter(|file| file.staged).count()
    }

    fn unstaged_files(&self) -> usize {
        self.changes
            .iter()
            .filter(|file| file.unstaged || file.untracked)
            .count()
    }

    fn untracked_files(&self) -> usize {
        self.changes.iter().filter(|file| file.untracked).count()
    }
}

enum RepositoryAction {
    StageFile(String),
    UnstageFile(String),
    StageAll,
    Commit(String),
    CreateBranch(String),
    SwitchBranch(String),
    Fetch,
    Pull,
    Push,
}

pub(super) fn open_repository(requested_path: PathBuf) -> Result<WorkspaceScan, String> {
    let folder =
        fs::canonicalize(requested_path).map_err(|error| format!("Cannot open folder: {error}"))?;
    if !folder.is_dir() {
        return Err("Choose a repository folder.".to_owned());
    }
    ensure_git_available()?;
    let output = run_git(&folder, &["rev-parse", "--show-toplevel"])
        .map_err(|error| format!("Cannot open a Git repository from this folder. If it contains repositories, use Add directory.\n{error}"))?;
    let root = PathBuf::from(String::from_utf8_lossy(&output).trim().to_owned());
    let root = validate_repository_root(&root)?;
    let repository = repository_node(&root, &root, Vec::new());
    if let Some(error) = &repository.error {
        return Err(error.clone());
    }
    Ok(WorkspaceScan {
        root_path: path_to_string(&root),
        repositories: vec![repository],
        warnings: Vec::new(),
    })
}

pub(super) fn scan_workspace(requested_root: PathBuf) -> Result<WorkspaceScan, String> {
    let root = fs::canonicalize(&requested_root)
        .map_err(|error| format!("Cannot open workspace folder: {error}"))?;
    if !root.is_dir() {
        return Err("The workspace path must be a folder.".to_owned());
    }
    ensure_git_available()?;

    let mut warnings = Vec::new();
    let mut statistics = DiscoveryStatistics::default();
    let started = Instant::now();
    let discovered = discover_repositories(&root, &mut warnings, &mut statistics);
    super::diagnostics::event(
        "info",
        "scan.discovery.finished",
        serde_json::json!({
            "directoriesVisited": statistics.directories,
            "repositoriesFound": statistics.repositories,
            "generatedDirectoriesSkipped": statistics.skipped,
            "durationMs": started.elapsed().as_millis() as u64,
        }),
    );
    let started = Instant::now();
    let repositories = read_discovered_repositories(discovered, &root);
    super::diagnostics::event(
        "info",
        "scan.status.finished",
        serde_json::json!({
            "durationMs": started.elapsed().as_millis() as u64,
        }),
    );
    Ok(WorkspaceScan {
        root_path: path_to_string(&root),
        repositories,
        warnings,
    })
}

pub(super) fn inspect_repository(requested_path: PathBuf) -> Result<RepositoryDetails, String> {
    let repository_path = validate_repository_root(&requested_path)?;
    inspect_repository_at(&repository_path)
}

pub(super) fn diff_file(
    requested_path: PathBuf,
    file_path: String,
    staged: bool,
) -> Result<String, String> {
    let repository_path = validate_repository_root(&requested_path)?;
    let status = read_status_at(&repository_path)?;
    let file = changed_file(&status, &file_path)?;
    ensure_actionable_file(file, &file_path)?;
    if file.conflicted {
        return Err("Resolve this conflict before opening a file diff.".to_owned());
    }
    if staged && !file.staged {
        return Err("This file has no staged changes.".to_owned());
    }
    if !staged && !file.unstaged && !file.untracked {
        return Err("This file has no working-tree changes.".to_owned());
    }

    let mut arguments = vec!["diff", "--no-ext-diff", "--no-color", "--unified=3"];
    if file.untracked && !staged {
        arguments.push("--no-index");
    } else if staged {
        arguments.push("--cached");
    }
    arguments.push("--");
    if file.untracked && !staged {
        arguments.push("/dev/null");
    }
    arguments.push(&file_path);

    run_git_diff(&repository_path, &arguments, file.untracked && !staged)
}

pub(super) fn stage_file(
    requested_path: PathBuf,
    file_path: String,
) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::StageFile(file_path))
}

pub(super) fn unstage_file(
    requested_path: PathBuf,
    file_path: String,
) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::UnstageFile(file_path))
}

pub(super) fn stage_all(requested_path: PathBuf) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::StageAll)
}

pub(super) fn commit(
    requested_path: PathBuf,
    message: String,
) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::Commit(message))
}

pub(super) fn create_branch(
    requested_path: PathBuf,
    branch_name: String,
) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::CreateBranch(branch_name))
}

pub(super) fn switch_branch(
    requested_path: PathBuf,
    branch_name: String,
) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::SwitchBranch(branch_name))
}

pub(super) fn fetch(requested_path: PathBuf) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::Fetch)
}

pub(super) fn pull(requested_path: PathBuf) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::Pull)
}

pub(super) fn push(requested_path: PathBuf) -> Result<RepositoryDetails, String> {
    perform_action(requested_path, RepositoryAction::Push)
}

#[derive(Default)]
struct DiscoveryStatistics {
    directories: usize,
    repositories: usize,
    skipped: usize,
}

struct DiscoveredRepository {
    path: PathBuf,
    children: Vec<DiscoveredRepository>,
}

// Generated trees can contain millions of files without holding source repositories.
// Explicitly choosing one as the scan root still scans it.
pub(super) fn generated_directory(name: &std::ffi::OsStr, parent: &Path) -> bool {
    if !super::scan_rules::generated(name, parent) {
        return false;
    }
    // An actual repository keeps its place even if its name resembles a build folder.
    !fs::symlink_metadata(parent.join(name).join(".git")).is_ok_and(|metadata| {
        let kind = metadata.file_type();
        !kind.is_symlink() && (kind.is_dir() || kind.is_file())
    })
}

fn read_discovered_repositories(
    discovered: Vec<DiscoveredRepository>,
    root: &Path,
) -> Vec<RepositoryNode> {
    fn collect(nodes: &[DiscoveredRepository], paths: &mut Vec<PathBuf>) {
        for node in nodes {
            paths.push(node.path.clone());
            collect(&node.children, paths);
        }
    }
    fn assemble(
        nodes: Vec<DiscoveredRepository>,
        summaries: &mut BTreeMap<PathBuf, RepositoryNode>,
    ) -> Vec<RepositoryNode> {
        nodes
            .into_iter()
            .map(|node| {
                let mut summary = summaries
                    .remove(&node.path)
                    .expect("every discovered repository was inspected");
                summary.children = assemble(node.children, summaries);
                summary
            })
            .collect()
    }
    let mut paths = Vec::new();
    collect(&discovered, &mut paths);
    let next = AtomicUsize::new(0);
    let summaries = Mutex::new(BTreeMap::new());
    // Bound filesystem and Git process pressure while keeping independent repositories parallel.
    let workers = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(4)
        .min(paths.len());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(path) = paths.get(index) else {
                        break;
                    };
                    let summary = repository_node(path, root, Vec::new());
                    summaries
                        .lock()
                        .expect("repository summaries lock")
                        .insert(path.clone(), summary);
                }
            });
        }
    });
    assemble(
        discovered,
        &mut summaries.into_inner().expect("repository summaries lock"),
    )
}

fn discover_repositories(
    root: &Path,
    warnings: &mut Vec<ScanWarning>,
    statistics: &mut DiscoveryStatistics,
) -> Vec<DiscoveredRepository> {
    use ignore::{WalkBuilder, WalkState};
    use std::collections::BTreeSet;
    let paths = Mutex::new(Vec::new());
    let issues = Mutex::new(Vec::new());
    let directories = AtomicUsize::new(0);
    let skipped = AtomicUsize::new(0);
    let mut walker = WalkBuilder::new(root);
    // Nested source repositories are frequently ignored by their parent Git repo.
    walker.standard_filters(false).follow_links(false).threads(
        std::thread::available_parallelism()
            .map_or(1, |n| n.get())
            .min(8),
    );
    walker.build_parallel().run(|| {
        Box::new(|result| {
            let entry = match result {
                Ok(entry) => entry,
                Err(error) => {
                    issues
                        .lock()
                        .expect("scan warnings lock")
                        .push(ScanWarning {
                            relative_path: ".".to_owned(),
                            message: error.to_string(),
                        });
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
                if (kind.is_dir() || kind.is_file())
                    && let Some(parent) = entry.path().parent()
                {
                    paths
                        .lock()
                        .expect("discovered paths lock")
                        .push(parent.to_owned());
                }
                return WalkState::Skip;
            }
            if kind.is_dir() {
                if entry.depth() > 0
                    && generated_directory(entry.file_name(), entry.path().parent().unwrap_or(root))
                {
                    skipped.fetch_add(1, Ordering::Relaxed);
                    return WalkState::Skip;
                }
                directories.fetch_add(1, Ordering::Relaxed);
            }
            WalkState::Continue
        })
    });
    warnings.extend(issues.into_inner().expect("scan warnings lock"));
    let mut paths = paths.into_inner().expect("discovered paths lock");
    paths.sort();
    paths.dedup();
    statistics.directories = directories.load(Ordering::Relaxed);
    statistics.skipped = skipped.load(Ordering::Relaxed);
    statistics.repositories = paths.len();
    let known: BTreeSet<_> = paths.iter().cloned().collect();
    let mut children: BTreeMap<PathBuf, Vec<DiscoveredRepository>> = BTreeMap::new();
    let mut roots = Vec::new();
    // Parents sort before their children, so assemble the forest in reverse order.
    for path in paths.into_iter().rev() {
        let mut nested = children.remove(&path).unwrap_or_default();
        nested.sort_by(|left, right| left.path.cmp(&right.path));
        let parent = path
            .ancestors()
            .skip(1)
            .find(|parent| known.contains(*parent))
            .map(Path::to_path_buf);
        let node = DiscoveredRepository {
            path,
            children: nested,
        };
        if let Some(parent) = parent {
            children.entry(parent).or_default().push(node);
        } else {
            roots.push(node);
        }
    }
    roots.sort_by(|left, right| left.path.cmp(&right.path));
    roots
}

pub(super) fn repository_node(
    directory: &Path,
    workspace_root: &Path,
    nested_repositories: Vec<RepositoryNode>,
) -> RepositoryNode {
    let repository_name = directory
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_to_string(directory));

    match read_repository_status(directory) {
        Ok(status) => {
            let changed_files = status.changes.len();
            let staged_files = status.staged_files();
            let unstaged_files = status.unstaged_files();
            let untracked_files = status.untracked_files();
            let has_upstream = status.upstream.is_some();
            RepositoryNode {
                path: path_to_string(directory),
                relative_path: relative_path(workspace_root, directory),
                name: repository_name,
                head_label: status.head_label,
                changed_files,
                staged_files,
                unstaged_files,
                untracked_files,
                has_upstream,
                ahead: status.ahead,
                behind: status.behind,
                error: None,
                children: nested_repositories,
                cached: false,
            }
        }
        Err(error) => RepositoryNode {
            path: path_to_string(directory),
            relative_path: relative_path(workspace_root, directory),
            name: repository_name,
            head_label: String::new(),
            changed_files: 0,
            staged_files: 0,
            unstaged_files: 0,
            untracked_files: 0,
            has_upstream: false,
            ahead: 0,
            behind: 0,
            error: Some(error),
            children: nested_repositories,
            cached: false,
        },
    }
}

pub(super) fn validate_repository_root(requested_path: &Path) -> Result<PathBuf, String> {
    let repository_path = fs::canonicalize(requested_path)
        .map_err(|error| format!("Cannot open repository: {error}"))?;
    if !repository_path.is_dir() {
        return Err("The repository path must be a folder.".to_owned());
    }

    match fs::symlink_metadata(repository_path.join(".git")) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() || !(file_type.is_dir() || file_type.is_file()) {
                return Err("This folder does not have a valid .git entry.".to_owned());
            }
        }
        Err(error) => {
            return Err(format!("This folder has no readable .git entry: {error}"));
        }
    }

    let resolved_root = run_git(&repository_path, &["rev-parse", "--show-toplevel"])?;
    let resolved_root = PathBuf::from(String::from_utf8_lossy(&resolved_root).trim().to_owned());
    let resolved_root = fs::canonicalize(&resolved_root)
        .map_err(|error| format!("Git returned an invalid repository path: {error}"))?;
    if resolved_root != repository_path {
        return Err("Git resolved this folder to a different repository.".to_owned());
    }

    Ok(repository_path)
}

fn read_repository_status(repository_path: &Path) -> Result<RepositoryStatus, String> {
    let repository_path = validate_repository_root(repository_path)?;
    read_status_at(&repository_path)
}

fn read_status_at(repository_path: &Path) -> Result<RepositoryStatus, String> {
    let output = run_git(
        repository_path,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    )?;
    parse_status(&output)
}

fn parse_status(output: &[u8]) -> Result<RepositoryStatus, String> {
    let mut branch_head = None;
    let mut branch_oid = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changes = Vec::new();
    let mut records = output.split(|byte| *byte == 0);

    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }

        if let Some(value) = record.strip_prefix(b"# branch.head ") {
            branch_head = Some(String::from_utf8_lossy(value).into_owned());
        } else if let Some(value) = record.strip_prefix(b"# branch.oid ") {
            branch_oid = Some(String::from_utf8_lossy(value).into_owned());
        } else if let Some(value) = record.strip_prefix(b"# branch.upstream ") {
            upstream = Some(String::from_utf8_lossy(value).into_owned());
        } else if let Some(value) = record.strip_prefix(b"# branch.ab ") {
            let mut counts = value
                .split(|byte| byte.is_ascii_whitespace())
                .filter(|part| !part.is_empty());
            ahead = parse_ahead_behind(counts.next(), b'+');
            behind = parse_ahead_behind(counts.next(), b'-');
        } else if record.starts_with(b"1 ") {
            let fields = split_fields(record, 9)?;
            changes.push(make_changed_file(
                fields[8],
                None,
                fields[1][0],
                fields[1][1],
                false,
                false,
            ));
        } else if record.starts_with(b"2 ") {
            let fields = split_fields(record, 10)?;
            let old_path = records.next();
            changes.push(make_changed_file(
                fields[9],
                old_path,
                fields[1][0],
                fields[1][1],
                false,
                false,
            ));
        } else if record.starts_with(b"u ") {
            let fields = split_fields(record, 11)?;
            changes.push(make_changed_file(
                fields[10],
                None,
                fields[1][0],
                fields[1][1],
                false,
                true,
            ));
        } else if let Some(path) = record.strip_prefix(b"? ") {
            changes.push(make_changed_file(path, None, b'.', b'.', true, false));
        }
    }

    let branch_head =
        branch_head.ok_or_else(|| "Git did not report the repository's HEAD.".to_owned())?;
    let branch_oid =
        branch_oid.ok_or_else(|| "Git did not report the repository's commit.".to_owned())?;
    let head_label = if branch_head == "(detached)" {
        let short_oid: String = branch_oid.chars().take(8).collect();
        format!("Detached · {short_oid}")
    } else if branch_oid == "(initial)" {
        format!("Unborn · {branch_head}")
    } else {
        branch_head.clone()
    };

    Ok(RepositoryStatus {
        branch_head,
        branch_oid,
        head_label,
        upstream,
        ahead,
        behind,
        changes,
    })
}

fn split_fields(record: &[u8], count: usize) -> Result<Vec<&[u8]>, String> {
    let fields: Vec<&[u8]> = record.splitn(count, |byte| *byte == b' ').collect();
    if fields.len() != count {
        return Err("Git returned an invalid porcelain status record.".to_owned());
    }
    Ok(fields)
}

fn make_changed_file(
    path: &[u8],
    old_path: Option<&[u8]>,
    index_status: u8,
    worktree_status: u8,
    untracked: bool,
    conflicted: bool,
) -> ChangedFile {
    let (path, mut actionable) = display_path(path);
    let old_path = old_path.map(|path| {
        let (display_path, old_path_is_actionable) = display_path(path);
        actionable &= old_path_is_actionable;
        display_path
    });
    let status_label = if untracked {
        "??".to_owned()
    } else if conflicted {
        format!("{}{}", index_status as char, worktree_status as char)
    } else {
        let mut label = String::new();
        if index_status != b'.' {
            label.push(index_status as char);
        }
        if worktree_status != b'.' {
            label.push(worktree_status as char);
        }
        label
    };

    ChangedFile {
        path,
        old_path,
        status_label,
        staged: !untracked && index_status != b'.',
        unstaged: !untracked && worktree_status != b'.',
        untracked,
        conflicted,
        actionable,
    }
}

fn display_path(path: &[u8]) -> (String, bool) {
    match str::from_utf8(path) {
        Ok(path) => (path.to_owned(), true),
        Err(_) => (String::from_utf8_lossy(path).into_owned(), false),
    }
}

fn parse_ahead_behind(value: Option<&[u8]>, prefix: u8) -> usize {
    let Some(value) = value else {
        return 0;
    };
    let count = value.strip_prefix(&[prefix]).unwrap_or(value);
    str::from_utf8(count)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn inspect_repository_at(repository_path: &Path) -> Result<RepositoryDetails, String> {
    let status = read_status_at(repository_path)?;
    let branches = list_branches(repository_path)?;
    let remote_names = list_remotes(repository_path)?;
    let history = if status.has_commits() {
        read_history(repository_path)?
    } else {
        Vec::new()
    };

    let has_commits = status.has_commits();
    let has_upstream = status.upstream.is_some();
    let branch_name = if status.branch_head == "(detached)" {
        None
    } else {
        Some(status.branch_head.clone())
    };

    Ok(RepositoryDetails {
        path: path_to_string(repository_path),
        head_label: status.head_label,
        branch_name,
        has_commits,
        has_upstream,
        upstream: status.upstream,
        ahead: status.ahead,
        behind: status.behind,
        remote_names,
        changes: status.changes,
        branches,
        history,
        worktrees: list_worktrees(repository_path)?,
    })
}

fn list_branches(repository_path: &Path) -> Result<Vec<String>, String> {
    let output = run_git(repository_path, &["branch", "--format=%(refname:short)"])?;
    Ok(String::from_utf8_lossy(&output)
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(str::to_owned)
        .collect())
}

fn list_remotes(repository_path: &Path) -> Result<Vec<String>, String> {
    let output = run_git(repository_path, &["remote"])?;
    Ok(String::from_utf8_lossy(&output)
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .map(str::to_owned)
        .collect())
}

fn read_history(repository_path: &Path) -> Result<Vec<CommitSummary>, String> {
    let output = run_git(
        repository_path,
        &["log", "-n", "20", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"],
    )?;
    let mut history = Vec::new();
    for line in String::from_utf8_lossy(&output).lines() {
        let fields: Vec<&str> = line.splitn(5, '\u{1f}').collect();
        if fields.len() == 5 {
            history.push(CommitSummary {
                id: fields[0].to_owned(),
                short_id: fields[1].to_owned(),
                author: fields[2].to_owned(),
                authored_at: fields[3].to_owned(),
                subject: fields[4].to_owned(),
            });
        }
    }
    Ok(history)
}

fn changed_file<'a>(
    status: &'a RepositoryStatus,
    file_path: &str,
) -> Result<&'a ChangedFile, String> {
    validate_relative_file_path(file_path)?;
    status
        .changes
        .iter()
        .find(|file| file.path == file_path)
        .ok_or_else(|| "This file is no longer changed in the selected repository.".to_owned())
}

fn ensure_actionable_file(file: &ChangedFile, file_path: &str) -> Result<(), String> {
    if !file.actionable {
        return Err("Git returned a file path that cannot be represented safely.".to_owned());
    }
    validate_relative_file_path(file_path)?;
    if let Some(old_path) = &file.old_path {
        validate_relative_file_path(old_path)?;
    }
    Ok(())
}

fn validate_relative_file_path(file_path: &str) -> Result<(), String> {
    if file_path.is_empty() {
        return Err("Select a changed file first.".to_owned());
    }
    let path = Path::new(file_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("File paths must stay relative to the selected repository.".to_owned());
    }
    Ok(())
}

fn validate_branch_name(repository_path: &Path, branch_name: &str) -> Result<(), String> {
    if branch_name.is_empty() || branch_name.trim() != branch_name {
        return Err("Enter a branch name without leading or trailing spaces.".to_owned());
    }
    run_git(
        repository_path,
        &["check-ref-format", "--branch", branch_name],
    )?;
    Ok(())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn perform_action(
    requested_path: PathBuf,
    action: RepositoryAction,
) -> Result<RepositoryDetails, String> {
    let repository_path = validate_repository_root(&requested_path)?;

    match action {
        RepositoryAction::StageFile(file_path) => {
            let status = read_status_at(&repository_path)?;
            let file = changed_file(&status, &file_path)?;
            ensure_actionable_file(file, &file_path)?;
            if file.conflicted {
                return Err("Resolve this conflict before staging it.".to_owned());
            }
            if file.staged && !file.unstaged && !file.untracked {
                return Err("This file is already staged.".to_owned());
            }
            run_git_with_literal_pathspecs(&repository_path, &["add", "--", file_path.as_str()])?;
        }
        RepositoryAction::UnstageFile(file_path) => {
            let status = read_status_at(&repository_path)?;
            let file = changed_file(&status, &file_path)?;
            ensure_actionable_file(file, &file_path)?;
            if file.conflicted {
                return Err("Resolve this conflict before unstaging it.".to_owned());
            }
            if !file.staged {
                return Err("This file has no staged changes.".to_owned());
            }

            if !status.has_commits() {
                // An unborn branch has no HEAD tree to restore the index from.
                run_git_with_literal_pathspecs(
                    &repository_path,
                    &["rm", "--cached", "--force", "--", file_path.as_str()],
                )?;
            } else {
                let mut arguments = vec!["restore", "--staged", "--"];
                if let Some(old_path) = &file.old_path {
                    arguments.push(old_path);
                }
                arguments.push(&file_path);
                run_git_with_literal_pathspecs(&repository_path, &arguments)?;
            }
        }
        RepositoryAction::StageAll => {
            let status = read_status_at(&repository_path)?;
            if status.changes.iter().any(|file| file.conflicted) {
                return Err("Resolve conflicts before staging all files.".to_owned());
            }
            run_git(&repository_path, &["add", "--all"])?;
        }
        RepositoryAction::Commit(message) => {
            let message = message.trim();
            if message.is_empty() {
                return Err("Enter a commit message.".to_owned());
            }
            let status = read_status_at(&repository_path)?;
            if status.staged_files() == 0 {
                return Err("Stage at least one file before committing.".to_owned());
            }
            run_git(&repository_path, &["commit", "--message", message])?;
        }
        RepositoryAction::CreateBranch(branch_name) => {
            validate_branch_name(&repository_path, &branch_name)?;
            run_git(
                &repository_path,
                &["switch", "--create", branch_name.as_str()],
            )?;
        }
        RepositoryAction::SwitchBranch(branch_name) => {
            validate_branch_name(&repository_path, &branch_name)?;
            run_git(&repository_path, &["switch", branch_name.as_str()])?;
        }
        RepositoryAction::Fetch => {
            if list_remotes(&repository_path)?.is_empty() {
                return Err("Configure a remote before fetching.".to_owned());
            }
            run_git(&repository_path, &["fetch", "--all", "--prune"])?;
        }
        RepositoryAction::Pull => {
            let status = read_status_at(&repository_path)?;
            if status.upstream.is_none() {
                return Err("Set an upstream branch before pulling.".to_owned());
            }
            run_git(&repository_path, &["pull", "--ff-only"])?;
        }
        RepositoryAction::Push => {
            let status = read_status_at(&repository_path)?;
            if status.upstream.is_some() {
                run_git(&repository_path, &["push"])?;
            } else {
                let remotes = list_remotes(&repository_path)?;
                let remote = if remotes.iter().any(|remote| remote == "origin") {
                    "origin"
                } else if remotes.len() == 1 {
                    remotes[0].as_str()
                } else if remotes.is_empty() {
                    return Err("Configure a remote before pushing.".to_owned());
                } else {
                    return Err("Set an upstream branch before pushing.".to_owned());
                };
                run_git(
                    &repository_path,
                    &["push", "--set-upstream", remote, "HEAD"],
                )?;
            }
        }
    }

    inspect_repository_at(&repository_path)
}

fn run_git(repository_path: &Path, arguments: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(repository_path)
        .args(arguments)
        .output()
        .map_err(|error| format!("Cannot start Git: {error}"))?;
    require_success(output)
}

fn run_git_with_literal_pathspecs(
    repository_path: &Path,
    arguments: &[&str],
) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .arg("--literal-pathspecs")
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(repository_path)
        .args(arguments)
        .output()
        .map_err(|error| format!("Cannot start Git: {error}"))?;
    require_success(output)
}

fn run_git_diff(
    repository_path: &Path,
    arguments: &[&str],
    difference_is_exit_one: bool,
) -> Result<String, String> {
    let output = Command::new("git")
        .arg("--literal-pathspecs")
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(repository_path)
        .args(arguments)
        .output()
        .map_err(|error| format!("Cannot start Git: {error}"))?;

    if output.status.success() || (difference_is_exit_one && output.status.code() == Some(1)) {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    Err(command_error(&output))
}

fn require_success(output: std::process::Output) -> Result<Vec<u8>, String> {
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(output.stdout)
}

fn command_error(output: &std::process::Output) -> String {
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if message.is_empty() {
        "Git operation failed.".to_owned()
    } else {
        message
    }
}

pub(super) fn ensure_git_available() -> Result<(), String> {
    let output = Command::new("git")
        .arg("--version")
        .output()
        .map_err(|error| format!("Cannot start Git: {error}"))?;
    if !output.status.success() {
        return Err("Git is installed but could not be started.".to_owned());
    }
    Ok(())
}

fn relative_path(workspace_root: &Path, path: &Path) -> String {
    let path = path
        .strip_prefix(workspace_root)
        .map(Path::to_path_buf)
        .unwrap_or_else(|_| path.to_path_buf());
    if path.as_os_str().is_empty() {
        return ".".to_owned();
    }
    path.to_string_lossy().into_owned()
}

fn list_worktrees(repository_path: &Path) -> Result<Vec<super::WorktreeInfo>, String> {
    let output = run_git(repository_path, &["worktree", "list", "--porcelain", "-z"])?;
    let mut worktrees = Vec::new();
    let mut record = Vec::new();
    for field in output.split(|byte| *byte == 0) {
        if !field.is_empty() {
            record.push(str::from_utf8(field).map_err(|_| "A worktree path is not valid UTF-8.")?);
            continue;
        }
        if record.is_empty() {
            continue;
        }
        let path = record
            .iter()
            .find_map(|field| field.strip_prefix("worktree "))
            .ok_or("Git returned an invalid worktree record.")?;
        let head = record
            .iter()
            .find_map(|field| field.strip_prefix("HEAD "))
            .unwrap_or("");
        let branch = record
            .iter()
            .find_map(|field| field.strip_prefix("branch refs/heads/"));
        let is_bare = record.contains(&"bare");
        let path_buf = PathBuf::from(path);
        let is_current =
            fs::canonicalize(&path_buf).is_ok_and(|canonical| canonical == repository_path);
        worktrees.push(super::WorktreeInfo {
            path: path.to_owned(),
            head_label: branch.map(str::to_owned).unwrap_or_else(|| {
                if is_bare {
                    "bare".to_owned()
                } else {
                    format!("detached@{}", &head[..head.len().min(8)])
                }
            }),
            is_current,
            is_main: worktrees.is_empty(),
            is_bare,
            locked: record
                .iter()
                .any(|field| *field == "locked" || field.starts_with("locked ")),
            prunable: record
                .iter()
                .any(|field| *field == "prunable" || field.starts_with("prunable ")),
            available: path_buf.is_dir() && !is_bare,
        });
        record.clear();
    }
    Ok(worktrees)
}

/// Rebuilds filesystem nesting without rereading any Git state.
pub(super) fn assemble_nodes(nodes: BTreeMap<PathBuf, RepositoryNode>) -> Vec<RepositoryNode> {
    let known: std::collections::BTreeSet<_> = nodes.keys().cloned().collect();
    let mut children: BTreeMap<PathBuf, Vec<RepositoryNode>> = BTreeMap::new();
    let mut roots = Vec::new();
    for (path, mut node) in nodes.into_iter().rev() {
        node.children = children.remove(&path).unwrap_or_default();
        node.children.sort_by(|a, b| a.path.cmp(&b.path));
        let parent = path
            .ancestors()
            .skip(1)
            .find(|parent| known.contains(*parent))
            .map(Path::to_path_buf);
        if let Some(parent) = parent {
            children.entry(parent).or_default().push(node);
        } else {
            roots.push(node);
        }
    }
    roots.sort_by(|a, b| a.path.cmp(&b.path));
    roots
}

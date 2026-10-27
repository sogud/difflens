use super::{RepositoryDetails, WorkspaceScan, git};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_TEMP_DIRECTORY: AtomicU64 = AtomicU64::new(1);

struct TemporaryTree {
    root: PathBuf,
}

impl TemporaryTree {
    fn new() -> Self {
        let sequence = NEXT_TEMP_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("difflens-test-{}-{sequence}", std::process::id()));
        fs::create_dir_all(&root).expect("create temporary test directory");
        Self { root }
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }
}

impl Drop for TemporaryTree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn git(repository: &Path, arguments: &[&str]) -> Output {
    Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(arguments)
        .output()
        .expect("run Git fixture command")
}

fn git_global(arguments: &[&str], path: &Path) -> Output {
    Command::new("git")
        .args(arguments)
        .arg(path)
        .output()
        .expect("run Git fixture command")
}

fn expect_success(output: Output) -> Vec<u8> {
    if !output.status.success() {
        panic!(
            "Git fixture command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    output.stdout
}

fn init_repository(path: &Path) {
    expect_success(git_global(&["init", "--initial-branch=main"], path));
    expect_success(git(path, &["config", "user.name", "Fixture User"]));
    expect_success(git(
        path,
        &["config", "user.email", "fixture@example.invalid"],
    ));
}

fn commit_file(repository: &Path, path: &str, contents: &str, message: &str) {
    let full_path = repository.join(path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).expect("create file parent");
    }
    fs::write(full_path, contents).expect("write fixture file");
    expect_success(git(repository, &["add", "--", path]));
    expect_success(git(repository, &["commit", "--message", message]));
}

fn ready_details(details: Result<RepositoryDetails, String>) -> RepositoryDetails {
    details.unwrap_or_else(|error| panic!("repository operation failed: {error}"))
}

fn ready_scan(scan: Result<WorkspaceScan, String>) -> WorkspaceScan {
    scan.unwrap_or_else(|error| panic!("workspace scan failed: {error}"))
}

#[test]
fn adding_a_repository_resolves_subfolders_without_scanning_nested_repositories() {
    let temporary = TemporaryTree::new();
    let outer = temporary.path("outer");
    let child = outer.join("packages/child");
    init_repository(&outer);
    commit_file(&outer, "src/main.rs", "fn main() {}\n", "outer baseline");
    init_repository(&child);
    let opened = ready_scan(git::open_repository(outer.join("src")));
    assert_eq!(
        opened.root_path,
        fs::canonicalize(&outer).unwrap().to_string_lossy()
    );
    assert_eq!(opened.repositories.len(), 1);
    assert!(opened.repositories[0].children.is_empty());
    assert!(opened.warnings.is_empty());

    let empty = temporary.path("empty");
    fs::create_dir(&empty).unwrap();
    let error = git::open_repository(empty.clone()).unwrap_err();
    assert!(error.contains("Add directory"));
    assert!(
        ready_scan(git::scan_workspace(empty))
            .repositories
            .is_empty()
    );
}

#[test]
fn scan_keeps_nested_git_directories_and_files_in_the_repository_tree() {
    let temporary = TemporaryTree::new();
    let outer = temporary.path("workspace/outer");
    let nested_directory_repo = outer.join("packages/dir-repo");
    let nested_file_repo = outer.join("packages/file-repo");
    let separate_git_dir = temporary.path("git-metadata/file-repo.git");

    init_repository(&outer);
    commit_file(&outer, "README.md", "outer\n", "outer base");

    init_repository(&nested_directory_repo);
    commit_file(
        &nested_directory_repo,
        "README.md",
        "nested directory repo\n",
        "nested directory base",
    );

    fs::create_dir_all(nested_file_repo.parent().unwrap()).expect("create worktree parent");
    fs::create_dir_all(separate_git_dir.parent().unwrap())
        .expect("create separate metadata parent");
    expect_success(
        Command::new("git")
            .args(["init", "--initial-branch=main", "--separate-git-dir"])
            .arg(&separate_git_dir)
            .arg(&nested_file_repo)
            .output()
            .expect("initialize separate-git-dir repository"),
    );
    expect_success(git(
        &nested_file_repo,
        &["config", "user.name", "Fixture User"],
    ));
    expect_success(git(
        &nested_file_repo,
        &["config", "user.email", "fixture@example.invalid"],
    ));
    commit_file(
        &nested_file_repo,
        "README.md",
        "nested file repo\n",
        "nested file base",
    );

    let scan = ready_scan(git::scan_workspace(outer.clone()));
    assert_eq!(scan.repositories.len(), 1);
    let outer_node = &scan.repositories[0];
    assert_eq!(outer_node.relative_path, ".");
    assert_eq!(outer_node.children.len(), 2);
    assert!(
        outer_node
            .children
            .iter()
            .all(|repository| { repository.error.is_none() && repository.changed_files == 0 })
    );
    assert!(nested_file_repo.join(".git").is_file());
    assert!(nested_directory_repo.join(".git").is_dir());
}

#[test]
fn stage_unstage_commit_diff_and_branch_actions_work_on_a_fixture_repository() {
    let temporary = TemporaryTree::new();
    let repository = temporary.path("repo");
    init_repository(&repository);
    commit_file(&repository, "tracked.txt", "before\n", "base");

    fs::write(repository.join("tracked.txt"), "after\n").expect("modify tracked file");
    fs::write(repository.join(":(glob)*.txt"), "new file\n").expect("write pathspec fixture");

    let details = ready_details(git::inspect_repository(repository.clone()));
    assert!(
        details
            .changes
            .iter()
            .any(|file| file.unstaged && file.path == "tracked.txt")
    );
    assert!(
        details
            .changes
            .iter()
            .any(|file| file.untracked && file.path == ":(glob)*.txt")
    );

    let diff = git::diff_file(repository.clone(), "tracked.txt".to_owned(), false)
        .expect("read working-tree diff");
    assert!(diff.contains("-before"));
    assert!(diff.contains("+after"));

    let details = ready_details(git::stage_file(
        repository.clone(),
        ":(glob)*.txt".to_owned(),
    ));
    let staged_file = details
        .changes
        .iter()
        .find(|file| file.path == ":(glob)*.txt")
        .expect("find staged literal path");
    assert!(staged_file.staged);
    assert!(!staged_file.untracked);

    let details = ready_details(git::unstage_file(
        repository.clone(),
        ":(glob)*.txt".to_owned(),
    ));
    let unstaged_file = details
        .changes
        .iter()
        .find(|file| file.path == ":(glob)*.txt")
        .expect("find untracked file after unstage");
    assert!(unstaged_file.untracked);

    let details = ready_details(git::stage_all(repository.clone()));
    assert!(
        details
            .changes
            .iter()
            .all(|file| file.staged || file.conflicted)
    );
    let details = ready_details(git::commit(
        repository.clone(),
        "Add basic client changes".to_owned(),
    ));
    assert!(details.changes.is_empty());
    assert_eq!(
        details
            .history
            .first()
            .map(|commit| commit.subject.as_str()),
        Some("Add basic client changes")
    );

    let details = ready_details(git::create_branch(
        repository.clone(),
        "feature/client".to_owned(),
    ));
    assert_eq!(details.branch_name.as_deref(), Some("feature/client"));
    let details = ready_details(git::switch_branch(repository.clone(), "main".to_owned()));
    assert_eq!(details.branch_name.as_deref(), Some("main"));
}

#[test]
fn fetch_fast_forward_pull_and_push_work_with_a_local_bare_remote() {
    let temporary = TemporaryTree::new();
    let repository = temporary.path("repo");
    let remote = temporary.path("remote.git");
    let peer = temporary.path("peer");

    init_repository(&repository);
    commit_file(&repository, "README.md", "base\n", "base");
    expect_success(git_global(
        &["init", "--bare", "--initial-branch=main"],
        &remote,
    ));
    expect_success(git(
        &repository,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    ));

    let details = ready_details(git::push(repository.clone()));
    assert!(details.has_upstream);

    expect_success(
        Command::new("git")
            .args(["clone", remote.to_str().unwrap()])
            .arg(&peer)
            .output()
            .expect("clone temporary local remote"),
    );
    expect_success(git(&peer, &["config", "user.name", "Fixture Peer"]));
    expect_success(git(
        &peer,
        &["config", "user.email", "peer@example.invalid"],
    ));
    commit_file(&peer, "from-peer.txt", "peer change\n", "peer change");
    expect_success(git(&peer, &["push"]));

    let details = ready_details(git::fetch(repository.clone()));
    assert_eq!(details.behind, 1);
    let details = ready_details(git::pull(repository.clone()));
    assert_eq!(details.behind, 0);
    assert_eq!(
        fs::read_to_string(repository.join("from-peer.txt")).unwrap(),
        "peer change\n"
    );

    commit_file(
        &repository,
        "from-client.txt",
        "client change\n",
        "client change",
    );
    ready_details(git::push(repository.clone()));
    expect_success(git(&peer, &["fetch"]));
    assert_eq!(
        String::from_utf8_lossy(&git(&peer, &["rev-parse", "origin/main"]).stdout).trim(),
        String::from_utf8_lossy(&git(&repository, &["rev-parse", "HEAD"]).stdout).trim()
    );
}

#[test]
fn scan_skips_generated_trees_but_keeps_ignored_source_repos_and_explicit_cache_roots() {
    let temporary = TemporaryTree::new();
    let root = temporary.path("workspace");
    init_repository(&root);
    commit_file(&root, "Cargo.toml", "[workspace]\n", "workspace");
    commit_file(
        &root,
        ".gitignore",
        "packages/\nnode_modules/\n.pnpm-store/\n.nsh/\ntarget/\n",
        "ignore generated paths",
    );
    let source = root.join("packages/source");
    init_repository(&source);
    commit_file(&source, "README.md", "source\n", "source");
    // A source repository named target outside a Cargo package must still be found.
    let ordinary_target = root.join("examples/target");
    init_repository(&ordinary_target);
    commit_file(&ordinary_target, "README.md", "source\n", "source");
    for name in ["node_modules", ".pnpm-store", ".nsh", "target"] {
        let cached = root.join(name).join("cached-repository");
        init_repository(&cached);
        commit_file(&cached, "README.md", "cached\n", "cached");
    }
    let scan = ready_scan(git::scan_workspace(root.clone()));
    let children = &scan.repositories[0].children;
    assert_eq!(children.len(), 2);
    assert!(
        children
            .iter()
            .any(|node| Path::new(&node.path) == source.canonicalize().unwrap())
    );
    assert!(
        children
            .iter()
            .any(|node| Path::new(&node.path) == ordinary_target.canonicalize().unwrap())
    );
    assert!(children.iter().all(|node| node.error.is_none()));
    let explicit = ready_scan(git::scan_workspace(root.join(".pnpm-store")));
    assert_eq!(explicit.repositories.len(), 1);
    assert_eq!(explicit.repositories[0].name, "cached-repository");
    let opened = ready_scan(git::open_repository(
        root.join("node_modules/cached-repository"),
    ));
    assert_eq!(opened.repositories.len(), 1);
}

#[test]
fn associated_worktrees_include_external_paths_and_current_branch() {
    let temporary = TemporaryTree::new();
    let main = temporary.path("main");
    let linked = temporary.path("linked\nworktree");
    init_repository(&main);
    commit_file(&main, "README.md", "unchanged\n", "base");
    expect_success(git(
        &main,
        &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
    ));
    expect_success(git(&main, &["worktree", "lock", linked.to_str().unwrap()]));
    let details = git::inspect_repository(main.clone()).unwrap();
    assert_eq!(details.worktrees.len(), 2);
    assert!(
        details
            .worktrees
            .iter()
            .any(|tree| tree.is_main && tree.is_current)
    );
    let linked_path = linked.canonicalize().unwrap().to_str().unwrap().to_owned();
    let worktree = details
        .worktrees
        .iter()
        .find(|tree| tree.path == linked_path)
        .unwrap();
    assert_eq!(worktree.head_label, "feature");
    assert!(worktree.available && worktree.locked && !worktree.is_current);
    let details = git::inspect_repository(linked).unwrap();
    assert!(
        details
            .worktrees
            .iter()
            .any(|tree| tree.is_current && !tree.is_main && tree.head_label == "feature")
    );
}

#[test]
fn file_preview_reads_clean_text_and_rejects_path_escape() {
    let temporary = TemporaryTree::new();
    let root = temporary.path("repo");
    init_repository(&root);
    commit_file(&root, "docs/README.md", "未修改的文件\nread only\n", "base");
    let entries = super::files::read_directory(root.clone(), String::new()).unwrap();
    assert!(
        entries
            .iter()
            .any(|entry| entry.name == "docs" && entry.is_directory)
    );
    assert!(!entries.iter().any(|entry| entry.name == ".git"));
    let file = super::files::read_file(root.clone(), "docs/README.md".to_owned()).unwrap();
    assert_eq!(file.kind, super::files::PreviewKind::Text);
    assert_eq!(file.content, "未修改的文件\nread only\n");
    assert!(git(&root, &["status", "--porcelain"]).stdout.is_empty());
    assert!(super::files::read_file(root.clone(), "../outside.txt".to_owned()).is_err());
    assert!(super::files::read_file(root.clone(), ".git/config".to_owned()).is_err());
    #[cfg(unix)]
    {
        let external = temporary.path("outside.txt");
        fs::write(&external, "outside\n").unwrap();
        std::os::unix::fs::symlink(external, root.join("external.txt")).unwrap();
        assert!(super::files::read_file(root, "external.txt".to_owned()).is_err());
    }
}

#[test]
fn file_preview_reports_binary_and_large_files_without_loading_them_as_text() {
    let temporary = TemporaryTree::new();
    let root = temporary.path("repo");
    init_repository(&root);
    fs::write(root.join("binary.png"), [0, 255, 1]).unwrap();
    let binary = super::files::read_file(root.clone(), "binary.png".to_owned()).unwrap();
    assert_eq!(binary.kind, super::files::PreviewKind::Binary);
    assert_eq!(binary.size_bytes, 3);
    assert!(binary.content.is_empty());
    fs::File::create(root.join("large.txt"))
        .unwrap()
        .set_len(2 * 1024 * 1024 + 1)
        .unwrap();
    let large = super::files::read_file(root, "large.txt".to_owned()).unwrap();
    assert_eq!(large.kind, super::files::PreviewKind::TooLarge);
    assert!(large.content.is_empty());
}

#[test]
fn scan_does_not_follow_directory_symlinks_or_loops() {
    #[cfg(unix)]
    {
        let temporary = TemporaryTree::new();
        let root = temporary.path("root");
        let outside = temporary.path("outside");
        init_repository(&root);
        init_repository(&outside);
        std::os::unix::fs::symlink(&outside, root.join("external")).unwrap();
        std::os::unix::fs::symlink(&root, root.join("loop")).unwrap();
        let scan = ready_scan(git::scan_workspace(root));
        assert_eq!(scan.repositories.len(), 1);
        assert!(scan.repositories[0].children.is_empty());
    }
}

#[test]
fn incremental_scan_opens_preferred_repository_before_discovery_completes() {
    let temporary = TemporaryTree::new();
    let root = temporary.path("workspace");
    let child = root.join("packages/child");
    let sibling = root.join("other");
    init_repository(&root);
    init_repository(&child);
    init_repository(&sibling);
    let initial = super::scan_jobs::start(root, Some(child), true, None).unwrap();
    assert_eq!(initial.phase, super::scan_jobs::ScanPhase::Running);
    assert_eq!(initial.visited_directories, 0);
    assert_eq!(initial.repository_count, 2);
    assert_eq!(initial.scan.repositories[0].children.len(), 1);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let mut revision = initial.revision;
    loop {
        let progress = super::scan_jobs::progress(initial.id, revision).unwrap();
        revision = progress.revision;
        if progress.phase == super::scan_jobs::ScanPhase::Complete {
            assert_eq!(progress.repository_count, 3);
            assert_eq!(progress.scan.repositories[0].children.len(), 2);
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "scan did not complete"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[test]
fn incremental_scan_can_stop_and_prunes_stale_cached_repositories() {
    let temporary = TemporaryTree::new();
    let root = temporary.path("workspace");
    init_repository(&root);
    let first = super::scan_jobs::start(root.clone(), None, true, None).unwrap();
    super::scan_jobs::stop(first.id).unwrap();
    assert!(super::scan_jobs::progress(first.id, 0).is_err());
    let mut stale = first.scan.repositories[0].clone();
    stale.path = PathBuf::from(&first.scan.root_path)
        .join("removed")
        .to_string_lossy()
        .into_owned();
    stale.name = "removed".to_owned();
    stale.children.clear();
    let canonical = root.canonicalize().unwrap();
    super::repository_cache::store(&canonical, None, true, vec![stale], first.id + 1).unwrap();
    let scan = super::scan_jobs::start(root, None, true, None).unwrap();
    assert_eq!(scan.repository_count, 2);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let progress = super::scan_jobs::progress(scan.id, 0).unwrap();
        if progress.phase == super::scan_jobs::ScanPhase::Complete {
            assert_eq!(progress.repository_count, 1);
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "scan did not complete"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn finish_incremental_scan(id: u64) -> super::scan_jobs::ScanProgress {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let progress = super::scan_jobs::progress(id, 0).unwrap();
        if progress.phase == super::scan_jobs::ScanPhase::Complete {
            return progress;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "scan did not complete"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[test]
fn repository_cache_restores_from_disk_and_refreshes_known_paths_without_walking() {
    let temporary = TemporaryTree::new();
    let root = temporary.path("workspace");
    let data = temporary.path("app-data");
    init_repository(&root);
    init_repository(&root.join("packages/source"));
    let scan = super::scan_jobs::start(root.clone(), None, true, Some(data.clone())).unwrap();
    let completed = finish_incremental_scan(scan.id);
    assert_eq!(completed.repository_count, 2);
    assert!(completed.inventory_complete);
    assert_eq!(
        fs::read_dir(data.join("repository-cache-v1"))
            .unwrap()
            .count(),
        1
    );
    super::repository_cache::forget_memory(&root.canonicalize().unwrap());
    init_repository(&root.join("new-project"));
    let restored = super::scan_jobs::start(root.clone(), None, false, Some(data.clone())).unwrap();
    assert!(!restored.discovering);
    assert_eq!(restored.repository_count, 2);
    assert!(restored.scan.repositories[0].children[0].cached);
    let refreshed = finish_incremental_scan(restored.id);
    assert_eq!(refreshed.repository_count, 2);
    assert_eq!(refreshed.visited_directories, 2);
    let scan = super::scan_jobs::start(root, None, true, Some(data)).unwrap();
    assert_eq!(finish_incremental_scan(scan.id).repository_count, 3);
}

#[test]
fn development_directories_are_skipped_across_languages_without_hiding_source_repositories() {
    let temporary = TemporaryTree::new();
    let root = temporary.path("workspace");
    init_repository(&root);
    for manifest in [
        "package.json",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
        "composer.json",
        "mix.exs",
        "App.csproj",
    ] {
        fs::write(root.join(manifest), "fixture\n").unwrap();
    }
    for folder in [
        "node_modules",
        ".cache",
        ".venv",
        "__pycache__",
        ".next",
        "target",
        ".gradle",
        ".build",
        "Pods",
        ".dart_tool",
        ".nuget",
        "cmake-build-debug",
        "vendor",
        "bin",
        "obj",
        "_build",
        "deps",
    ] {
        init_repository(&root.join(folder).join("cached-repository"));
    }
    init_repository(&root.join("packages/source"));
    init_repository(&root.join("cache"));
    init_repository(&root.join("cache/nested-source"));
    let scan = ready_scan(git::scan_workspace(root));
    assert_eq!(scan.repositories[0].children.len(), 2);
    assert!(
        scan.repositories[0]
            .children
            .iter()
            .any(|node| node.name == "source")
    );
    let source_cache = scan.repositories[0]
        .children
        .iter()
        .find(|node| node.name == "cache")
        .unwrap();
    assert_eq!(source_cache.children.len(), 1);
    assert_eq!(source_cache.children[0].name, "nested-source");
}

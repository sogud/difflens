use super::*;
use crate::operations::{self, GitOperationOutcome, GitOperationRequest};

fn repository(tree: &TemporaryTree, name: &str) -> PathBuf {
    let root = tree.path(name);
    init_repository(&root);
    expect_success(git(&root, &["config", "core.hooksPath", "/dev/null"]));
    expect_success(git(&root, &["config", "commit.gpgsign", "false"]));
    commit_file(&root, "a.txt", "base\n", "base");
    root
}
fn request(kind: &str, target: &str) -> GitOperationRequest {
    GitOperationRequest {
        kind: kind.into(),
        target: target.into(),
        name: String::new(),
        message: String::new(),
        include_untracked: false,
        mainline: 0,
    }
}
fn run(root: &Path, request: GitOperationRequest) -> GitOperationOutcome {
    let plan = operations::prepare(root.into(), request).expect("prepare fixture operation");
    operations::execute(root.into(), plan).expect("execute fixture operation")
}
fn head(root: &Path) -> String {
    String::from_utf8(expect_success(git(root, &["rev-parse", "HEAD"])))
        .unwrap()
        .trim()
        .into()
}

#[test]
fn workflow_cherry_pick_and_revert_preserve_history() {
    let tree = TemporaryTree::new();
    let root = repository(&tree, "repo");
    expect_success(git(&root, &["switch", "-c", "feature"]));
    commit_file(&root, "feature.txt", "feature\n", "feature");
    let target = head(&root);
    expect_success(git(&root, &["switch", "main"]));
    let picked = run(&root, request("cherryPick", &target));
    assert_eq!(picked.status, "completed");
    assert!(root.join("feature.txt").exists());
    let reverted = run(&root, request("revert", &head(&root)));
    assert_eq!(reverted.status, "completed");
    assert!(!root.join("feature.txt").exists());
    assert_eq!(
        String::from_utf8(expect_success(git(&root, &["rev-list", "--count", "HEAD"])))
            .unwrap()
            .trim(),
        "3"
    );
}

#[test]
fn workflow_rebase_replays_current_branch_and_can_abort_conflicts() {
    let tree = TemporaryTree::new();
    let root = repository(&tree, "repo");
    expect_success(git(&root, &["switch", "-c", "feature"]));
    commit_file(&root, "feature.txt", "feature\n", "feature");
    let old = head(&root);
    expect_success(git(&root, &["switch", "main"]));
    commit_file(&root, "main.txt", "main\n", "main");
    let onto = head(&root);
    expect_success(git(&root, &["switch", "feature"]));
    let rebased = run(&root, request("rebase", "refs/heads/main"));
    assert_eq!(rebased.status, "completed");
    assert_ne!(head(&root), old);
    expect_success(git(&root, &["merge-base", "--is-ancestor", &onto, "HEAD"]));
    commit_file(&root, "a.txt", "feature\n", "feature edit");
    let before = head(&root);
    expect_success(git(&root, &["switch", "main"]));
    commit_file(&root, "a.txt", "main\n", "main edit");
    expect_success(git(&root, &["switch", "feature"]));
    let conflict = run(&root, request("rebase", "refs/heads/main"));
    assert_eq!(conflict.status, "paused");
    assert!(conflict.error.is_some());
    assert_eq!(conflict.context.operation.as_deref(), Some("rebase"));
    assert_eq!(conflict.context.conflicts, vec!["a.txt"]);
    let aborted = run(&root, request("abort", ""));
    assert_eq!(aborted.status, "completed");
    assert_eq!(head(&root), before);
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "feature\n");
}

#[test]
fn workflow_conflicted_cherry_pick_resolves_and_continues() {
    let tree = TemporaryTree::new();
    let root = repository(&tree, "repo");
    expect_success(git(&root, &["switch", "-c", "feature"]));
    commit_file(&root, "a.txt", "feature\n", "feature edit");
    let target = head(&root);
    expect_success(git(&root, &["switch", "main"]));
    commit_file(&root, "a.txt", "main\n", "main edit");
    let paused = run(&root, request("cherryPick", &target));
    assert_eq!(paused.status, "paused");
    assert!(operations::prepare(root.clone(), request("continue", "")).is_err());
    fs::write(root.join("a.txt"), "resolved\n").unwrap();
    assert_eq!(run(&root, request("resolve", "a.txt")).status, "completed");
    let resumed = run(&root, request("continue", ""));
    assert_eq!(resumed.status, "completed");
    assert!(resumed.context.operation.is_none());
    assert_eq!(
        fs::read_to_string(root.join("a.txt")).unwrap(),
        "resolved\n"
    );
}

#[test]
fn workflow_merge_conflict_aborts_without_changing_original_branch() {
    let tree = TemporaryTree::new();
    let root = repository(&tree, "repo");
    expect_success(git(&root, &["switch", "-c", "feature"]));
    commit_file(&root, "a.txt", "feature\n", "feature edit");
    expect_success(git(&root, &["switch", "main"]));
    commit_file(&root, "a.txt", "main\n", "main edit");
    let before = head(&root);
    let paused = run(&root, request("merge", "refs/heads/feature"));
    assert_eq!(paused.status, "paused");
    assert_eq!(paused.context.operation.as_deref(), Some("merge"));
    assert!(operations::prepare(root.clone(), request("skip", "")).is_err());
    assert_eq!(run(&root, request("abort", "")).status, "completed");
    assert_eq!(head(&root), before);
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "main\n");
}

#[test]
fn workflow_stash_pop_conflict_keeps_the_stash() {
    let tree = TemporaryTree::new();
    let root = repository(&tree, "repo");
    fs::write(root.join("a.txt"), "stashed\n").unwrap();
    let pushed = run(&root, request("stashPush", ""));
    assert_eq!(pushed.status, "completed");
    assert_eq!(pushed.context.stashes.len(), 1);
    let id = pushed.context.stashes[0].id.clone();
    commit_file(&root, "a.txt", "different\n", "different");
    let popped = run(&root, request("stashPop", "stash@{0}"));
    assert_eq!(popped.status, "paused");
    assert_eq!(popped.context.stashes[0].id, id);
    assert!(popped.context.operation.is_none());
    assert_eq!(popped.context.conflicts, vec!["a.txt"]);
}

#[test]
fn workflow_dirty_and_stale_plans_are_rejected_without_writing() {
    let tree = TemporaryTree::new();
    let root = repository(&tree, "repo");
    let target = head(&root);
    let plan = operations::prepare(root.clone(), request("revert", &target)).unwrap();
    fs::write(root.join("a.txt"), "dirty\n").unwrap();
    assert!(operations::prepare(root.clone(), request("revert", &target)).is_err());
    expect_success(git(&root, &["add", "."]));
    expect_success(git(&root, &["commit", "-m", "new head"]));
    let advanced = head(&root);
    assert!(
        operations::execute(root.clone(), plan)
            .unwrap_err()
            .contains("changed after confirmation")
    );
    assert_eq!(head(&root), advanced);
    assert!(operations::prepare(root.clone(), request("rebase", "--help")).is_err());
    let other = repository(&tree, "other");
    let plan = operations::prepare(root.clone(), request("revert", &advanced)).unwrap();
    assert!(
        operations::execute(other, plan)
            .unwrap_err()
            .contains("different repository")
    );
}

#[test]
fn workflow_tags_and_detached_checkout_use_commit_targets() {
    let tree = TemporaryTree::new();
    let root = repository(&tree, "repo");
    let base = head(&root);
    let mut tag = request("tagCreate", &base);
    tag.name = "v1".into();
    tag.message = "release".into();
    assert_eq!(run(&root, tag).status, "completed");
    commit_file(&root, "later.txt", "later\n", "later");
    assert_eq!(
        run(&root, request("checkoutCommit", "refs/tags/v1")).status,
        "completed"
    );
    assert_eq!(head(&root), base);
    assert!(!root.join("later.txt").exists());
    assert_eq!(
        run(&root, request("tagDelete", "refs/tags/v1")).status,
        "completed"
    );
    assert!(
        operations::context(root)
            .unwrap()
            .references
            .iter()
            .all(|r| r.kind != "tag")
    );
}

#[test]
fn workflow_branches_and_stashes_use_verified_targets() {
    let tree = TemporaryTree::new();
    let root = repository(&tree, "repo");
    let mut create = request("createBranch", &head(&root));
    create.name = "topic".into();
    assert_eq!(run(&root, create).status, "completed");
    let mut rename = request("renameBranch", "refs/heads/topic");
    rename.name = "renamed".into();
    assert_eq!(
        run(&root, rename).context.branch_name.as_deref(),
        Some("renamed")
    );
    assert!(
        operations::prepare(root.clone(), request("deleteBranch", "refs/heads/renamed")).is_err()
    );
    expect_success(git(&root, &["switch", "main"]));
    assert_eq!(
        run(&root, request("deleteBranch", "refs/heads/renamed")).status,
        "completed"
    );
    fs::write(root.join("new.txt"), "untracked\n").unwrap();
    assert!(operations::prepare(root.clone(), request("stashPush", "")).is_err());
    let mut stash = request("stashPush", "");
    stash.include_untracked = true;
    assert_eq!(run(&root, stash).status, "completed");
    assert!(!root.join("new.txt").exists());
    assert_eq!(
        run(&root, request("stashApply", "stash@{0}")).status,
        "completed"
    );
    assert_eq!(
        fs::read_to_string(root.join("new.txt")).unwrap(),
        "untracked\n"
    );
    assert_eq!(
        run(&root, request("stashDrop", "stash@{0}")).status,
        "completed"
    );
}

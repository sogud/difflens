//! Explicit plans and resumable local Git workflows. No shell or forced history updates.
use crate::{RepositoryDetails, git};
use nsh_core::prelude::*;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

#[derive(Clone, Debug, JsObject)]
pub struct GitReference {
    pub name: String,
    pub short_name: String,
    pub id: String,
    pub kind: String,
    pub current: bool,
}

#[derive(Clone, Debug, JsObject)]
pub struct GitStash {
    pub reference: String,
    pub id: String,
    pub message: String,
}

#[derive(Clone, Debug, JsObject)]
pub struct GitContext {
    pub head_id: String,
    pub branch_name: Option<String>,
    pub operation: Option<String>,
    pub clean: bool,
    pub conflicts: Vec<String>,
    pub references: Vec<GitReference>,
    pub stashes: Vec<GitStash>,
}

#[derive(Clone, Debug, JsObject)]
pub struct GitOperationRequest {
    pub kind: String,
    pub target: String,
    pub name: String,
    pub message: String,
    pub include_untracked: bool,
    pub mainline: u32,
}

#[derive(Clone, Debug, JsObject)]
pub struct GitOperationPlan {
    pub request: GitOperationRequest,
    pub repository_path: String,
    pub head_id: String,
    pub branch_name: Option<String>,
    pub target_id: String,
    pub operation: Option<String>,
    pub affected_commits: u32,
}

#[derive(Clone, Debug, JsObject)]
pub struct GitOperationOutcome {
    /// completed, paused (conflicts/sequence), or failed; errors never look like success.
    pub status: String,
    pub error: Option<String>,
    pub details: RepositoryDetails,
    pub context: GitContext,
}

pub(super) fn open_file(requested: PathBuf, relative: String) -> Result<(), String> {
    let root = git::validate_repository_root(&requested)?;
    git::validate_relative_file_path(&relative)?;
    let file = fs::canonicalize(root.join(relative)).map_err(|e| e.to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("The file must stay inside the selected repository.".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg("-t");
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    let status = command.arg(file).status().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Could not open the file in the system editor.".into());
    }
    Ok(())
}

pub(super) fn context(requested: PathBuf) -> Result<GitContext, String> {
    let root = git::validate_repository_root(&requested)?;
    let details = git::inspect_repository(root.clone())?;
    context_at(&root, &details)
}

fn context_at(root: &Path, details: &RepositoryDetails) -> Result<GitContext, String> {
    let head_id = if details.has_commits {
        commit(root, "HEAD")?
    } else {
        String::new()
    };
    let references = git::run_git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(symref)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    let references =
        std::str::from_utf8(&references).map_err(|_| "Reference names are not valid UTF-8.")?;
    let mut refs = Vec::new();
    for line in references.lines() {
        let fields: Vec<_> = line.split('\0').collect();
        if fields.len() != 4 || !fields[3].is_empty() {
            continue;
        }
        let kind = if fields[0].starts_with("refs/heads/") {
            "local"
        } else if fields[0].starts_with("refs/remotes/") {
            "remote"
        } else {
            "tag"
        };
        refs.push(GitReference {
            name: fields[0].into(),
            short_name: fields[1].into(),
            id: fields[2].into(),
            kind: kind.into(),
            current: kind == "local" && details.branch_name.as_deref() == Some(fields[1]),
        });
    }
    let output = git::run_git(root, &["stash", "list", "--format=%gd%x00%H%x00%gs"])?;
    let text = std::str::from_utf8(&output).map_err(|_| "Stash messages are not valid UTF-8.")?;
    let mut stashes = Vec::new();
    for line in text.lines() {
        let fields: Vec<_> = line.splitn(3, '\0').collect();
        if fields.len() != 3 {
            return Err("Git returned an invalid stash record.".into());
        }
        stashes.push(GitStash {
            reference: fields[0].into(),
            id: fields[1].into(),
            message: fields[2].into(),
        });
    }
    Ok(GitContext {
        head_id,
        branch_name: details.branch_name.clone(),
        operation: operation_at(root)?,
        clean: details.changes.is_empty(),
        conflicts: details
            .changes
            .iter()
            .filter(|f| f.conflicted)
            .map(|f| f.path.clone())
            .collect(),
        references: refs,
        stashes,
    })
}

pub(super) fn operation_at(root: &Path) -> Result<Option<String>, String> {
    // --absolute-git-dir resolves per-worktree state, including .git files.
    let output = git::run_git(root, &["rev-parse", "--absolute-git-dir"])?;
    let directory = PathBuf::from(
        std::str::from_utf8(&output)
            .map_err(|_| "Git directory is not valid UTF-8.")?
            .trim(),
    );
    for (marker, kind) in [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("CHERRY_PICK_HEAD", "cherryPick"),
        ("REVERT_HEAD", "revert"),
        ("MERGE_HEAD", "merge"),
    ] {
        if directory.join(marker).exists() {
            return Ok(Some(kind.into()));
        }
    }
    if directory.join("sequencer/todo").exists() {
        let todo =
            fs::read_to_string(directory.join("sequencer/todo")).map_err(|e| e.to_string())?;
        return Ok(Some(
            if todo.lines().any(|line| line.starts_with("revert ")) {
                "revert"
            } else {
                "cherryPick"
            }
            .into(),
        ));
    }
    Ok(None)
}

fn commit(root: &Path, value: &str) -> Result<String, String> {
    let output = git::run_git(
        root,
        &["rev-parse", "--verify", &format!("{value}^{{commit}}")],
    )?;
    let id = std::str::from_utf8(&output)
        .map_err(|_| "Git returned an invalid commit ID.")?
        .trim();
    validate_id(id)?;
    Ok(id.into())
}

fn validate_id(id: &str) -> Result<(), String> {
    if !matches!(id.len(), 40 | 64) || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Select a full commit ID from this repository.".into());
    }
    Ok(())
}

fn target_commit(root: &Path, target: &str, ctx: &GitContext) -> Result<String, String> {
    if !ctx.references.iter().any(|r| r.name == target) {
        validate_id(target)?;
    }
    commit(root, target)
}

fn branch_name(root: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.trim() != name || name.starts_with('-') || name.contains("@{") {
        return Err("Enter a literal branch name without surrounding spaces.".into());
    }
    git::run_git(root, &["check-ref-format", "--branch", name]).map(|_| ())
}

pub(super) fn prepare(
    requested: PathBuf,
    request: GitOperationRequest,
) -> Result<GitOperationPlan, String> {
    let root = git::validate_repository_root(&requested)?;
    let details = git::inspect_repository(root.clone())?;
    let ctx = context_at(&root, &details)?;
    if ctx.operation.is_some()
        && !matches!(
            request.kind.as_str(),
            "continue" | "abort" | "skip" | "resolve"
        )
    {
        return Err("Finish or abort the current Git operation first.".into());
    }
    let mut target_id = String::new();
    let mut affected_commits = 0;
    match request.kind.as_str() {
        "merge" | "rebase" | "cherryPick" | "revert" | "checkoutCommit" => {
            if !ctx.clean {
                return Err("Commit or stash local changes before this operation.".into());
            }
            if ctx.head_id.is_empty() || ctx.branch_name.is_none() {
                return Err("Check out a local branch with commits first.".into());
            }
            target_id = target_commit(&root, &request.target, &ctx)?;
            if matches!(request.kind.as_str(), "cherryPick" | "revert") {
                let parents =
                    git::run_git(&root, &["rev-list", "--parents", "-n", "1", &target_id])?;
                let count = String::from_utf8_lossy(&parents)
                    .split_whitespace()
                    .count()
                    .saturating_sub(1);
                if count > 1 && (request.mainline == 0 || request.mainline as usize > count) {
                    return Err("Choose a valid mainline parent for this merge commit.".into());
                }
                if count <= 1 && request.mainline != 0 {
                    return Err("A mainline parent is only used for merge commits.".into());
                }
                affected_commits = 1;
            } else if request.kind != "checkoutCommit" {
                let range = if request.kind == "rebase" {
                    format!("{target_id}..HEAD")
                } else {
                    format!("HEAD..{target_id}")
                };
                let output = git::run_git(&root, &["rev-list", "--count", &range])?;
                affected_commits = String::from_utf8_lossy(&output)
                    .trim()
                    .parse()
                    .map_err(|_| "Invalid commit count from Git.")?;
            }
        }
        "createBranch" => {
            branch_name(&root, &request.name)?;
            if ctx
                .references
                .iter()
                .any(|r| r.name == format!("refs/heads/{}", request.name))
            {
                return Err("This local branch already exists.".into());
            }
            target_id = if request.target.is_empty() {
                ctx.head_id.clone()
            } else {
                target_commit(&root, &request.target, &ctx)?
            };
        }
        "renameBranch" | "deleteBranch" => {
            let reference = ctx
                .references
                .iter()
                .find(|r| r.name == request.target && r.kind == "local")
                .ok_or("Select an existing local branch.")?;
            target_id = reference.id.clone();
            if request.kind == "deleteBranch" && reference.current {
                return Err("Switch branches before deleting the current branch.".into());
            }
            if request.kind == "renameBranch" {
                branch_name(&root, &request.name)?;
            }
        }
        "tagCreate" => {
            branch_name(&root, &request.name)?;
            if ctx
                .references
                .iter()
                .any(|r| r.name == format!("refs/tags/{}", request.name))
            {
                return Err("This tag already exists.".into());
            }
            target_id = if request.target.is_empty() {
                ctx.head_id.clone()
            } else {
                target_commit(&root, &request.target, &ctx)?
            };
            if target_id.is_empty() {
                return Err("Create an initial commit before creating a tag.".into());
            }
        }
        "tagDelete" => {
            target_id = ctx
                .references
                .iter()
                .find(|r| r.name == request.target && r.kind == "tag")
                .ok_or("Select an existing tag.")?
                .id
                .clone();
        }
        "stashPush" => {
            if ctx.head_id.is_empty() {
                return Err("Create an initial commit before stashing.".into());
            }
            if details
                .changes
                .iter()
                .all(|f| f.untracked && !request.include_untracked)
            {
                return Err("There are no selected local changes to stash.".into());
            }
            if !ctx.conflicts.is_empty() {
                return Err("Resolve existing conflicts before stashing.".into());
            }
        }
        "stashApply" | "stashPop" | "stashDrop" => {
            let stash = ctx
                .stashes
                .iter()
                .find(|s| s.reference == request.target)
                .ok_or("This stash no longer exists. Refresh the list.")?;
            target_id = stash.id.clone();
            if request.kind != "stashDrop" && !ctx.clean {
                return Err("Commit or stash local changes before applying a stash.".into());
            }
        }
        "unstageAll" => {
            if !details.changes.iter().any(|f| f.staged) {
                return Err("There are no staged files.".into());
            }
            if !ctx.conflicts.is_empty() {
                return Err("Resolve existing conflicts first.".into());
            }
        }
        "resolve" => {
            git::validate_relative_file_path(&request.target)?;
            if !ctx.conflicts.contains(&request.target) {
                return Err("This file is no longer conflicted.".into());
            }
        }
        "continue" | "abort" | "skip" => {
            let operation = ctx
                .operation
                .as_deref()
                .ok_or("There is no Git operation to resume or abort.")?;
            if request.kind == "continue" && !ctx.conflicts.is_empty() {
                return Err("Resolve and stage all conflicted files first.".into());
            }
            if request.kind == "skip" && operation == "merge" {
                return Err("A merge cannot skip a commit.".into());
            }
        }
        _ => return Err("Unsupported Git operation.".into()),
    }
    Ok(GitOperationPlan {
        request,
        repository_path: root.to_string_lossy().into_owned(),
        head_id: ctx.head_id,
        branch_name: ctx.branch_name,
        target_id,
        operation: ctx.operation,
        affected_commits,
    })
}

struct WriteGuard(PathBuf);
fn writers() -> &'static Mutex<HashSet<PathBuf>> {
    static WRITERS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    WRITERS.get_or_init(|| Mutex::new(HashSet::new()))
}
impl Drop for WriteGuard {
    fn drop(&mut self) {
        if let Ok(mut lock) = writers().lock() {
            lock.remove(&self.0);
        }
    }
}

pub(super) fn execute(
    requested: PathBuf,
    plan: GitOperationPlan,
) -> Result<GitOperationOutcome, String> {
    let root = git::validate_repository_root(&requested)?;
    if root != git::validate_repository_root(Path::new(&plan.repository_path))? {
        return Err("The operation belongs to a different repository.".into());
    }
    {
        let mut lock = writers()
            .lock()
            .map_err(|_| "Git operation lock is unavailable.")?;
        if !lock.insert(root.clone()) {
            return Err("Another Git operation is already running for this worktree.".into());
        }
    }
    let _guard = WriteGuard(root.clone());
    let fresh = prepare(root.clone(), plan.request.clone())?;
    if fresh.head_id != plan.head_id
        || fresh.branch_name != plan.branch_name
        || fresh.target_id != plan.target_id
        || fresh.operation != plan.operation
    {
        return Err(
            "Repository state changed after confirmation. Review the operation again.".into(),
        );
    }
    let request = &fresh.request;
    let mut args: Vec<String> = vec![
        "-c".into(),
        "core.editor=true".into(),
        "-c".into(),
        "sequence.editor=true".into(),
    ];
    match request.kind.as_str() {
        "merge" => args.extend(["merge".into(), "--no-edit".into(), fresh.target_id.clone()]),
        "rebase" => args.extend(["rebase".into(), fresh.target_id.clone()]),
        "checkoutCommit" => {
            args.extend(["switch".into(), "--detach".into(), fresh.target_id.clone()])
        }
        "cherryPick" | "revert" => {
            args.extend([
                if request.kind == "revert" {
                    "revert"
                } else {
                    "cherry-pick"
                }
                .into(),
                "--no-edit".into(),
            ]);
            if request.mainline > 0 {
                args.extend(["--mainline".into(), request.mainline.to_string()]);
            }
            args.push(fresh.target_id.clone());
        }
        "createBranch" => {
            args.extend(["switch".into(), "--create".into(), request.name.clone()]);
            if !fresh.target_id.is_empty() {
                args.push(fresh.target_id.clone());
            }
        }
        "renameBranch" => args.extend([
            "branch".into(),
            "--move".into(),
            request.target.trim_start_matches("refs/heads/").into(),
            request.name.clone(),
        ]),
        "deleteBranch" => args.extend([
            "branch".into(),
            "--delete".into(),
            "--".into(),
            request.target.trim_start_matches("refs/heads/").into(),
        ]),
        "tagCreate" => {
            args.push("tag".into());
            if !request.message.trim().is_empty() {
                args.extend([
                    "--annotate".into(),
                    "--message".into(),
                    request.message.trim().into(),
                ]);
            }
            args.extend([request.name.clone(), fresh.target_id.clone()]);
        }
        "tagDelete" => args.extend([
            "tag".into(),
            "--delete".into(),
            "--".into(),
            request.target.trim_start_matches("refs/tags/").into(),
        ]),
        "stashPush" => {
            args.extend(["stash".into(), "push".into()]);
            if request.include_untracked {
                args.push("--include-untracked".into());
            }
            if !request.message.trim().is_empty() {
                args.extend(["--message".into(), request.message.trim().into()]);
            }
        }
        "stashApply" | "stashPop" | "stashDrop" => args.extend([
            "stash".into(),
            match request.kind.as_str() {
                "stashApply" => "apply",
                "stashPop" => "pop",
                _ => "drop",
            }
            .into(),
            request.target.clone(),
        ]),
        "unstageAll" if fresh.head_id.is_empty() => args.extend([
            "rm".into(),
            "--cached".into(),
            "--recursive".into(),
            "--".into(),
            ".".into(),
        ]),
        "unstageAll" => args.extend(["restore".into(), "--staged".into(), "--".into(), ".".into()]),
        "resolve" => {
            args.insert(0, "--literal-pathspecs".into());
            args.extend(["add".into(), "--".into(), request.target.clone()]);
        }
        "continue" | "abort" | "skip" => {
            args.extend([
                match fresh.operation.as_deref() {
                    Some("cherryPick") => "cherry-pick",
                    Some("revert") => "revert",
                    Some("rebase") => "rebase",
                    _ => "merge",
                }
                .into(),
                format!("--{}", request.kind),
            ]);
        }
        _ => return Err("Unsupported Git operation.".into()),
    }
    let refs: Vec<_> = args.iter().map(String::as_str).collect();
    let output = git::git_output(&root, &refs)?;
    let details = git::inspect_repository(root.clone())?;
    let context = context_at(&root, &details)?;
    let success = output.status.success();
    let status = if success {
        "completed"
    } else if context.operation.is_some() || !context.conflicts.is_empty() {
        "paused"
    } else {
        "failed"
    };
    Ok(GitOperationOutcome {
        status: status.into(),
        error: if success {
            None
        } else {
            Some(git::command_error(&output))
        },
        details,
        context,
    })
}

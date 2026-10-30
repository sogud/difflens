use super::{CommitDetails, CommitFile, CommitSummary, HistoryPage, git};
use std::{
    path::{Path, PathBuf},
    str,
};

const PAGE_SIZE: u32 = 50;

pub(super) fn history_page(
    root: PathBuf,
    query: String,
    search_field: String,
    anchor: Option<String>,
    offset: u32,
) -> Result<HistoryPage, String> {
    let root = git::validate_repository_root(&root)?;
    let query = query.trim();
    if query.len() > 512 || query.contains('\0') {
        return Err("Keep the history search within 512 bytes and omit NUL characters.".to_owned());
    }
    if !matches!(search_field.as_str(), "message" | "author" | "id") {
        return Err("Choose a supported history search field.".to_owned());
    }
    let current_tip_id = resolve_commit(&root, "HEAD")?;
    let tip_id = match anchor {
        Some(id) => {
            validate_full_id(&id)?;
            Some(
                resolve_commit(&root, &id)?
                    .ok_or("The saved history snapshot is no longer available. Refresh history.")?,
            )
        }
        None => current_tip_id.clone(),
    };
    let mut page = HistoryPage {
        commits: Vec::new(),
        tip_id: tip_id.clone(),
        current_tip_id,
        offset,
        next_offset: None,
        page_size: PAGE_SIZE,
    };
    let Some(tip) = tip_id else { return Ok(page) };

    let mut target = tip.clone();
    if search_field == "id" && !query.is_empty() {
        if !(7..=64).contains(&query.len()) || !query.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Enter at least 7 hexadecimal characters of a commit ID.".to_owned());
        }
        let Some(id) = resolve_commit(&root, query)? else {
            return Ok(page);
        };
        if offset != 0
            || git::run_git_optional(&root, &["merge-base", "--is-ancestor", &id, &tip])?.is_none()
        {
            return Ok(page);
        }
        target = id;
    }
    let skip = format!("--skip={offset}");
    let count = format!("--max-count={}", PAGE_SIZE + 1);
    let mut args = vec![
        "log",
        "--no-color",
        "--no-decorate",
        "--no-show-signature",
        "--topo-order",
        "-z",
        "--format=%H%x00%h%x00%an%x00%aI%x00%s",
        &skip,
        &count,
    ];
    let filter;
    if !query.is_empty() {
        match search_field.as_str() {
            "message" | "author" => {
                args.extend(["--fixed-strings", "--regexp-ignore-case"]);
                filter = format!(
                    "--{}={query}",
                    if search_field == "author" {
                        "author"
                    } else {
                        "grep"
                    }
                );
                args.push(&filter);
            }
            "id" => args.extend(["--no-walk", "--max-count=1"]),
            _ => unreachable!(),
        }
    }
    args.extend([&target, "--"]);
    let output = git::run_git(&root, &args)?;
    page.commits = parse_history_page(&output)?;
    if page.commits.len() > PAGE_SIZE as usize {
        page.commits.truncate(PAGE_SIZE as usize);
        page.next_offset = Some(
            offset
                .checked_add(PAGE_SIZE)
                .ok_or("History offset is too large.")?,
        );
    }
    Ok(page)
}

fn resolve_commit(root: &Path, revision: &str) -> Result<Option<String>, String> {
    let object = format!("{revision}^{{commit}}");
    git::run_git_optional(root, &["rev-parse", "--verify", "--quiet", &object])?
        .map(|output| {
            let id = str::from_utf8(&output)
                .map_err(|error| error.to_string())?
                .trim();
            validate_full_id(id)?;
            Ok(id.to_owned())
        })
        .transpose()
}

fn validate_full_id(id: &str) -> Result<(), String> {
    if !matches!(id.len(), 40 | 64) || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Select a valid full commit ID.".to_owned());
    }
    Ok(())
}

fn parse_history_page(output: &[u8]) -> Result<Vec<CommitSummary>, String> {
    if output.is_empty() {
        return Ok(Vec::new());
    }
    let mut fields: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
    if fields.last().is_some_and(|field| field.is_empty()) {
        fields.pop();
    }
    if fields.len() % 5 != 0 {
        return Err("Git returned incomplete history records.".to_owned());
    }
    let mut commits = Vec::new();
    for record in fields.chunks_exact(5) {
        let mut text = Vec::new();
        for field in record {
            text.push(
                str::from_utf8(field)
                    .map_err(|_| "History contains metadata that is not valid UTF-8.")?,
            );
        }
        validate_full_id(text[0])?;
        commits.push(CommitSummary {
            id: text[0].to_owned(),
            short_id: text[1].to_owned(),
            author: text[2].to_owned(),
            authored_at: text[3].to_owned(),
            subject: text[4].to_owned(),
        });
    }
    Ok(commits)
}

pub(super) fn inspect_commit(root: PathBuf, id: String) -> Result<CommitDetails, String> {
    let root = git::validate_repository_root(&root)?;
    read_commit(&root, &id)
}

fn read_commit(root: &Path, id: &str) -> Result<CommitDetails, String> {
    // Accept object IDs only: UI input must never become a revision expression or option.
    validate_full_id(id)?;
    let object = format!("{id}^{{commit}}");
    let resolved = git::run_git(root, &["rev-parse", "--verify", &object])?;
    let resolved = str::from_utf8(&resolved).map_err(|e| e.to_string())?.trim();
    let output = git::run_git(
        root,
        &[
            "show",
            "--no-patch",
            "--no-show-signature",
            "--format=%H%x00%h%x00%an%x00%aI%x00%P%x00%B",
            resolved,
            "--",
        ],
    )?;
    let text = str::from_utf8(&output)
        .map_err(|_| "This commit contains metadata that is not valid UTF-8.".to_owned())?;
    let fields: Vec<&str> = text.splitn(6, '\0').collect();
    if fields.len() != 6 {
        return Err("Git returned incomplete commit metadata.".to_owned());
    }
    let mut commit = CommitDetails {
        id: fields[0].to_owned(),
        short_id: fields[1].to_owned(),
        author: fields[2].to_owned(),
        authored_at: fields[3].to_owned(),
        parent_ids: fields[4].split_whitespace().map(str::to_owned).collect(),
        message: fields[5].trim_end().to_owned(),
        files: Vec::new(),
    };
    let mut args = vec![
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "--name-status",
        "-z",
        "--find-renames",
        "--no-ext-diff",
        "--no-textconv",
    ];
    if let Some(parent) = commit.parent_ids.first() {
        args.push(parent);
    }
    args.extend([commit.id.as_str(), "--"]);
    let output = git::run_git(root, &args)?;
    let mut fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty());
    while let Some(status) = fields.next() {
        let status = str::from_utf8(status).map_err(|e| e.to_string())?;
        let first = read_path(fields.next())?;
        let (path, old_path) = if status.starts_with('R') || status.starts_with('C') {
            (read_path(fields.next())?, Some(first))
        } else {
            (first, None)
        };
        commit.files.push(CommitFile {
            path,
            old_path,
            status: status.to_owned(),
        });
    }
    Ok(commit)
}

fn read_path(value: Option<&[u8]>) -> Result<String, String> {
    let value = value.ok_or("Git returned an incomplete committed file record.")?;
    let path = str::from_utf8(value)
        .map_err(|_| "A committed file path is not valid UTF-8.".to_owned())?;
    git::validate_relative_file_path(path)?;
    Ok(path.to_owned())
}

pub(super) fn commit_diff(root: PathBuf, id: String, path: String) -> Result<String, String> {
    let root = git::validate_repository_root(&root)?;
    git::validate_relative_file_path(&path)?;
    let commit = read_commit(&root, &id)?;
    let file = commit
        .files
        .iter()
        .find(|file| file.path == path)
        .ok_or("This file is not part of the selected commit.")?;
    let mut args = vec![
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "-p",
        "--find-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--unified=3",
    ];
    if let Some(parent) = commit.parent_ids.first() {
        args.push(parent);
    }
    args.extend([commit.id.as_str(), "--"]);
    if let Some(old_path) = &file.old_path {
        args.push(old_path);
    }
    args.push(&file.path);
    git::run_git_diff(&root, &args, false)
}

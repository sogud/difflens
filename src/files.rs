//! Read-only file browsing bounded by the selected repository root.
use nsh_core::prelude::*;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

const PREVIEW_LIMIT: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, JsObject)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_symlink: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum PreviewKind {
    Text,
    Binary,
    TooLarge,
}

#[derive(Clone, Debug, JsObject)]
pub struct FilePreview {
    pub path: String,
    pub kind: PreviewKind,
    pub content: String,
    pub size_bytes: u64,
}

fn scoped_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path.components().any(|component| match component {
            Component::Normal(name) => name.eq_ignore_ascii_case(".git"),
            Component::CurDir => false,
            _ => true,
        })
    {
        return Err("Choose a file or folder inside the selected repository.".to_owned());
    }
    let resolved = fs::canonicalize(root.join(path)).map_err(|error| error.to_string())?;
    if !resolved.starts_with(root) {
        return Err("The symbolic link points outside the selected repository.".to_owned());
    }
    Ok(resolved)
}

pub(super) fn read_directory(
    requested_root: PathBuf,
    relative: String,
) -> Result<Vec<FileEntry>, String> {
    let root = super::git::validate_repository_root(&requested_root)?;
    let path = scoped_path(&root, &relative)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if name.eq_ignore_ascii_case(".git") {
            continue;
        }
        let name = name
            .to_str()
            .ok_or("This folder contains a filename that is not valid UTF-8.")?
            .to_owned();
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        let relative_path = entry
            .path()
            .strip_prefix(&root)
            .map_err(|error| error.to_string())?
            .to_str()
            .ok_or("The file path is not valid UTF-8.")?
            .to_owned();
        entries.push(FileEntry {
            name,
            path: relative_path,
            is_directory: kind.is_dir(),
            is_symlink: kind.is_symlink(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub(super) fn read_file(requested_root: PathBuf, relative: String) -> Result<FilePreview, String> {
    use std::io::Read;
    let root = super::git::validate_repository_root(&requested_root)?;
    let path = scoped_path(&root, &relative)?;
    // Do not block a preview worker on pipes or other special files.
    if !fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("This path is not a regular file.".to_owned());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let mut file = options.open(&path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("This path is not a regular file.".to_owned());
    }
    let mut preview = FilePreview {
        path: relative,
        kind: PreviewKind::Text,
        content: String::new(),
        size_bytes: metadata.len(),
    };
    if metadata.len() > PREVIEW_LIMIT {
        preview.kind = PreviewKind::TooLarge;
        return Ok(preview);
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(PREVIEW_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > PREVIEW_LIMIT {
        preview.kind = PreviewKind::TooLarge;
        return Ok(preview);
    }
    if bytes.contains(&0) {
        preview.kind = PreviewKind::Binary;
        return Ok(preview);
    }
    match String::from_utf8(bytes) {
        Ok(text) => preview.content = text,
        Err(_) => preview.kind = PreviewKind::Binary,
    }
    Ok(preview)
}

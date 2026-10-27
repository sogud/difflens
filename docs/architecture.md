# Architecture

## Scope

The first client slice supports nested and flat repository views, independent status, file diffs, staging and unstaging, commits, local branch actions, recent history, and basic remote sync. Advanced merge/rebase workflows, conflict resolution, reset/discard, and clone UI are outside this slice.

## NSH interface

The Rust module owns repository discovery and every Git process. TSX owns selection, view mode, draft text, and visible operation states. The exported Workspace module uses typed objects generated from Rust.

    startScan(rootPath, preferredPath, rescan, dataDirectory) -> ScanProgress
    scanProgress(id, knownRevision) -> ScanProgress
    stopScan(id) -> void
    openRepository(folderPath) -> WorkspaceScan
    chooseFolder(title) -> string | null
    revealDirectory(folderPath) -> void
    inspectRepository(repositoryPath) -> RepositoryDetails
    diffFile(repositoryPath, filePath, staged) -> string
    stageFile(repositoryPath, filePath) -> RepositoryDetails
    unstageFile(repositoryPath, filePath) -> RepositoryDetails
    stageAll(repositoryPath) -> RepositoryDetails
    commit(repositoryPath, message) -> RepositoryDetails
    createBranch(repositoryPath, branch) -> RepositoryDetails
    switchBranch(repositoryPath, branch) -> RepositoryDetails
    fetch(repositoryPath) -> RepositoryDetails
    pull(repositoryPath) -> RepositoryDetails
    push(repositoryPath) -> RepositoryDetails

Each successful write operation returns a fresh selected-repository snapshot. The TSX layer updates that repository's summary in the workspace tree and retains the current view mode and selection.

## Repository data

The repository library stores canonical folder paths in `nsh/storage`. Each source is either one repository or a directory scanned recursively; it remembers its selected repository. The active source and Nested/Flat mode are restored on launch. Importing a repository resolves a subfolder to its Git root and does not recursively scan it. Directory scans preserve repository nesting. Re-adding the same kind and canonical path reuses the existing library entry.

Failed imports retain the current view and keep the path form editable. Refresh preserves selection and commit text. Removing a library entry only changes saved metadata. The native folder picker uses RFD's asynchronous system dialog because the pinned NSH picker supports images, not directories.

RepositoryNode contains its canonical path, relative path, HEAD label, staged/unstaged/untracked counts, upstream state, errors, and nested repository children. The flat view derives one list from this tree; the nested view renders the same nodes recursively.

RepositoryDetails contains per-file status records, local branch names, upstream/ahead/behind state, and a short recent commit list. A file record keeps its raw relative path when UTF-8, status label, staged/unstaged/untracked/conflicted flags, and whether the path can be passed back to Git without loss.

## Git boundaries

- Resolve and validate the selected repository with git rev-parse before every operation.
- Build Git commands from argument arrays; never invoke a shell.
- Validate a file operation against the latest changed-file snapshot and pass it as a literal pathspec after --.
- Stage and unstage only the selected file, or stage all files in the selected repository. Commit only staged files.
- Branch switching uses git switch without force or merge flags, so Git rejects a switch that would overwrite local changes.
- Pull is fast-forward only. Push uses the configured upstream, or sets origin as upstream for a new branch when origin exists.
- Every Git process runs through NSH's blocking helper so process and filesystem work stays off the UI thread.
- Git errors remain visible. No action silently resolves a conflict or discards a user's content.

## Native desktop layout

`i18n.ts` owns the typed English/Chinese UI catalog and the current language. `SettingsDialog` applies changes immediately and saves them separately from the library in `nsh/storage`; startup restores the language before the library. Native application-menu labels follow the same catalog. Git output and user content remain unchanged.

Source loading is an explicit opening/scanning/details state, retaining the requested path. `LoadingStatus` uses NSH's indeterminate `Progress` with a native spin animation, disabled under reduced motion. The import dialog, toolbar, detail/diff panels and Git-operation feedback use this component without inventing a progress percentage.

Use NSH's Button, Tab, Menu, Input, ResizablePanelGroup, ResizablePanel, and DiffView components with semantic theme tokens. The window has resizable repository, changes, and diff panes. Nested/flat is a selected tab in the repository pane. Actions stay beside the selected repository or file, and the UI disables repeated operations while one is running. NSH CLI, host, nsh-core, and nsh-base must use the same source revision so generated declarations and runtime components agree.

## Verification fixtures

Rust integration tests create repositories under a unique operating-system temporary directory, configure identity in each fixture only, and remove the directory on drop. Fixtures cover a normal nested repository, a .git file repository, file status and diffs, stage/unstage/commit, branch switching, and fetch/pull/push through a local bare remote. No test writes to a real workspace repository or contacts a network remote.

`script/verify-library.py` creates disposable nested repositories and runs NSH UI tests for invalid paths, both import modes, deduplication, source switching, collapse/filter, refresh, removal, language switching and storage restoration. A fixture-only Git wrapper delays one real status read to verify loading feedback; the script checks that the delay was exercised. `--target macos` runs the same checks in the real host and saves screenshots. The automated tests use the path-entry form; selecting a folder in the system picker needs a manual check.

## Local installation and diagnostics

`script/package-macos.py` uses NSH's official macOS packager, replaces the generated runner with `src/main.rs`, emits matching debug symbols, then signs the bundle ad hoc. The runner initializes `src/diagnostics.rs` before NSH loads. It records runtime events, panics and session exit state; the `Diagnostics` native module exposes local paths to Settings. `App.tsx` uses NSH's ErrorBoundary with `FailurePane` for UI errors. No reports are uploaded; update checks are deferred.

Discovery uses a bounded parallel walker without Git-ignore filtering, pruning generated dependency/build trees and recognizing `.git` entries without a separate marker lookup per folder. It then inspects repositories with at most four workers and assembles the original nested tree in sorted order. Discovery and status phases have separate diagnostic events. The compact toolbar uses `Window.setTitleBar("hidden", 40)`, the `titleBar()` insets and `desktop.windowDrag`; AppKit retains the window buttons.

## Unicode diffs and file previews

`src/code_diff.rs` wraps the official NSH DiffView. The pinned DiffView estimates width from character counts; CJK fallback glyphs are wider and could implicitly wrap over the next fixed-height row. The wrapper measures the patch lines with the native text engine inside the component's render scope, sets a matching minimum content width, and makes code rows non-wrapping. Word highlights and horizontal scrolling remain NSH's.

`src/files.rs` lists one folder at a time and reads bounded UTF-8 previews. It validates the selected Git root, relative paths and canonical containment. `FileBrowser` virtualizes the loaded tree and cancels stale updates by generation; `FilePreviewPane` uses the official read-only Editor. The application owns the Changes/Files/History tab and diff/file route, so repository refreshes preserve the view. Git actions reread an open file and supply a fresh repository snapshot to the browser.

Selected-repository details include `git worktree list --porcelain -z` results. `WorktreeList` shows this association separately from filesystem nesting. Selecting an external worktree opens an ordinary repository source; Git writes still target only the selected worktree.

## Incremental discovery and cache

`scan_jobs.rs` owns cancellable scans. It publishes cached rows and prefetched root/selection summaries before traversal, then revisions add repository results without blocking navigation. `App` polls while the source remains active, overlays the selected repository's fresh details, and cancels on source changes/unmount. A completion revision lets stale rows be removed; stopping retains a clearly partial list.

`repository_cache.rs` stores versioned flat snapshots in the host data directory. Atomic replacement and scan generations prevent an older cancelled job from overwriting a newer cache. Startup/Refresh revalidate cached paths only; explicit Rescan discovers new paths. Cache corruption is logged and triggers discovery. `RepositoryNode.cached` keeps old summaries visibly pending until refreshed.

`scan_rules.rs` centralizes language-specific generated-folder exclusions. Generic names use project context, and a real Git marker overrides a generated-folder name. `.gitignore` is not a discovery filter because nested source repositories are often ignored by their parent repository.

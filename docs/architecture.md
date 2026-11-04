# Architecture

## Scope

The client supports nested/flat repository views, file/commit review, staging, commits, branch management, Merge/Rebase/Cherry-pick/Revert, local tags, Stash, resumable Git state, clone/init and basic remote sync. Inline three-way merge editing, partial staging, reset/discard and force-push UI remain outside this slice.

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
    historyPage(repositoryPath, query, searchField, anchor, offset) -> HistoryPage
    inspectCommit(repositoryPath, commitId) -> CommitDetails
    commitDiff(repositoryPath, commitId, filePath) -> string
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

`pushWithOutcome` separates Git's acknowledgement from the following local snapshot read. A transport error rejects the call; an acknowledged push can return a null snapshot with `refreshError`, so the UI retains the confirmed receipt and offers a refresh. The legacy `push` method remains available. Push feedback is ephemeral and scoped to workdir and branch; a new commit/branch-changing operation invalidates it. `syncKnown` distinguishes actual ahead/behind counts from missing upstream information. File diffs keep their lightweight status path; full synchronization snapshots explicitly request ahead/behind calculation.

## Repository data

The repository library stores canonical folder paths in `nsh/storage`. Each source is either one repository or a directory scanned recursively; it remembers its selected repository. The active source and Nested/Flat mode are restored on launch. Importing a repository resolves a subfolder to its Git root and does not recursively scan it. Directory scans preserve repository nesting. Re-adding the same kind and canonical path reuses the existing library entry.

Failed imports retain the current view and keep the path form editable. Refresh preserves selection and commit text. Removing a library entry only changes saved metadata. The native folder picker uses RFD's asynchronous system dialog because NSH 0.3.0’s Picker supports images, not directories.

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

## Git operation plans

`operations.rs` owns typed GitContext/Request/Plan/Outcome records. Preparation resolves the canonical worktree, current HEAD/branch, target OID and ongoing operation. Execution re-prepares the plan and rejects changed repository/HEAD/branch/target/state; it never automatically retries a write. A worktree lock rejects overlapping workflow writes. Outcomes distinguish completed, paused and failed, returning fresh status and context even after conflicts.

The context reads local/remote/tag refs, stash selectors with OIDs and per-worktree Git metadata. Merge/Rebase/Cherry-pick/Revert require a clean attached branch; merge commits require an explicit mainline parent. Continue/Abort/Skip use Git's own sequencer commands. Stash-pop conflicts retain the stash. Safe branch deletion has no force option. Setup reserves a new destination directory before clone/init and does not replace existing folders. Editor opening validates canonical containment.

`WorkflowPanel` owns one inline operation form and its editing/preparing/ready/executing/failed phase. Confirmation actions prepare their readonly preview automatically; simple input actions prepare and execute from one submission. App serializes preparation against other mutations and executes plans through the existing native revalidation path. `GitPane` exposes virtualized collapsible reference/Stash groups, selection details and context menus without a management dialog. The title-bar branch label opens this same sidebar; it has no separate branch dropdown. Selecting a different local branch exposes an explicit Switch action. The sidebar focuses its filter when opened and cancels deferred focus when hidden or a workflow form takes over. `QuickSwitcher` owns the anchored repository search and carries the repository scope captured when the picker opens into its selection callbacks. Commit, push and scoped push feedback share the Changes composer; its header menu owns Pull, Fetch and refresh. `GitOperationBanner` retains conflict continuation actions.

## Native desktop layout

`i18n.ts` and `locales/` own the typed UI catalog for Chinese, English, Japanese, Korean, French, German, Spanish and Portuguese. The merged catalogs must cover every message and preserve its interpolation fields. `preferences.ts` owns language, accent, appearance, changed-file tree/list mode and diff split/unified mode, validates restored values, accepts the previous language-only settings and serializes complete preference writes. Startup restores preferences before the library; unsupported system languages use English. Native application-menu labels use the same catalog. Git output and user content remain unchanged.

`appearance.ts` applies NSH's `setColorScheme` and provides the selected palette through one `appearanceThemeProps` renderer seam. NSH 0.3.0's bootstrap uses the same `uiTheme` host property; it is isolated here because generated public declarations omit that internal property. The version is pinned. `theme.json` is the Graphite bootstrap palette; `themes/*.json` hold the other light/dark pairs, and `themes.ts` selects them without duplicating palette data. Native and JS tokens update together; editors are retained. Primary/ring tokens follow the selected accent, while Git status and diff line/word colors retain semantic roles. Settings offers compact theme choices with swatches and reports persistence failures.

`ui-activity.ts` registers lifecycle-owned activity records for operations, imports, scans, repository reads and history. Ordinary working/history file diffs and text previews load silently, retaining displayed content while a new read is pending; their native diagnostics and local errors remain. Visible activity selects the highest-priority active record and the newest within that priority. Component cleanup removes its record. App renders one inline `LoadingStatus` in the title bar, with details in a tooltip and cancellation only for scans. Content panes and dialogs keep errors and action guards while omitting duplicate loading rows. The native Progress spinner respects reduced motion.

The left icon rail owns the Changes, Files and History navigation. The Changes header switches the file list between the selected workdir and the active source directory. A repository-only source is opened as a directory when that scope is requested, so nested repositories can be discovered. `DirectoryChangesPane` uses one virtual viewport, two concurrent status readers and a 12-entry/8 MiB metadata cache. It initially expands up to three changed repositories; cache pressure closes older groups. `repositoryChanges(directory, repository)` validates canonical containment and returns status without history, branch lists, worktree enumeration or diff bodies. A response includes at most 5,000 records and a 1 MiB path/record budget, with the full file count and a visible link to the complete workdir view. Per-root epochs prevent an older read replacing a fresh selected-workdir snapshot. File clicks retain the directory list while selecting the actual workdir; source and request guards reject stale completions. Directory controls never perform bulk writes, and discovery coverage/errors remain explicit. FileBrowser owns its Files header, refresh and close actions; the right editor retains its read-only marker.

Use NSH 0.3.0's Button, Tab, Menu, Input, ResizablePanelGroup, ResizablePanel, and DiffView components with semantic theme tokens. `theme.json` supplies the light/dark surfaces, quiet controls and Git status colors. Nested/flat is a selected tab in the repository pane. Actions stay beside the selected repository or file, and the UI disables repeated operations while one is running. NSH CLI, host, nsh-core, and nsh-base must use the same version so generated declarations and runtime components agree.

Native split boundaries control navigation and Git sidebars, library/worktree areas, staged/unstaged lists, the inline commit editor and historical file/diff review. `panel-layout.ts` keeps their bounds and versioned sizes in `nsh/storage`, serializing drag-end writes. Invalid saved data stays untouched; the current launch uses in-memory sizes and reports the error.

Staged and unstaged files use separate official `List` viewports. `changed-file-tree.ts` derives virtual folder/file rows from the status snapshot, compacts single-child directory chains and keeps folder keys separate from file keys. Each section owns its collapsed folders; tree/list mode is shared through preferences. The full status data remains available for Git validation, while only visible rows create native views. File labels and callbacks follow the row's current item when scrolling reuses it. `CodeDiff.layout` forwards the split/unified preference to the official DiffView, retaining its synchronized split scrolling and the native Unicode width handling.

`IconButton` keeps labels on the native button and puts the official Tooltip on an outer View: NSH 0.3.0's TSX native Button bridge ignores its tooltip host prop. `HintTarget` owns the hover delay and closes on leave/press/unmount; its fixed-size icon targets preserve the hit area. Text-row hints use View owners too. Wrapped text buttons let the outer row own horizontal flex and give the inner button a concrete height. This needs no framework fork.

## Retained repository tabs

`working-editor-tabs.ts` models a fresh workdir separately from an initialized list of opened working diffs, including an explicitly empty list. File identity includes both path and staged side. App owns this list and its selection; closing an inactive tab does not reload the current diff, while closing an active tab invalidates its pending request before selecting a neighbor. Session version 1 accepts the optional `openFiles` field and migrates older working-file selections without reopening an explicitly closed editor area.

`ReviewHeader` keeps file metadata, hunk actions and focus controls in the same row. App's navigation panels and editor are direct children of one horizontal ResizablePanelGroup; native drag updates resize the full layout, while JS persists only the final sizes. No clipped fixed-width shell sits outside the dragging panel.

DiffPane and FilePreviewPane keep one native editor instance after first use. Pending reads retain their last display, or immediately show a workdir/revision-scoped cached snapshot of the requested file while native verification runs. Errors clear the display; a cached snapshot is not marked ready until verification succeeds. Historical review keeps its native split/file/diff slots through commit loads. The diff LRU permits six entries within a 2 MiB text budget; the preview LRU permits four entries within a separate 2 MiB budget. Both skip individual entries over 512 KiB and invalidate on scope/revision changes, refresh and Git writes. Closing all working tabs clears diff snapshots. There is no whole-repository prefetch or native editor per open file.

Read-only access can reuse a validated canonical root for at most one second after checking the root, Git marker and config metadata identities. At most eight roots are retained; failed/changed markers do not hit this cache. Git writes still perform full validation. Diff reads query porcelain status for the literal selected file and omit ahead/behind calculation instead of scanning the full worktree.

The CodeDiff width pass computes ASCII columns directly after checking that the font is monospaced. Unicode and proportional-font lines keep exact native shaping, with a per-pane width cache limited to 256 lines/256 KiB. This removes repeated native per-line measurements without changing diff text or Git results.

`GitPane` renders one stable cell shell with reactive inner row variants, so recycled group/reference/stash cells do not keep the previous kind's layout. Repository management and worktree rows also use virtual Lists. QuickSwitcher groups native linked-worktree associations and recognized workspace worktree copies under existing main paths without deleting directories.

`RetainedPane` mounts a tab on first use and changes visibility without recreating its native list/editor. App retains independent working-diff, file-preview and commit-review panes, with file content scoped to the selected worktree. Tab changes do not inspect the repository or reread a ready preview. Explicit refreshes and Git mutations advance repositoryRevision, invalidating directory/history data. Hidden history cannot auto-select a commit or replace its reading anchor.

`script/verify-tab-navigation.py` traces fixture-only Git argv and checks loading states, expanded folders/search, refreshes and staging. Native/headless scenarios compare worktree/index/HEAD and file bytes.

## Verification fixtures

Rust integration tests create repositories under a unique operating-system temporary directory, configure identity in each fixture only, and remove the directory on drop. Fixtures cover a normal nested repository, a .git file repository, file status and diffs, stage/unstage/commit, branch switching, and fetch/pull/push through a local bare remote. No test writes to a real workspace repository or contacts a network remote.

`script/verify-library.py` creates disposable nested repositories and runs NSH UI tests for invalid paths, both import modes, deduplication, source switching, collapse/filter, refresh, removal, language switching and storage restoration. A fixture-only Git wrapper delays one real status read to verify loading feedback; the script checks that the delay was exercised. `--target macos` runs the same checks in the real host and saves screenshots. The automated tests use the path-entry form; selecting a folder in the system picker needs a manual check.

`script/verify-ui.py` checks hover hints, both languages, seven split boundaries, relative drags after reopening, multiline drafts and staging/unstaging after row recycling. It verifies fixture HEADs, index records, status and file bytes afterward. `script/verify-settings.py` checks all eight catalogs, placeholder preservation, locale fallback, five accents, system/forced appearance, legacy settings and restoration; headless checks also inspect resolved text colors.

`script/verify-workflows.py` drives context-menu Cherry-pick/Revert, branch creation/Rebase, Stash, conflict Abort and clone/init through real disposable Git state. It checks final refs, commit history, content and operation markers. Focused Rust workflow cases also cover stale plans, repository mismatch, dirty worktrees, conflict Continue/Abort, stash retention, tags and detached checkout.

## Local installation and diagnostics

`script/package-macos.py` uses NSH's official macOS packager, replaces the generated runner with `src/main.rs`, remaps build paths, retains private debug symbols, strips the distributed executable and signs the bundle ad hoc. Project and dependency licenses are copied into Resources. The runner initializes `src/diagnostics.rs` before NSH loads. It records runtime events, panics and session exit state; the `Diagnostics` native module exposes local paths to Settings. `App.tsx` uses NSH's ErrorBoundary with `FailurePane` for UI errors. Diagnostic reports are not uploaded. Signed application updates are described in [updates](updates.md).

Discovery uses a bounded parallel walker without Git-ignore filtering, pruning generated dependency/build trees and recognizing `.git` entries without a separate marker lookup per folder. It then inspects repositories with at most four workers and assembles the original nested tree in sorted order. Discovery and status phases have separate diagnostic events. The compact toolbar uses `Window.setTitleBar("hidden", 40)`, the `titleBar()` insets and `desktop.windowDrag`; AppKit retains the window buttons.

## Unicode diffs and file previews

`src/code_diff.rs` wraps the official NSH DiffView. NSH DiffView estimates width from character counts; CJK fallback glyphs are wider and could implicitly wrap over the next fixed-height row. The wrapper measures the patch lines with the native text engine inside the component's render scope, sets a matching minimum content width, and makes code rows non-wrapping. Word highlights and horizontal scrolling remain NSH's.

`src/files.rs` lists one folder at a time and reads bounded UTF-8 previews. It validates the selected Git root, relative paths and canonical containment. `FileBrowser` virtualizes the loaded tree and cancels stale updates by generation; `FilePreviewPane` uses the official read-only Editor. The application owns the Changes/Files/History tab and diff/file route, so repository refreshes preserve the view. Git actions reread an open file and supply a fresh repository snapshot to the browser.

Selected-repository details include `git worktree list --porcelain -z` results. `WorktreeList` shows this association separately from filesystem nesting. Selecting an external worktree opens an ordinary repository source; Git writes still target only the selected worktree.

## Incremental discovery and cache

`scan_jobs.rs` owns cancellable scans. It publishes cached rows and prefetched root/selection summaries before traversal, then revisions add repository results without blocking navigation. `App` polls while the source remains active, overlays the selected repository's fresh details, and cancels on source changes/unmount. A completion revision lets stale rows be removed; stopping retains a clearly partial list.

`repository_cache.rs` stores versioned flat snapshots in the host data directory. Atomic replacement and scan generations prevent an older cancelled job from overwriting a newer cache. Startup/Refresh revalidate cached paths only; explicit Rescan discovers new paths. Cache corruption is logged and triggers discovery. `RepositoryNode.cached` keeps old summaries visibly pending until refreshed.

`scan_rules.rs` centralizes language-specific generated-folder exclusions. Generic names use project context, and a real Git marker overrides a generated-folder name. `.gitignore` is not a discovery filter because nested source repositories are often ignored by their parent repository.

## Commit review

`history.rs` validates a full commit object ID and reads immutable metadata and NUL-delimited file records. Root commits use an empty-tree comparison; merge commits use their first parent. Per-file diffs validate membership in the selected commit, include both rename paths and use literal pathspecs with external diff/text conversion disabled. Viewing history never checks out a commit or changes the index.

The middle History list selects commits while the right `CommitReviewPane` shows metadata, a resizable virtualized file list and the official diff view. Request generations discard stale commit/file responses after another selection or unmount. Working changes remain a separate route with a fixed return action. Official desktop context menus expose object-specific actions on library entries, repositories, commits and files; history menus contain no Git writes.

`script/verify-history.py` exercises history selection, root/rename/delete/binary diffs, rapid selection, refresh, native right-click menus, nested/flat views, repository switching and bilingual labels. All repositories and Git mutations are disposable fixtures; the script checks that browsing leaves the worktree and index unchanged.

`historyPage` returns at most 50 commits, a fixed tip OID, the current tip OID and an optional next offset. Message/author filtering runs in Git with fixed-string matching over that snapshot; ID searches resolve a validated hexadecimal prefix and require ancestry from the selected tip. NUL-delimited records preserve field boundaries. Pagination does not append data from a moving HEAD; a new query or refresh starts a new snapshot. UI generations discard stale page results. The current implementation lets an already-started background Git read finish instead of killing its process.

`HistoryPane` owns the virtualized list and search/loading/error states. It records a visible-row or selected-row anchor as a page offset plus an index in that page, so returning can load the relevant page instead of rereading every previously visited row. Repository-bound callbacks prevent a disposed pane from changing another repository's selection. `CommitReviewPane` restores the saved file and makes that file visible in its list.

`repository-session.ts` validates and stores a separate versioned record for each canonical workdir. It keeps tab, draft text, file/commit selections and the history navigation anchor; it excludes live requests and diff contents and retains 20 recent sessions. App serializes storage writes so an older save cannot overwrite a newer one. Invalid saved data is left untouched; that launch keeps sessions in memory and shows the restoration error. `script/verify-history-navigation.py` covers more than one page, literal searches, reading anchors, independent nested-repo/worktree drafts and restart restoration with disposable repositories.

## NSH toolchain

Rust dependencies use the published `=0.3.0` crates. Capabilities such as Storage, locale and Clipboard come from `nsh`; Input comes from `nsh/base`, and tooltip slots contain the official Tooltip component. Rust imports use `nsh_core::prelude`.

`script/nsh_toolchain.py` checks the CLI version before packaging or UI verification, preferring `.nsh/toolchain/bin/nsh`. It accepts a globally installed CLI only when it is also 0.3.0. No script changes the user's global installation.

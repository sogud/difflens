# DiffLens

A compact desktop Git client for reviewing code changes across nested repositories. Built with Native Shell, it shows each repository's branch and working-tree status independently.

See [architecture](docs/architecture.md) for module boundaries and data contracts.

## Download

The first preview is [v0.1.0, build 18](https://github.com/sogud/difflens/releases/tag/v0.1.0), for **Apple Silicon Macs running macOS 14 or later**. Download `DiffLens-0.1.0-macos-arm64.zip`, quit any running copy, extract it and move `DiffLens.app` into Applications. Git must be available on PATH.

The app is ad hoc signed and is not notarized; macOS may require approval in **System Settings → Privacy & Security**. Automatic update checks and installation are not implemented. To update, download a newer release and replace the app after quitting it. Repository sources and preferences are stored separately from the app bundle.

## Name and domain

The product name is **DiffLens**. Cloudflare search on 2026-10-26 showed difflens.dev at $8.20 for the first year and $12.20 per year on renewal; difflens.app was $8.20 for the first year and $14.20 per year on renewal. Search availability is not a registration. Neither domain has been purchased; check availability and renewal pricing again before registering.

## Run

Requirements: NSH **0.3.0**, Rust, and Git on PATH. App dependencies are pinned to the published 0.3.0 crates. Keep the CLI and runtime at the same version.

Install the matching CLI into this project:

    cargo +stable install nsh-cli --version 0.3.0 --locked --root .nsh/toolchain

Then run:

    RUSTUP_TOOLCHAIN=stable .nsh/toolchain/bin/nsh run --target macos

Choose **Add repository…** to open one existing Git repository, or **Add directory…** to discover nested repositories in a workspace. Both open the system folder picker. To paste a path, choose **Add… → Enter a path…** in the library sidebar.

The library remembers multiple repositories and directories, the last selected repository in each, and the Nested/Flat view. The tree and list icons beside the filter switch these views; toolbar icons show bilingual tooltips and keep keyboard shortcuts. Click a library entry to switch, use the tree arrows to collapse nested repositories, and use **Refresh** to update known repositories while keeping the selection and commit draft. Use the folder-search icon or **⇧⌘R** to discover newly added repositories. The first changed file opens automatically.

Each library entry's **•••** menu can open its folder in the file manager or remove the entry from the library. Removing an entry leaves its files on disk. On macOS, **⌘O** adds a repository, **⇧⌘O** adds a directory, **⌘L** opens the path form, and **⌘R** refreshes.

Select a repository to inspect diffs, stage or unstage files, write a commit, switch or create a local branch, and run Fetch, Pull (fast-forward only), or Push.

The icon in the Changes sidebar header switches changed files between a compact folder tree and a flat list. Folders collapse independently in Staged and Unstaged. Flat rows show the file name before the directory. The diff header switches between side-by-side and unified views for both working changes and historical commits. The initial views are tree and side-by-side; both choices are saved.

Working-change tabs contain files you opened, in opening order. Each tab has a close button. Its context menu closes that tab, other tabs, tabs to the left or right, or all working-change tabs. **⌘W** closes the active working-change tab; **⇧⌘W** closes the window. Closing tabs leaves Git changes and commit drafts intact. Open tabs and an explicitly empty editor area are restored for each workdir.

The title bar has separate **Repository** and **Branch** pickers with search. Repository choices combine discovered paths, saved repositories, recent workdirs and available worktrees. Worktrees are collapsed under a main repository when native association or a matching `.worktrees/<task>/...` layout identifies that main path. Child rows show branch/task names, and search can find them. Choosing a repository or local branch switches it directly. **Manage repositories…** opens the advanced directory/library panel; opening a picker does not scan the filesystem.

The left rail's **Branches and Stash** icon opens a docked pane for local branches, remote-tracking references, tags and stashes. Click an item to select it; use its context menu or **More actions** for operations. New branch/tag names and stash descriptions use an inline form. Delete and history-changing actions show one automatically prepared preview and confirmation. Backend preparation and execution revalidation remain separate; the UI no longer requires a universal Review operation → Run operation sequence. Revert adds a compensating commit and preserves history.

Stash supports save (optionally including untracked files), apply, pop and confirmed deletion. Conflicts retain their Git state and show Continue, Skip or Abort where supported. Open a conflicted file in the system editor, resolve it, then use **Mark resolved** before continuing. This version has no inline three-way merge editor. Branch deletion is non-forced; conflicting stash pops retain the stash.

The library **+** menu also offers Clone and Create repository. Both create a new named directory under a selected parent; an existing destination is rejected.

Drag the dividers to resize navigation, Git references, worktrees, changed-file sections, the commit editor and historical review. Navigation and the editor share one native panel group, so divider movement resizes both in the core before drag-end persistence. Repository and worktree lists use virtual viewports. Panel sizes are saved across launches. The commit message and **Commit** button sit above the Changes lists. Enter adds a line; **⌘Enter** submits staged changes when that sidebar is active. Commit drafts remain scoped to the selected workdir.

Use the left rail's settings icon or press **⌘,** to choose an accent (Blue, Teal, Green, Rose or Amber), set the appearance to System, Light or Dark, and switch language. The interface supports 简体中文, English, 日本語, 한국어, Français, Deutsch, Español and Português. Choices apply immediately and are saved together; older language-only settings remain compatible. The first launch matches a supported system language or falls back to English. App labels and menus are translated; paths, branch names, commit contents and Git diagnostics retain their original text.

Loading, refresh, scan and Git-operation progress share one inline status in the window title bar. Content panes and dialogs report their activity there. Very short tasks do not flash the indicator, and visible progress has a brief minimum duration. Hover shows details, and a stop control remains available only while its cancellable scan is active. Errors and conflict actions stay in their relevant views.

## Install on this Mac

Build and install a local app bundle:

    python3 script/package-macos.py --install --run

The app is installed at `~/Applications/DiffLens.app`. Once installed, it runs without the NSH CLI or a development server; Git must still be available. Quit DiffLens before reinstalling. Omit `--install` to keep the bundle under `.nsh/out/`.

A matching debug-symbol bundle is saved at `.nsh/out/DiffLens.app.dSYM` for crash symbolication.

The GitHub preview uses this ad hoc signed bundle. Automatic updates are not implemented; releases are installed manually as described above.

## Scanning and cache

Directory imports open the root or last-selected repository first. Other repositories arrive in the background, so files and Git actions stay usable. The stop button retains the partial list and marks it incomplete.

Detected repository positions and last-known summaries are cached in the app data directory under `repository-cache-v1`. Startup and **Refresh / ⌘R** check those known paths instead of walking the full directory tree. Cached rows say **Pending refresh** until checked. **Rescan / ⇧⌘R** performs a new directory discovery and removes stale cached paths when complete.

Generated folders are skipped by default:

| Area | Examples |
| --- | --- |
| JavaScript | `node_modules`, `.pnpm-store`, `.next`, `.nuxt`, `.turbo`, `.vite`, `.svelte-kit` |
| Python | `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.tox` |
| Rust / JVM | `target`, `.gradle`, `.kotlin`, Android native-build caches |
| Swift / Flutter | `.build`, `DerivedData`, `Pods`, `Carthage`, `.dart_tool`, `.pub-cache`, `.fvm` |
| .NET / native | project `bin` / `obj`, `CMakeFiles`, `cmake-build-*`, Zig outputs |
| Other | `.cache`, tool caches, Haskell outputs, project `vendor` / Elixir `deps` |

Ambiguous build folders use neighboring project manifests. A directory that is itself a Git repository is retained, even when its name resembles a cache. Explicitly opening a repository or choosing an ignored folder as the scan root also works. Source directories and `.worktrees` are not blanket-excluded.

## History review

Choose **History / 历史**, then select a commit to see its message, author, changed files and diff. The first changed file opens automatically. The **Working changes** row or **Back to working changes** button returns to the current worktree without checking out the old commit.

History loads the current branch in pages of 50 using a fixed commit snapshot. Search the branch's history by commit message, author or commit ID (at least 7 hexadecimal characters); message and author searches treat text literally. Search covers the declared branch history, not just the loaded page. **Load older commits** continues the same snapshot; **Refresh history** starts at the current HEAD. If newer history is detected, a notice offers a refresh.

Root commits compare with the empty tree; merge commits compare with their first parent, shown above the file list. Renames retain both paths. Binary and rename-only changes show an explanation when there is no textual diff.

Each working directory remembers its tab, commit draft, working-file selection, preview, historical commit/file, search and history reading anchor. Within the current repository, visited tabs retain their native views and data; warm switches do not reread Git. Explicit refreshes and Git writes invalidate relevant data. Associated worktrees keep separate drafts. The 20 most recently used sessions are stored locally and restored between launches; native requests, busy states and diff contents are reread. Missing snapshots can be cleared with **Refresh history**. Changing selection ignores stale responses; it does not forcibly terminate an in-flight Git read.

Right-click a repository, library entry, history commit or file for its context menu. Menus include opening, copying paths or commit IDs, reviewing diffs and staging/unstaging current files. Historical file menus only read committed data. Nested/Flat views remain available beside the repository filter.

## Files and worktrees

Choose **Files / 文件** in the left icon rail to browse the selected repository, including unchanged and untracked files. Folders load when expanded. Text previews use NSH's read-only editor with line numbers and syntax highlighting; binary files and files over 2 MiB show their size and an explanation. Git metadata is hidden, and previews cannot follow a symbolic link outside the selected repository. Use the file-list refresh icon to reread the list and current preview.

**Associated worktrees / 关联 worktree** lists the selected repository's main and linked working directories, including paths outside the imported source. It shows their branches, current/main markers and availability. Click a worktree to view it. This version does not create, remove or prune worktrees.

## Logs and crash reports

Open **Settings → Diagnostics** to see the version, open logs or find crash reports. Installed-app logs are stored in `~/Library/Logs/DiffLens`:

- `events.jsonl`: startup, exit, native-action duration/outcome, operation errors and runtime errors; rotates at 2 MiB with three backups.
- `runtime.log`: stdout/stderr from the native runtime; rotates on launch when larger than 2 MiB.
- `panic-*.txt`: Rust panic details and backtraces; retains ten reports across launches.
- `session.json`: the last session's state. An unfinished session triggers a notice on the next launch; force quit and power loss can also cause it.

Settings also opens `~/Library/Logs/DiagnosticReports`, where macOS may write native crash reports. **Open latest report** appears when a matching report exists. UI rendering errors show a recovery screen with a log-folder shortcut. Reports remain local and are never uploaded. Error messages and backtraces may include local paths or remote addresses; inspect them before sharing.

Development and automated hosts use their own data directory instead. The executable supports `--diagnostics` to print its version and log paths without opening a window or changing the current session marker. `--scan /path/to/workspace` runs the same read-only scanner and reports repository/error counts for diagnosis.

## Scope

- Recognizes worktrees and submodules whose .git entry is a file, as well as repositories with a .git directory.
- Does not follow filesystem symlinks or descend into Git metadata.
- Directory discovery applies the generated-folder rules above. It uses up to eight workers; Git state reads are bounded to four. Git-ignored source repositories are still discoverable.
- Runs Git actions only on the selected repository after the user activates a control.
- Pull is fast-forward only. Rebase is an explicitly reviewed local operation; there is no force push, reset or discard action.
- Reports unreadable folders and repository status or operation errors.
- Automated tests use temporary repositories and local bare remotes only.

Framework commands:

    cargo test
    .nsh/toolchain/bin/nsh check
    .nsh/toolchain/bin/nsh build

The import and library workflow can be checked with disposable repositories:

    python3 script/verify-library.py
    python3 script/verify-library.py --target macos
    python3 script/verify-previews.py --target macos
    python3 script/verify-history.py --target macos
    python3 script/verify-history-navigation.py --target macos
    python3 script/verify-ui.py --target macos
    python3 script/verify-settings.py --target macos
    python3 script/verify-tab-navigation.py --target macos
    python3 script/verify-workflows.py --target macos

The macOS check saves light and dark screenshots under `.nsh/verification/`.

The app uses the mixed NSH template: TSX owns the desktop view and Rust owns filesystem discovery and Git status.

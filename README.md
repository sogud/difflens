# DiffLens

A compact desktop Git client for reviewing code changes across nested repositories. Built with Native Shell, it shows each repository's branch and working-tree status independently.

## Name and domain

The product name is **DiffLens**. Cloudflare search on 2026-10-26 showed difflens.dev at $8.20 for the first year and $12.20 per year on renewal; difflens.app was $8.20 for the first year and $14.20 per year on renewal. Search availability is not a registration. Neither domain has been purchased; check availability and renewal pricing again before registering.

## Run

Requirements: the NSH CLI built from NSH commit `5757911`, Rust, and Git on PATH. The app uses the official DiffView and ResizablePanelGroup components from that same commit; these are not in the published 0.2.0 crates yet.

On a new machine, install NSH from source, then build the pinned CLI revision:

    curl -fsSL https://nsh.dev/install.sh | env RUSTUP_TOOLCHAIN=stable sh -s -- --source
    git -C "$HOME/.nsh/source" checkout 5757911cf23d5a800fa1a353152bdbeeb5057d84
    env RUSTUP_TOOLCHAIN=stable cargo build --release --locked --manifest-path "$HOME/.nsh/source/Cargo.toml" -p nsh-cli

From this directory:

    nsh run --target macos

Choose **Add repository…** to open one existing Git repository, or **Add directory…** to discover nested repositories in a workspace. Both open the system folder picker. To paste a path, choose **Add… → Enter a path…** in the library sidebar.

The library remembers multiple repositories and directories, the last selected repository in each, and the Nested/Flat view. The tree and list icons beside the filter switch these views; toolbar icons show bilingual tooltips and keep keyboard shortcuts. Click a library entry to switch, use the tree arrows to collapse nested repositories, and use **Refresh** to update known repositories while keeping the selection and commit draft. Use the folder-search icon or **⇧⌘R** to discover newly added repositories. The first changed file opens automatically.

Each library entry's **•••** menu can open its folder in the file manager or remove the entry from the library. Removing an entry leaves its files on disk. On macOS, **⌘O** adds a repository, **⇧⌘O** adds a directory, **⌘L** opens the path form, and **⌘R** refreshes.

Select a repository to inspect diffs, stage or unstage files, write a commit, switch or create a local branch, and run Fetch, Pull (fast-forward only), or Push.

Use the toolbar settings icon or press **⌘,** to switch between English and 简体中文. Changes apply immediately and are saved. The first launch follows the system language. App labels and menus are translated; paths, branch names, commit contents and Git diagnostics retain their original text.

Imports show an animated indicator with the current step: opening a repository, scanning a directory, or reading repository details. Loading indicators also appear while restoring the library, reading diffs and running Git actions.

## Install on this Mac

Build and install a local app bundle:

    python3 script/package-macos.py --install --run

The app is installed at `~/Applications/DiffLens.app`. Once installed, it runs without the NSH CLI or a development server; Git must still be available. Quit DiffLens before reinstalling. Omit `--install` to keep the bundle under `.nsh/out/`.

A matching debug-symbol bundle is saved at `.nsh/out/DiffLens.app.dSYM` for crash symbolication.

This build uses ad hoc signing for local use. It is not a notarized distribution release. Publishing and update checks are deferred.

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

## Files and worktrees

Use **Files / 文件** beside Changes to browse the selected repository, including unchanged and untracked files. Folders load when expanded. Text previews use NSH's read-only editor with line numbers and syntax highlighting; binary files and files over 2 MiB show their size and an explanation. Git metadata is hidden, and previews cannot follow a symbolic link outside the selected repository. Use the file-list refresh icon to reread the list and current preview.

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
- Pull is fast-forward only; there is no force, reset, rebase, or discard action.
- Reports unreadable folders and repository status or operation errors.
- Automated tests use temporary repositories and local bare remotes only.

Framework commands:

    cargo test
    nsh check
    nsh build

The import and library workflow can be checked with disposable repositories:

    python3 script/verify-library.py
    python3 script/verify-library.py --target macos
    python3 script/verify-previews.py --target macos

The macOS check saves light and dark screenshots under `.nsh/verification/`.

The app uses the mixed NSH template: TSX owns the desktop view and Rust owns filesystem discovery and Git status.

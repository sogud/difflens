# Design boundaries

DiffLens is a compact native Git client. Rust owns filesystem, network, update installation and Git operations; NSH TSX owns presentation, selection and user interaction.

- Git reads and writes are scoped to the selected canonical workdir. Commands use argument arrays, validated inputs and literal file pathspecs. Revert preserves history; reset, discard and force-push UI are outside the current scope.
- Ordinary Git actions stay in the working view. Input forms are inline; destructive and history-changing actions require explicit confirmation and native revalidation.
- Repository, file and Git navigation dock beside the editor. Official native panel groups resize the content directly. The left rail is the task switcher.
- Lists are virtualized. Visited review panes retain one editor, and raw-diff caching is bounded. Staged and unstaged selections remain distinct.
- Workdir sessions keep drafts, opened files and reading state. Repository changes and asynchronous results preserve scope; stale results are ignored.
- UI text has eight language catalogs. Semantic theme colors, readable hierarchy, keyboard access and clear busy/error states apply throughout the desktop interface.
- Updates use signed GitHub release manifests, bounded downloads and explicit restart/install. Repositories and persistent settings are outside the installation scope. See [updates](updates.md).

Current behavior and installation requirements are described in the [README](../README.md); module contracts are described in [architecture](architecture.md).

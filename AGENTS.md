# DiffLens project rules

- Follow docs/design.md for current product scope and UI direction.
- Support nested repository tree and flat repository list views. Every displayed repository gets its own branch, status, and action scope.
- Keep repository discovery and Git commands in the Rust native module; keep presentation state in the NSH TSX UI.
- Invoke Git with argument arrays, never a shell. Validate repository roots and changed-file paths at the native-module boundary. Use literal pathspecs for file operations.
- Only run a Git operation against the repository selected in the UI. Do not add discard, reset, rebase, or force operations without a separate user request.
- Keep asynchronous Git work off the view thread. Return consistent errors for failed Git commands and refresh the selected repository after successful changes.
- Follow NSH's native desktop guidance: use semantic theme tokens, keyboard-reachable controls, visible selection and busy states, and native base components where appropriate.
- Tests must create temporary repositories and local bare remotes, set identity in those repositories only, and remove all fixtures. Never run write operations against workspace repositories as tests.
- Verify Rust changes with cargo fmt and focused cargo tests; verify TSX/native-module contracts with nsh check and run the macOS host when practical.
- Preserve parent-workspace changes. This project has its own Git repository. Do not commit, push, or publish this project's source without the user's authorization.

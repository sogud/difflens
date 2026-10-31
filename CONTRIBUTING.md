# Contributing

Open an issue describing the problem or proposed change before substantial work. Keep pull requests focused, preserve workdir boundaries and describe any user-visible behavior change.

- Follow [design boundaries](docs/design.md) and the native Rust / NSH interface.
- Use argument arrays and validate repository paths for Git operations. Never use a real working repository as a fixture.
- Include the relevant checks you ran and clearly state checks you skipped. Use the existing focused checks; avoid unrelated refactors or dependency updates.
- AI-assisted contributions are welcome when the contributor reviews the result, can explain it and verifies its scope. Do not include raw conversations, private prompts, credentials or internal research material.
- Preserve upstream copyright and license notices. Contributions are provided under this project's Apache-2.0 license unless explicitly agreed otherwise.

For security concerns, follow [SECURITY.md](SECURITY.md) rather than posting sensitive details in a public issue.

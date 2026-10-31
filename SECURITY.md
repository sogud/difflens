# Security

DiffLens is currently Beta software. Security fixes target the latest Beta; older previews may be withdrawn when a safer build is available.

Report vulnerabilities through GitHub private vulnerability reporting when it is available for this repository. Otherwise contact the maintainer through [the GitHub profile](https://github.com/sogud) to arrange a private channel before sending details. Do not publish credentials, private repository paths, exploit payloads or diagnostic logs in a public issue.

Useful reports identify the affected version, platform, expected scope and a minimal reproduction using disposable data. Redact personal paths and remote addresses from logs.

Security-sensitive areas include selected-repository Git writes, filesystem containment, persisted drafts and signed update verification/installation. Update signing keys must stay outside this repository and distribution assets; only the verification public key is included in source.

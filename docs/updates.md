# Beta updates

DiffLens checks the `sogud/difflens` GitHub releases at startup and every six hours while running. Automatic checks can be disabled in Settings. **DiffLens → Check for Updates…** opens the update controls. The Beta channel accepts newer signed Beta and stable builds; a stable channel excludes Beta manifests. Build numbers must increase across releases.

An available update appears in the title bar. The user chooses **Download update**, then **Restart and install**. Downloads and checks run off the view thread. Git actions and scans must finish before installation, and the app waits for its workdir sessions, drafts, library and preferences to save before closing.

The updater is available only for the installed Apple Silicon macOS app in `/Applications` or `~/Applications`. Version 0.1.0/build18 has no updater and needs one manual installation of the first updater-enabled Beta. Development hosts do not install updates.

## Private releases

The repository is currently private. Updates use an installed GitHub CLI (`gh`) authenticated with access to this repository. DiffLens invokes scoped `gh api` requests; it never extracts a token or stores one in settings, a URL or a log. If `gh` is absent, system HTTPS requests can access public releases; private releases report the authentication requirement. Normal Git work does not require `gh`.

## Verification and replacement

Each updatable release includes:

- `DiffLens-<tag-without-v>-macos-arm64.zip`
- `DiffLens-update.json`: schema 1, bundle version/build, release tag/channel, bundle ID, architecture, minimum OS, archive name/length and SHA-256.
- `DiffLens-update.sig`: detached Ed25519 signature over the exact manifest bytes, encoded as hexadecimal.

`update-config.json` contains the repository, channel and trusted public key. The native updater verifies the signature before accepting the manifest, rejects older builds and validates the complete archive hash before extraction. Archive paths, entry count, expanded size and symlinks are checked; the extracted bundle must have the expected identity, version, Apple Silicon executable and a valid code signature. Ad hoc signing remains separate from the update-manifest signature; these Beta packages are not notarized.

The installer copies the verified app to a sibling on the installed app's filesystem. A detached copy of the current executable watches its original process through kqueue; it never forces the original app to exit. It serializes installers with a file lock and checks that no other DiffLens instance is using the target. After exit it revalidates the target/staging scope and exchanges the bundles atomically.

The new process must acknowledge a restored initial layout within 45 seconds and stay alive for a short startup interval. On failure, the installer stops only its own new process group, swaps the previous bundle back and reopens it. If the restore exchange itself fails, it preserves and attempts to open the previous bundle from its staging location, with recovery information retained in the update cache and shown by the old updater-equipped app. Recovery does not overwrite repositories, app preferences or workdir drafts.

Downloads and installer state live under `~/Library/Caches/com.sogud.difflens/updates/`, separate from app settings. A failed installer keeps `install-error.txt`; recovery information uses `last-install-error.txt`. A successful installation removes its own staging/cache job. A downloaded update is held for the current launch; if the app closes before installation, check/download again after reopening.

## Publishing

Build normally, then sign/archive the existing bundle:

```sh
RUSTUP_TOOLCHAIN=stable CARGO_NET_OFFLINE=true python3 script/package-macos.py
python3 script/release-macos.py --tag v0.1.1-beta.1 --out tmp/content-first/release-0.1.1-beta.1
```

Keep `Cargo.toml` and `nsh.json` at the same numeric bundle version. Increment `nsh.json`'s build for every distributed build. The GitHub tag may append `-beta.N`; the manifest records both the tag and numeric bundle version.

The release signing private key is outside Git at `~/Library/Application Support/DiffLens/release-signing/ed25519-private.pem`, mode 0600. Keep it available for future releases; do not replace it casually, because installed clients trust the existing public key. `release-macos.py` refuses a private key whose derived public key differs from `update-config.json`. It outputs the ZIP, signed manifest, signature and SHA256SUMS. Upload those to the same tagged GitHub release. Keep debug symbols private; the optional `--symbols` output is for a private symbol archive, not public attachments. Beta releases use GitHub's prerelease flag.

## Verification limits

This implementation was reviewed in source and built/packaged normally. Automated fault injection and a live cross-version upgrade exercise have not been completed. A successful build and signed release do not establish that every install/rollback path has been exercised.

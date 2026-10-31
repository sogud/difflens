#!/usr/bin/env python3
"""Archive an existing macOS bundle and sign its GitHub update manifest."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--key", type=Path, default=Path.home() / "Library/Application Support/DiffLens/release-signing/ed25519-private.pem")
    parser.add_argument("--symbols", action="store_true")
    args = parser.parse_args()
    config = json.loads((ROOT / "nsh.json").read_text())
    updates = json.loads((ROOT / "update-config.json").read_text())
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-beta\.\d+)?", args.tag) or args.tag[1:].split("-", 1)[0] != config["version"]:
        parser.error("The release tag must match the bundle version, optionally followed by -beta.N.")
    if not args.key.is_file():
        parser.error("The persistent release signing key is missing. Do not generate a replacement for an existing update channel.")
    if args.key.stat().st_mode & 0o077:
        parser.error("The release signing key must be readable only by its owner (chmod 600).")
    openssl = next((str(path) for path in [Path("/opt/homebrew/opt/openssl@3/bin/openssl"), Path("/usr/local/opt/openssl@3/bin/openssl")] if path.is_file()), None) or shutil.which("openssl")
    if not openssl:
        parser.error("OpenSSL with Ed25519 support is required for signing.")
    public_der = subprocess.check_output([openssl, "pkey", "-in", str(args.key), "-pubout", "-outform", "DER"], stderr=subprocess.PIPE)
    if len(public_der) != 44 or public_der[:12].hex() != "302a300506032b6570032100" or public_der[-32:].hex() != updates["publicKey"]:
        parser.error("The signing key does not match the public key trusted by this app.")
    bundle = ROOT / ".nsh/out/DiffLens.app"
    info = plistlib.loads((bundle / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != config["id"] or info.get("CFBundleShortVersionString") != config["version"] or str(info.get("CFBundleVersion")) != str(config["build"]) or info.get("LSMinimumSystemVersion") != "14.0":
        parser.error("The packaged bundle metadata does not match the current release.")
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True)
    subprocess.run(["lipo", "-verify_arch", "arm64", str(bundle / "Contents/MacOS/DiffLens")], check=True)
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"DiffLens-{args.tag[1:]}-macos-arm64.zip"
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(bundle), str(archive)], check=True)
    manifest = {
        "schema": 1, "version": config["version"], "build": config["build"], "tag": args.tag,
        "channel": "beta" if "-beta." in args.tag else "stable", "bundleId": config["id"],
        "architecture": "arm64", "minimumSystemVersion": "14.0", "archive": archive.name,
        "size": archive.stat().st_size, "sha256": hashlib.file_digest(archive.open("rb"), "sha256").hexdigest(),
    }
    manifest_path = output / "DiffLens-update.json"
    manifest_path.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
    signature = subprocess.check_output([openssl, "pkeyutl", "-sign", "-rawin", "-inkey", str(args.key), "-in", str(manifest_path)], stderr=subprocess.PIPE)
    if len(signature) != 64:
        raise RuntimeError("OpenSSL returned an invalid Ed25519 signature.")
    signature_path = output / "DiffLens-update.sig"
    signature_path.write_text(signature.hex() + "\n")
    assets = [archive, manifest_path, signature_path]
    if args.symbols:
        symbols = output / f"DiffLens-{args.tag[1:]}-macos-arm64.dSYM.zip"
        subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(ROOT / ".nsh/out/DiffLens.app.dSYM"), str(symbols)], check=True)
        assets.append(symbols)
    checks = []
    for path in assets:
        with path.open("rb") as file:
            checks.append(hashlib.file_digest(file, "sha256").hexdigest() + "  " + path.name)
    checksum_path = output / "SHA256SUMS"
    checksum_path.write_text("\n".join(checks) + "\n")
    assets.append(checksum_path)
    for path in assets:
        print(path)


if __name__ == "__main__":
    main()

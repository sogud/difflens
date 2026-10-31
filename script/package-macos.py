#!/usr/bin/env python3
"""Package DiffLens locally with NSH and the diagnostics-enabled native runner."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import shlex
import hashlib
import subprocess
import sys
import tempfile
from nsh_toolchain import nsh_command

PROJECT = Path(__file__).resolve().parent.parent


def run(*arguments, env=None):
    subprocess.run([str(argument) for argument in arguments], cwd=PROJECT, env=env, check=True)


def require_matching_bundle(path, identifier):
    with (path / "Contents/Info.plist").open("rb") as file:
        actual = plistlib.load(file).get("CFBundleIdentifier")
    if actual != identifier:
        raise RuntimeError(f"Refusing to replace {path}: bundle identifier is {actual!r}.")


def install(bundle, identifier):
    destination = Path.home() / "Applications" / bundle.name
    if destination.exists():
        require_matching_bundle(destination, identifier)
        processes = subprocess.check_output(["ps", "-axo", "comm="], text=True).splitlines()
        executable = str(destination / "Contents/MacOS" / bundle.stem)
        if executable in (process.strip() for process in processes):
            raise RuntimeError("Quit DiffLens before replacing the installed app.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".difflens-install-", dir=destination.parent) as temporary:
        staging = Path(temporary) / bundle.name
        backup = Path(temporary) / "previous.app"
        shutil.copytree(bundle, staging)
        if destination.exists():
            destination.rename(backup)
        try:
            staging.rename(destination)
        except BaseException:
            if backup.exists():
                backup.rename(destination)
            raise
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", help="install into ~/Applications")
    parser.add_argument("--run", action="store_true", help="open the resulting app")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("macOS packaging requires a Mac.")
    cli = nsh_command()
    config = json.loads((PROJECT / "nsh.json").read_text())
    env = dict(os.environ)
    env.setdefault("RUSTUP_TOOLCHAIN", "stable")
    mappings = [(str(Path.home()), "/build"), (str(PROJECT), "/build/difflens")]
    encoded = env.get("CARGO_ENCODED_RUSTFLAGS")
    rust_flags = encoded.split("\x1f") if encoded else shlex.split(env.get("RUSTFLAGS", ""))
    rust_flags.extend(f"--remap-path-prefix={source}={target}" for source, target in mappings)
    env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(rust_flags)
    for variable in ("CFLAGS", "CXXFLAGS"):
        flags = shlex.split(env.get(variable, ""))
        for source, target in mappings:
            flags.extend((f"-ffile-prefix-map={source}={target}", f"-fdebug-prefix-map={source}={target}"))
        env[variable] = shlex.join(flags)
    notices = PROJECT / "THIRD_PARTY_NOTICES.md"
    lock_hash = hashlib.sha256((PROJECT / "Cargo.lock").read_bytes()).hexdigest()
    if not notices.is_file() or f"Cargo.lock SHA-256: {lock_hash}" not in notices.read_text():
        raise RuntimeError("Regenerate dependency notices with python3 script/third-party-notices.py before packaging.")
    metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--no-deps", "--format-version", "1"], cwd=PROJECT, env=env, text=True))
    package = next(package for package in metadata["packages"] if package["manifest_path"] == str(PROJECT / "Cargo.toml"))
    if package["version"] != config["version"]:
        raise RuntimeError("Keep Cargo.toml and nsh.json versions in sync.")
    run("cargo", "build", "--release", "--locked", "--bin", "difflens-runner", env=env)
    output = PROJECT / ".nsh/out"
    run(cli, "package", "--target", "macos", "--out", output, env=env)
    bundle = output / f'{config["name"]}.app'
    require_matching_bundle(bundle, config["id"])
    # Keep NSH's bundle, assets and icon; replace only its generated entry point.
    runner = Path(metadata["target_directory"]) / "release/difflens-runner"
    run("dsymutil", runner, "-o", output / f'{config["name"]}.app.dSYM')
    executable = bundle / "Contents/MacOS" / config["name"]
    shutil.copy2(runner, executable)
    run("strip", "-S", executable)
    resources = bundle / "Contents/Resources"
    shutil.copyfile(notices, resources / "ThirdPartyNotices.txt")
    shutil.copyfile(PROJECT / "LICENSE", resources / "LICENSE")
    shutil.copyfile(PROJECT / "NOTICE", resources / "NOTICE")
    private_prefix = str(Path.home()).encode() + b"/"
    for path in bundle.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        tail = b""
        with path.open("rb") as file:
            while block := file.read(128 * 1024):
                data = tail + block
                if private_prefix in data:
                    raise RuntimeError("The app bundle still contains a local home path; distribution was stopped.")
                tail = data[-len(private_prefix):]
    run("codesign", "--force", "--sign", "-", "--timestamp=none", bundle)
    run("plutil", "-lint", bundle / "Contents/Info.plist")
    run("codesign", "--verify", "--deep", "--strict", bundle)
    if args.install:
        bundle = install(bundle, config["id"])
        run("codesign", "--verify", "--deep", "--strict", bundle)
    print(f"DiffLens app: {bundle}")
    if args.run:
        run("open", bundle)


if __name__ == "__main__":
    main()

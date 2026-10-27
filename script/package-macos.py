#!/usr/bin/env python3
"""Package DiffLens locally with NSH and the diagnostics-enabled native runner."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

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
    config = json.loads((PROJECT / "nsh.json").read_text())
    env = dict(os.environ)
    env.setdefault("RUSTUP_TOOLCHAIN", "stable")
    metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--no-deps", "--format-version", "1"], cwd=PROJECT, env=env, text=True))
    package = next(package for package in metadata["packages"] if package["manifest_path"] == str(PROJECT / "Cargo.toml"))
    if package["version"] != config["version"]:
        raise RuntimeError("Keep Cargo.toml and nsh.json versions in sync.")
    run("cargo", "build", "--release", "--locked", "--bin", "difflens-runner", env=env)
    output = PROJECT / ".nsh/out"
    run("nsh", "package", "--target", "macos", "--out", output, env=env)
    bundle = output / f'{config["name"]}.app'
    require_matching_bundle(bundle, config["id"])
    # Keep NSH's bundle, assets and icon; replace only its generated entry point.
    runner = Path(metadata["target_directory"]) / "release/difflens-runner"
    run("dsymutil", runner, "-o", output / f'{config["name"]}.app.dSYM')
    shutil.copy2(runner, bundle / "Contents/MacOS" / config["name"])
    shutil.copyfile(PROJECT / "assets/icons/LICENSE", bundle / "Contents/Resources/ThirdPartyNotices.txt")
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

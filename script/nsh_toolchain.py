"""Resolve the matching project-local or installed NSH CLI."""
from pathlib import Path
import shutil
import subprocess

PROJECT = Path(__file__).resolve().parent.parent
REQUIRED_VERSION = "0.3.0"


def nsh_command():
    local = PROJECT / ".nsh/toolchain/bin/nsh"
    candidate = str(local) if local.is_file() else shutil.which("nsh")
    if candidate:
        version = subprocess.check_output([candidate, "--version"], text=True).strip()
        if version.split()[:2] == ["nsh", REQUIRED_VERSION]:
            return candidate
    raise RuntimeError("NSH 0.3.0 is required. Install it with: cargo +stable install nsh-cli --version 0.3.0 --locked --root .nsh/toolchain")

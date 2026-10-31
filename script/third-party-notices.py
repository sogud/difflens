#!/usr/bin/env python3
"""Generate distribution notices from the locked macOS dependency graph."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
LICENSE_NAME = re.compile(r"^(LICENSE|LICENCE|NOTICE|COPYING|COPYRIGHT)([._-].*)?$", re.I)
SOURCE_EXTENSIONS = {".rs", ".c", ".h", ".cpp", ".py", ".toml", ".json"}


def main():
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--offline", "--locked", "--format-version", "1",
        "--filter-platform", "aarch64-apple-darwin",
    ], cwd=ROOT, text=True))
    packages = {p["id"]: p for p in metadata["packages"]}
    nodes = {n["id"]: n for n in metadata["resolve"]["nodes"]}
    root_id = metadata["resolve"]["root"]
    selected, pending = set(), [root_id]
    while pending:
        key = pending.pop()
        if key in selected:
            continue
        selected.add(key)
        pending.extend(d["pkg"] for d in nodes[key]["deps"] if any(k["kind"] != "dev" for k in d["dep_kinds"]))
    upstream = json.loads((ROOT / "third-party/upstream/sources.json").read_text())
    upstream_by_key = {(entry["repository"].removesuffix(".git"), entry["commit"]): entry for entry in upstream}
    texts = {}
    entries = []

    def include(text):
        text = text.replace("\r\n", "\n").strip() + "\n"
        key = hashlib.sha256(text.encode()).hexdigest()[:16]
        texts[key] = text
        return key

    for package in sorted((packages[key] for key in selected if key != root_id), key=lambda p: (p["name"], p["version"])):
        base = Path(package["manifest_path"]).parent
        files = sorted(p for p in base.rglob("*") if p.is_file() and LICENSE_NAME.match(p.name) and p.suffix.lower() not in SOURCE_EXTENSIONS)
        sources = []
        refs = []
        for path in files:
            refs.append(include(path.read_text(encoding="utf-8")))
            sources.append(path.relative_to(base).as_posix())
        if not refs:
            vcs_file = base / ".cargo_vcs_info.json"
            vcs = json.loads(vcs_file.read_text())["git"]["sha1"] if vcs_file.exists() else ""
            repository = (package.get("repository") or "").removesuffix(".git")
            source = upstream_by_key.get((repository, vcs))
            if source and source.get("files"):
                for item in source["files"]:
                    refs.append(include((ROOT / item["local"]).read_text()))
                    sources.append(f'{repository}/blob/{vcs}/{item["path"]}')
            elif "Apache-2.0" in (package.get("license") or "") and " AND " not in package["license"]:
                refs.append(include((ROOT / "LICENSE").read_text()))
                sources.append("Apache-2.0 text; selected from the package's declared alternatives")
            else:
                raise RuntimeError(f'Missing license text for {package["name"]} {package["version"]}; obtain the exact upstream notice before distributing.')
        entries.append({
            "name": package["name"], "version": package["version"], "license": package.get("license"),
            "repository": package.get("repository"), "authors": package.get("authors", []),
            "sources": sources, "texts": sorted(set(refs)),
        })
    icon_ref = include((ROOT / "assets/icons/LICENSE").read_text())
    lock_hash = hashlib.sha256((ROOT / "Cargo.lock").read_bytes()).hexdigest()
    lines = ["# Third-party notices", "", f"Cargo.lock SHA-256: {lock_hash}", "Target: aarch64-apple-darwin; non-development build/runtime dependency closure.", "", "Third-party components retain their own licenses. Package author and license declarations below come from Cargo metadata. Texts are preserved from packaged upstream files or the exact recorded upstream commit; declared Apache-2.0 alternatives use the full Apache-2.0 text. Optional platform/build components may not all be present in every binary.", "", "## Icons", "", f"Lucide / Feather — text {icon_ref}; see assets/icons/LICENSE.", "", "## Dependency inventory", ""]
    for entry in entries:
        lines.extend([f'### {entry["name"]} {entry["version"]}', f'- Declared license: {entry["license"]}', f'- Upstream: {entry["repository"] or "crates.io"}'])
        if entry["authors"]:
            lines.append("- Package authors: " + "; ".join(entry["authors"]))
        lines.append("- License/notice sources: " + "; ".join(entry["sources"]))
        lines.append("- Texts: " + ", ".join(entry["texts"]))
        lines.append("")
    lines.extend(["## License and notice texts", ""])
    for key, text in sorted(texts.items()):
        lines.extend([f"### Text {key}", "", "~~~~", text.rstrip(), "~~~~", ""])
    (ROOT / "THIRD_PARTY_NOTICES.md").write_text("\n".join(lines))
    print(f"Generated notices for {len(entries)} dependency packages and {len(texts)} unique license/notice texts.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Verify Unicode diffs, associated worktrees and read-only files in disposable repositories."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
from nsh_toolchain import nsh_command

PROJECT = Path(__file__).resolve().parent.parent


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)


STEPS = r'''
import { expect, open, test } from "nsh/test";
const root = FIXTURE_ROOT;
const linked = LINKED_ROOT;
const entry = APP_ENTRY;
const key = "difflens.library.v1";
const storage = { [key]: JSON.stringify({ sources: [{ kind: "repository", path: root, selectedPath: root }], activeKey: "repository:" + root, mode: "nested" }) };

test("Unicode diff and clean files remain readable", async () => {
  if (NATIVE) {
    const before = await open(RAW_ENTRY, { platform: "macos", locale: "en-US", width: 640, height: 460 });
    await before.screenshot(BEFORE_IMAGE);
  }
  const app = await open(entry, { platform: "macos", locale: "en-US", storage, width: 1180, height: 760 });
  await app.waitUntil(() => app.shows("label:Show diff for schema.yaml") && app.enabled("label:Show diff for schema.yaml"), { timeout: 15000 });
  await app.press("label:Show diff for schema.yaml");
  await app.waitFor("id:review-diff", { timeout: 15000 });
  expect(app.shows("DiffLens encountered an error")).toBe(false);
  if (NATIVE) await app.screenshot(AFTER_IMAGE);
  await app.press("id:files-tab");
  await app.waitFor("label:Toggle folder docs");
  expect(app.shows("label:Toggle folder .git")).toBe(false);
  await app.press("label:Toggle folder docs");
  await app.waitFor("label:Preview file docs/unchanged.md");
  await app.press("label:Preview file docs/unchanged.md");
  await app.waitFor("id:file-preview-editor", { timeout: 10000 });
  expect(app.shows("Read-only")).toBe(true);
  await app.press("label:Select repository repo");
  expect(app.shows("id:file-preview-editor")).toBe(true);
  await app.press("label:Refresh current source");
  await app.waitUntil(() => app.enabled("label:Refresh current source") && app.shows("id:file-preview-editor") && app.shows("id:file-browser"), { timeout: 15000 });
  if (!app.shows("label:Preview file docs/unchanged.md")) {
    await app.press("label:Toggle folder docs");
    await app.waitFor("label:Preview file docs/unchanged.md");
  }
  await app.rightClick("label:Preview file docs/unchanged.md");
  await app.waitUntil(() => app.menu() !== null, { timeout: 3000 });
  await app.chooseMenuItem("Copy file path");
  expect(app.clipboard()).toBe("docs/unchanged.md");
  if (NATIVE) await app.screenshot(FILES_IMAGE);
  await app.press("id:refresh-files");
  await app.waitFor("id:file-preview-editor");
  await app.press("label:Preview file binary.png");
  await app.waitFor("Binary file · text preview unavailable");
  await app.press("label:Preview file large.txt");
  await app.waitFor("File is larger than the 2 MiB preview limit");
}, 90000);

test("linked worktrees outside a source can be opened", async () => {
  const app = await open(entry, { platform: "macos", locale: "en-US", storage, width: 1180, height: 760 });
  await app.waitUntil(() => app.shows("label:Open worktree " + linked) && app.enabled("label:Open worktree " + linked), { timeout: 15000 });
  await app.press("label:Open worktree " + linked);
  await app.waitUntil(() => JSON.parse(app.storage()[key]).activeKey === "repository:" + linked && app.enabled("label:Refresh current source"), { timeout: 15000 });
  expect(app.enabled("label:Open worktree " + root)).toBe(true);
  expect(app.enabled("label:Open worktree " + linked)).toBe(false);
  await app.press("id:files-tab");
  await app.waitFor("label:Toggle folder docs");
  await app.press("label:Toggle folder docs");
  await app.waitFor("label:Preview file docs/unchanged.md");
  await app.press("label:Preview file docs/unchanged.md");
  await app.waitFor("id:file-preview-editor");
  if (NATIVE) await app.screenshot(WORKTREES_IMAGE);
  await app.press("id:open-settings");
  await app.press("id:choose-language");
  await app.press("id:language-zh");
  await app.waitFor("修改后立即生效。");
  await app.press("id:close-settings");
  expect(app.shows("只读")).toBe(true);
  expect(app.shows("关联 worktree")).toBe(true);
}, 90000);
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["macos"])
    args = parser.parse_args()
    output = PROJECT / ".nsh/verification"
    output.mkdir(parents=True, exist_ok=True)
    test_file = output / "previews.test.ts"
    raw_file = output / "raw-unicode-diff.tsx"
    with tempfile.TemporaryDirectory(prefix="difflens-previews-") as temporary:
        root = Path(temporary).resolve() / "repo"
        linked = Path(temporary).resolve() / "linked worktree"
        root.mkdir()
        git(root, "init", "--initial-branch=main")
        git(root, "config", "user.name", "DiffLens Fixture")
        git(root, "config", "user.email", "fixture@example.invalid")
        (root / "docs").mkdir()
        clean = "# UNCHANGED_PREVIEW_MARKER\n\n未修改的中文文件，支持只读预览。\n"
        (root / "docs/unchanged.md").write_text(clean)
        (root / "binary.png").write_bytes(b"\x89PNG\x00fixture")
        sentence = "中文与 ASCII mixed words，用于验证长行和词级高亮，emoji 🙂 与制表符\t都应正确显示。"
        before = "---\ndescription: >-\n  " + sentence * 5 + "旧内容\n  下一逻辑行不应与上一行重叠。\nend_marker: END_OF_FILE\n---\n"
        after = before.replace("旧内容", "新增说明与修改后的内容").replace("mixed words", "changed words")
        (root / "schema.yaml").write_text(before)
        git(root, "add", "--", ".")
        git(root, "commit", "-m", "preview fixtures")
        git(root, "worktree", "add", "-b", "feature", str(linked))
        (root / "schema.yaml").write_text(after)
        with (root / "large.txt").open("wb") as file:
            file.truncate(2 * 1024 * 1024 + 1)
        patch = git(root, "diff", "--", "schema.yaml").decode()
        raw_file.write_text('import { mount } from "nsh";\nimport { DiffView } from "nsh/base";\nmount(() => <DiffView patch={' + json.dumps(patch) + '} layout="unified" fontFamily="Menlo" fontSize={12} lineHeight={18} class="flex-1 bg-background text-foreground" />);\n')
        replacements = {
            "FIXTURE_ROOT": json.dumps(str(root)), "LINKED_ROOT": json.dumps(str(linked)),
            "APP_ENTRY": json.dumps(str(PROJECT / "App.tsx")), "RAW_ENTRY": json.dumps(str(raw_file)),
            "NATIVE": "true" if args.target else "false",
            "BEFORE_IMAGE": json.dumps(str(output / "unicode-before.png")),
            "AFTER_IMAGE": json.dumps(str(output / "unicode-after.png")),
            "FILES_IMAGE": json.dumps(str(output / "files-preview.png")),
            "WORKTREES_IMAGE": json.dumps(str(output / "worktrees-preview.png")),
        }
        code = STEPS
        for token, value in replacements.items():
            code = code.replace(token, value)
        test_file.write_text(code)
        command = [nsh_command(), "test", str(test_file)]
        if args.target:
            command += ["--target", args.target]
        try:
            subprocess.run(command, cwd=PROJECT, env=dict(os.environ, RUSTUP_TOOLCHAIN="stable"), check=True)
            assert (root / "docs/unchanged.md").read_text() == clean
            assert (linked / "docs/unchanged.md").read_text() == clean
            assert not git(root, "diff", "--cached")
            print("Preview checks passed; fixture files stayed unchanged.")
        finally:
            test_file.unlink(missing_ok=True)
            raw_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

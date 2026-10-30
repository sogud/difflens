#!/usr/bin/env python3
"""Verify commit browsing and context menus with disposable nested repositories."""
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


def init(root):
    root.mkdir(parents=True)
    git(root, "init", "--initial-branch=main")
    git(root, "config", "user.name", "DiffLens Fixture")
    git(root, "config", "user.email", "fixture@example.invalid")


def commit(root, message):
    git(root, "add", "--", ".")
    git(root, "commit", "-m", message)
    return git(root, "rev-parse", "HEAD").decode().strip()


STEPS = r'''
import { expect, open, test } from "nsh/test";
const root = ROOT;
const first = FIRST;
const second = SECOND;
const latest = LATEST;
const key = "difflens.library.v1";
const storage = { [key]: JSON.stringify({ sources: [{ kind: "directory", path: root, selectedPath: root }], activeKey: "directory:" + root, mode: "nested" }) };

async function chooseContextItem(app, selector, label) {
  await app.rightClick(selector);
  await app.waitUntil(() => app.menu() !== null, { timeout: 3000 });
  await app.chooseMenuItem(label);
}

test("history commits, files, menus and working changes stay in their repository", async () => {
  const app = await open(ENTRY, { platform: "macos", locale: "en-US", storage, width: 1280, height: 800 });
  await app.waitUntil(() => app.shows("label:Select repository child") && !app.shows("id:background-scan") && app.enabled("label:Refresh current source"), { timeout: 20000 });
  await app.waitFor("label:Stage current.txt");
  await chooseContextItem(app, "label:Show diff for current.txt", "Stage");
  await app.waitFor("label:Unstage current.txt");
  await app.waitUntil(() => app.enabled("label:Commit message"));
  await app.type("label:Commit message", "draft survives history review");
  await chooseContextItem(app, "label:Show diff for current.txt", "Unstage");
  await app.waitFor("label:Stage current.txt");
  await app.press("id:history-tab");
  await app.waitFor("id:commit-file:deleted.txt", { timeout: 15000 });
  await app.press("id:history-commit:" + second);
  await app.waitFor("id:commit-file:renamed.txt");
  await app.press("id:commit-file:renamed.txt");
  await app.waitFor("No textual diff is available for this file.");
  await app.press("id:commit-file:binary.dat");
  await app.waitFor("No textual diff is available for this file.");
  await chooseContextItem(app, "id:commit-file:renamed.txt", "Copy file path");
  expect(app.clipboard()).toBe("renamed.txt");
  await chooseContextItem(app, "id:history-commit:" + first, "View commit");
  await app.waitFor("Initial commit · compared with empty tree");
  await app.waitFor("id:commit-file:original.txt");
  await app.press("id:commit-file:original.txt");
  await app.waitFor("id:review-diff");
  expect(app.shows("id:commit-file:renamed.txt")).toBe(false);
  await chooseContextItem(app, "id:history-commit:" + first, "Copy commit ID");
  expect(app.clipboard()).toBe(first);
  await app.scroll("id:commit-file-list", 2000);
  await app.waitFor("id:commit-file:z-file-049.txt");
  await chooseContextItem(app, "id:commit-file:z-file-049.txt", "Copy file path");
  expect(app.clipboard()).toBe("z-file-049.txt");
  await app.press("id:commit-file:z-file-049.txt");
  await app.waitFor("id:review-diff");
  // Select again before the previous async read necessarily completes.
  await app.press("id:history-commit:" + second);
  await app.press("id:history-commit:" + latest);
  await app.waitFor("id:commit-file:deleted.txt");
  await app.press("id:commit-file:deleted.txt");
  await app.waitFor("id:review-diff");
  if (NATIVE) await app.screenshot(IMAGE);
  await app.press("label:Refresh current source");
  await app.waitUntil(() => app.enabled("label:Refresh current source") && app.shows("id:commit-file:deleted.txt"), { timeout: 15000 });
  await app.press("id:back-to-wip");
  await app.waitFor("Working tree · current.txt");
  expect(app.value("label:Commit message")).toBe("draft survives history review");
  await app.press("id:history-tab");
  await app.waitFor("id:commit-file:deleted.txt");
  await chooseContextItem(app, "label:Select repository child", "Open repository child");
  await app.waitFor("id:commit-file:child.txt");
  expect(app.shows("id:commit-file:deleted.txt")).toBe(false);
  await app.press("id:view-flat");
  expect(app.shows("label:Select repository repo")).toBe(true);
  expect(app.shows("label:Select repository child")).toBe(true);
  await app.press("id:view-nested");
  await app.press("label:Collapse repo");
  expect(app.shows("label:Select repository child")).toBe(false);
  await app.press("label:Expand repo");
  await app.press("label:Select repository repo");
  await app.waitFor("id:commit-file:deleted.txt");
  await app.press("id:open-settings");
  await app.press("id:choose-language");
  await app.press("id:language-zh");
  await app.press("id:close-settings");
  await app.waitFor("返回当前更改");
  await chooseContextItem(app, "id:history-commit:" + first, "查看提交");
  await app.waitFor("首次提交 · 与空树比较");
  if (NATIVE) {
    await app.setColorScheme("dark");
    await app.screenshot(DARK_IMAGE);
  }
  expect(app.shows("DiffLens encountered an error")).toBe(false);
}, 90000);
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["macos"])
    args = parser.parse_args()
    output = PROJECT / ".nsh/verification"
    output.mkdir(parents=True, exist_ok=True)
    test_file = output / "history.test.ts"
    with tempfile.TemporaryDirectory(prefix="difflens-history-") as temporary:
        root = Path(temporary).resolve() / "repo"
        init(root)
        (root / "original.txt").write_text("historical original\n")
        (root / "deleted.txt").write_text("deleted historical text\n")
        (root / "current.txt").write_text("baseline\n")
        for number in range(50):
            (root / f"z-file-{number:03}.txt").write_text(f"historical file {number}\n")
        first = commit(root, "Initial fixture")
        git(root, "mv", "original.txt", "renamed.txt")
        (root / "binary.dat").write_bytes(b"binary\x00data")
        second = commit(root, "Rename and binary")
        (root / "deleted.txt").unlink()
        latest = commit(root, "Delete historical file")
        (root / "current.txt").write_text("working change stays here\n")
        child = root / "nested/child"
        init(child)
        (child / "child.txt").write_text("child history\n")
        commit(child, "Child initial fixture")
        before = git(root, "status", "--porcelain=v2", "-z")
        replacements = {
            "ROOT": json.dumps(str(root)), "FIRST": json.dumps(first),
            "SECOND": json.dumps(second), "LATEST": json.dumps(latest),
            "ENTRY": json.dumps(str(PROJECT / "App.tsx")),
            "NATIVE": "true" if args.target else "false",
            "DARK_IMAGE": json.dumps(str(output / "history-dark-zh.png")),
            "IMAGE": json.dumps(str(output / "history-light.png")),
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
            assert git(root, "status", "--porcelain=v2", "-z") == before
            assert not git(root, "diff", "--cached")
            assert (root / "current.txt").read_text() == "working change stays here\n"
            print("History and menu checks passed; fixture worktree and index unchanged.")
        finally:
            test_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

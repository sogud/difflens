#!/usr/bin/env python3
"""Exercise paged history, search and per-workdir state with disposable repositories."""
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


STEPS = r'''
import { expect, open, test } from "nsh/test";
import { LIBRARY_STORAGE_KEY } from "../../library";
import { SESSION_STORAGE_KEY } from "../../repository-session";
const root = ROOT;
const child = CHILD;
const worktree = WORKTREE;
const oldest = OLDEST;
const target = TARGET;
const storage = { [LIBRARY_STORAGE_KEY]: JSON.stringify({ sources: [{ kind: "directory", path: root, selectedPath: root }], activeKey: "directory:" + root, mode: "nested" }) };

function saved(app, path) {
  const value = app.storage()[SESSION_STORAGE_KEY];
  return value ? JSON.parse(value).entries.find((entry) => entry.path === path)?.session : null;
}

async function ready(app) {
  await app.waitUntil(() => app.shows("label:Select repository child") && !app.shows("id:background-scan") && app.enabled("label:Refresh current source"), { timeout: 30000 });
}

async function clearQuery(app) {
  if (NATIVE) {
    // NSH 0.3's synthetic Command+A path can miss selection in the native host.
    await app.type("id:history-query", "");
    await app.keyboard.press("ctrl+e");
    await app.keyboard.press("shift+home");
    await app.keyboard.press("backspace");
  } else await app.clear("id:history-query");
  await app.waitUntil(() => app.value("id:history-query") === "");
}

async function matched(app, field, text) {
  try {
    await app.waitUntil(() => app.value("id:history-query") === text);
    await app.waitFor("Current branch · 1 loaded");
    await app.waitUntil(() => saved(app, root)?.commitId === target);
  } catch (error) {
    throw new Error("History search " + field + ": " + JSON.stringify({ input: app.value("id:history-query"), expected: text, navigation: saved(app, root)?.history }) + " · " + String(error));
  }
}

test("history pagination, literal search and workdir sessions survive switching and restart", async () => {
  let app = await open(ENTRY, { platform: "macos", locale: "en-US", storage, width: 1280, height: 800 });
  await ready(app);
  await app.waitFor("label:Commit message");
  await app.press("label:Show diff for a.txt");
  await app.waitFor("Staged · a.txt");
  await app.waitFor("id:review-diff");
  await app.type("label:Commit message", "root draft stays local");
  await app.press("id:history-tab");
  await app.waitFor("Current branch · 50 loaded", { timeout: 15000 });
  await app.scroll("id:history-list", 4000);
  await app.waitFor("id:history-more");
  await app.press("id:history-more");
  await app.waitFor("Current branch · 65 loaded");
  await app.scroll("id:history-list", 4000);
  await app.waitFor("id:history-commit:" + oldest);
  await app.press("id:history-commit:" + oldest);
  await app.waitFor("id:commit-file:z.txt");
  await app.press("id:commit-file:z.txt");
  await app.waitFor("id:review-diff");
  await app.press("label:Select repository child");
  await app.waitFor("id:commit-file:child.txt");
  await app.press("label:Select repository repo");
  await app.waitFor("id:commit-file:z.txt");
  await app.waitFor("id:history-commit:" + oldest);
  await app.waitFor("id:history-latest");
  expect(saved(app, root).commitId).toBe(oldest);
  expect(saved(app, root).commitFilePath).toBe("z.txt");
  await app.type("id:history-query", "revision 003 [literal].*");
  await matched(app, "message", "revision 003 [literal].*");
  await app.waitFor("id:history-commit:" + target);
  await app.waitFor("id:commit-file:z.txt");
  await app.press("id:commit-file:z.txt");
  await clearQuery(app);
  await app.press("id:history-field:author");
  await app.type("id:history-query", "Another Fixture");
  await matched(app, "author", "Another Fixture");
  await app.waitFor("id:history-commit:" + target);
  await clearQuery(app);
  await app.press("id:history-field:id");
  await app.type("id:history-query", target.slice(0, 8));
  await matched(app, "id", target.slice(0, 8));
  await app.waitFor("id:history-commit:" + target);
  await clearQuery(app);
  await app.press("id:history-field:message");
  await app.type("id:history-query", "no-such-commit-fixture");
  await app.waitFor("id:history-empty");
  await clearQuery(app);
  await app.type("id:history-query", "revision 003 [literal].*");
  await app.waitFor("id:history-commit:" + target);
  await app.waitFor("id:commit-file:z.txt");
  await app.press("id:commit-file:z.txt");
  await app.press("label:Open worktree " + worktree);
  await app.waitUntil(() => app.shows("id:history-pane") && app.enabled("id:history-wip"));
  await app.press("id:history-wip");
  await app.waitUntil(() => app.shows("label:Commit message") && app.enabled("label:Commit message"));
  await app.type("label:Commit message", "worktree has a separate draft");
  await app.press("label:Open directory " + root);
  await ready(app);
  await app.waitFor("id:history-query");
  expect(app.value("id:history-query")).toBe("revision 003 [literal].*");
  await app.waitFor("id:commit-file:z.txt");
  await app.press("id:back-to-wip");
  await app.waitUntil(() => app.value("label:Commit message") === "root draft stays local");
  expect(app.value("label:Commit message")).toBe("root draft stays local");
  await app.press("label:Select repository child");
  await app.waitFor("id:history-pane");
  await app.press("id:history-wip");
  await app.waitUntil(() => app.shows("label:Commit message") && app.enabled("label:Commit message"));
  await app.type("label:Commit message", "child draft");
  await app.waitUntil(() => saved(app, child)?.commitMessage === "child draft" && saved(app, worktree)?.commitMessage === "worktree has a separate draft");
  const persisted = { ...app.storage() };
  app.dispose();
  app = await open(ENTRY, { platform: "macos", locale: "en-US", storage: persisted, width: 1280, height: 800 });
  await ready(app);
  await app.waitUntil(() => app.value("label:Commit message") === "child draft");
  expect(app.value("label:Commit message")).toBe("child draft");
  await app.press("label:Select repository repo");
  await app.waitUntil(() => app.value("label:Commit message") === "root draft stays local");
  await app.waitFor("Staged · a.txt");
  await app.press("id:files-tab");
  await app.waitFor("label:Preview file z.txt");
  await app.press("label:Preview file z.txt");
  await app.waitFor("id:file-preview-editor");
  await app.press("label:Select repository child");
  await app.waitUntil(() => app.value("label:Commit message") === "child draft");
  await app.press("label:Select repository repo");
  await app.waitFor("id:file-preview-editor");
  await app.waitFor("File · z.txt");
  expect(saved(app, root).previewPath).toBe("z.txt");
  await app.press("id:history-tab");
  await app.waitFor("id:history-commit:" + target);
  await app.waitFor("id:commit-file:z.txt");
  expect(app.value("id:history-query")).toBe("revision 003 [literal].*");
  expect(saved(app, root).commitFilePath).toBe("z.txt");
  if (NATIVE) {
    await app.setColorScheme("light");
    await app.screenshot(IMAGE);
    await app.setColorScheme("dark");
    await app.screenshot(DARK_IMAGE);
  }
  expect(app.shows("DiffLens encountered an error")).toBe(false);
  app.dispose();
}, 180000);
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["macos"])
    args = parser.parse_args()
    output = PROJECT / ".nsh/verification"
    output.mkdir(parents=True, exist_ok=True)
    test_file = output / "history-navigation.test.ts"
    with tempfile.TemporaryDirectory(prefix="difflens-navigation-") as temporary:
        root = Path(temporary).resolve() / "repo"
        init(root)
        ids = []
        for number in range(65):
            for name in ["a.txt", "z.txt"]:
                (root / name).write_text(f"{name} revision {number}\n")
            git(root, "add", "--", "a.txt", "z.txt")
            arguments = ["commit", "-m", f"revision {number:03}" + (" [literal].*" if number == 3 else "")]
            if number == 3:
                arguments += ["--author", "Another Fixture <another@example.invalid>"]
            git(root, *arguments)
            ids.append(git(root, "rev-parse", "HEAD").decode().strip())
        worktree = Path(temporary).resolve() / "linked"
        git(root, "worktree", "add", "-b", "linked-fixture", str(worktree))
        for repo in [root, worktree]:
            (repo / "a.txt").write_text("staged draft fixture\n")
            git(repo, "add", "--", "a.txt")
        child = root / "nested/child"
        init(child)
        (child / "child.txt").write_text("child history\n")
        git(child, "add", "--", "child.txt")
        git(child, "commit", "-m", "child base")
        (child / "child.txt").write_text("child staged\n")
        git(child, "add", "--", "child.txt")
        before = {str(repo): git(repo, "status", "--porcelain=v2", "-z") for repo in [root, child, worktree]}
        before_heads = {str(repo): git(repo, "rev-parse", "HEAD") for repo in [root, child, worktree]}
        before_indexes = {str(repo): git(repo, "ls-files", "--stage", "-z") for repo in [root, child, worktree]}
        fixture_files = [(root, "a.txt"), (root, "z.txt"), (child, "child.txt"), (worktree, "a.txt"), (worktree, "z.txt")]
        before_contents = {(str(repo), name): (repo / name).read_bytes() for repo, name in fixture_files}
        replacements = {"ROOT": json.dumps(str(root)), "CHILD": json.dumps(str(child)), "WORKTREE": json.dumps(str(worktree)), "OLDEST": json.dumps(ids[0]), "TARGET": json.dumps(ids[3]), "ENTRY": json.dumps(str(PROJECT / "App.tsx")), "NATIVE": "true" if args.target else "false", "IMAGE": json.dumps(str(output / "history-navigation-light.png")), "DARK_IMAGE": json.dumps(str(output / "history-navigation-dark.png"))}
        code = STEPS
        for token in sorted(replacements, key=len, reverse=True):
            code = code.replace(token, replacements[token])
        test_file.write_text(code)
        command = [nsh_command(), "test", str(test_file)]
        if args.target:
            command += ["--target", args.target]
        try:
            subprocess.run(command, cwd=PROJECT, env=dict(os.environ, RUSTUP_TOOLCHAIN="stable"), check=True)
            for repo in [root, child, worktree]:
                assert git(repo, "status", "--porcelain=v2", "-z") == before[str(repo)]
                assert git(repo, "rev-parse", "HEAD") == before_heads[str(repo)]
                assert git(repo, "ls-files", "--stage", "-z") == before_indexes[str(repo)]
            for repo, name in fixture_files:
                assert (repo / name).read_bytes() == before_contents[(str(repo), name)]
            print("History navigation checks passed; all fixture worktrees and indexes unchanged.")
        finally:
            test_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

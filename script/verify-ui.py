#!/usr/bin/env python3
"""Verify native hints, resizable panes, recycled file rows and saved layout in disposable repos."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from nsh_toolchain import nsh_command

PROJECT = Path(__file__).resolve().parent.parent


def git(root, *arguments):
    return subprocess.check_output(["git", "-C", str(root), *arguments], stderr=subprocess.PIPE)


def init(root):
    root.mkdir(parents=True)
    git(root, "init", "--initial-branch=main")
    git(root, "config", "user.name", "DiffLens Fixture")
    git(root, "config", "user.email", "fixture@example.invalid")
    git(root, "config", "core.hooksPath", "/dev/null")
    git(root, "config", "commit.gpgsign", "false")


STEPS = r'''
import { expect, open, test } from "nsh/test";
import { LIBRARY_STORAGE_KEY } from "../../library";
import { SETTINGS_STORAGE_KEY } from "../../i18n";
const LAYOUT_STORAGE_KEY = "difflens.layout.v1";
const root = ROOT;
const latest = LATEST;
const storage = {
  [SETTINGS_STORAGE_KEY]: JSON.stringify({language:"en"}),
  [LIBRARY_STORAGE_KEY]: JSON.stringify({sources:[{kind:"directory",path:root,selectedPath:root}],activeKey:"directory:"+root,mode:"nested"}),
};
function sizes(app) { const saved=app.storage()[LAYOUT_STORAGE_KEY]; return saved ? JSON.parse(saved).sizes : null; }
async function ready(app) {
  await app.waitUntil(()=>app.shows("label:Select repository child") && !app.shows("id:background-scan") && app.enabled("label:Refresh current source"),{timeout:30000});
  await app.waitFor("id:changed-file-list-unstaged");
}
async function hint(app, selector, text) {
  console.log("Checking hint: " + selector);
  await app.hover(selector);
  await app.wait(400);
  try { await app.waitFor("text:"+text,{timeout:2500}); }
  catch (error) {
    if (NATIVE) await app.screenshot(FAILURE_IMAGE);
    throw error;
  }
  await app.hover("id:window-toolbar");
  await app.waitFor("text:"+text,{state:"gone",timeout:2000});
  if (NATIVE) await app.wait(100);
}
async function resize(app, name, label, by, expected) {
  await app.drag("label:"+label,by);
  await app.waitUntil(()=>{const value=sizes(app)?.[name];return value!==undefined && Math.abs(value-expected)<=2;});
}

test("native pane layout, hints and virtual file actions",async()=>{
  let app=await open(ENTRY,{platform:"macos",locale:"en-US",width:1280,height:800,storage});
  try {
    await ready(app);
    await hint(app,"label:Add existing repository","Add repository (⌘O)");
    await hint(app,"label:Add workspace directory","Add directory (⇧⌘O)");
    await hint(app,"label:Refresh current source","Refresh (⌘R)");
    await hint(app,"id:rescan-source","Rescan repositories (⇧⌘R)");
    await hint(app,"id:open-settings","Settings (⌘,)");
    await hint(app,"id:view-flat","Flat");
    await app.press("id:view-flat");
    await app.waitUntil(() => JSON.parse(app.storage()[LIBRARY_STORAGE_KEY]).mode === "flat");
    await hint(app,"id:view-nested","Nested");
    await app.press("id:view-nested");
    await app.waitUntil(() => JSON.parse(app.storage()[LIBRARY_STORAGE_KEY]).mode === "nested");
    await hint(app,"label:Add to library","Add to library");
    await hint(app,"label:Fetch","Fetch");
    await hint(app,"label:Pull","Pull");
    await hint(app,"label:Push","Push");
    await hint(app,"label:Stage a.txt","Stage a.txt");
    await hint(app,"label:Unstage staged.txt","Unstage staged.txt");
    await app.type("label:Commit message","A local draft\nwith a second line");
    expect(app.value("label:Commit message")).toBe("A local draft\nwith a second line");

    await resize(app,"sidebar","Resize sidebar",{x:170},410);
    await resize(app,"changes","Resize review panes",{x:220},560);
    await resize(app,"library","Resize library section",{y:60},200);
    await resize(app,"worktrees","Resize worktree section",{y:-40},188);
    await resize(app,"staged","Resize staged and unstaged files",{y:-50},178);
    await resize(app,"composer","Resize commit composer",{y:-60},164);
    expect(sizes(app).sidebar).toBeGreaterThan(360);
    expect(sizes(app).changes).toBeGreaterThan(520);
    await app.press("label:Associated worktrees");
    expect(app.shows("text:Main worktree")).toBe(false);
    await app.press("label:Associated worktrees");
    await app.waitFor("text:Main worktree");

    await app.scroll("id:changed-file-list-unstaged",1150);
    await app.waitFor("label:Stage src/item-038.txt");
    await hint(app,"label:Stage src/item-038.txt","Stage src/item-038.txt");
    await app.press("label:Stage src/item-038.txt");
    await app.waitFor("text:Staged · 2");
    await app.waitFor("label:Unstage src/item-038.txt");
    await app.press("label:Unstage src/item-038.txt");
    await app.waitFor("text:Staged · 1");
    expect(app.value("label:Commit message")).toBe("A local draft\nwith a second line");

    await app.press("id:history-tab");
    await app.waitFor("id:history-commit:"+latest);
    await hint(app,"id:refresh-history","Refresh history");
    await app.press("id:history-commit:"+latest);
    await app.waitFor("id:commit-file-list");
    await resize(app,"commitFiles","Resize commit files and diff",{y:60},220);
    await app.press("id:back-to-wip");
    await app.waitFor("id:files-tab");
    await app.press("id:files-tab");
    await hint(app,"id:refresh-files","Refresh files");
    await app.press("id:history-tab");
    await app.press("id:history-wip");
    await app.waitFor("label:Commit message");

    const persisted={...app.storage()};
    app.dispose();
    app=await open(ENTRY,{platform:"macos",locale:"en-US",width:1280,height:800,storage:persisted});
    await ready(app);
    await app.waitUntil(()=>app.value("label:Commit message")==="A local draft\nwith a second line");
    // A relative drag after reopening proves the saved sizes were applied, not just read back from storage.
    await resize(app,"sidebar","Resize sidebar",{x:-20},390);
    await resize(app,"composer","Resize commit composer",{y:10},154);
    await resize(app,"sidebar","Resize sidebar",{x:256-390},256);
    await resize(app,"changes","Resize review panes",{x:360-560},360);
    await resize(app,"library","Resize library section",{y:110-200},110);
    await resize(app,"worktrees","Resize worktree section",{y:188-120},120);
    await resize(app,"staged","Resize staged and unstaged files",{y:178-90},90);
    await resize(app,"composer","Resize commit composer",{y:154-128},128);

    await app.press("id:open-settings");
    await app.press("id:choose-language");
    await app.press("id:language-zh");
    await app.press("id:close-settings");
    await hint(app,"id:open-settings","设置（⌘,）");
    await app.press("id:open-settings");
    await app.press("id:choose-language");
    await app.press("id:language-en");
    await app.press("id:close-settings");
    if (NATIVE) {
      await app.setColorScheme("light");
      await app.hover("id:open-settings");
      await app.waitFor("text:Settings (⌘,)");
      await app.screenshot(LIGHT_IMAGE);
      await app.hover("id:window-toolbar");
      await app.setColorScheme("dark");
      await app.screenshot(DARK_IMAGE);
    }
    expect(app.shows("id:layout-error")).toBe(false);
    expect(app.shows("DiffLens encountered an error")).toBe(false);
  } finally {app.dispose();}
},150000);
'''


def snapshot(root):
    return {
        "head": git(root, "rev-parse", "HEAD"),
        "status": git(root, "status", "--porcelain=v2", "-z"),
        "index": git(root, "ls-files", "--stage", "-z"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["macos"])
    args = parser.parse_args()
    output = PROJECT / ".nsh/verification"
    output.mkdir(parents=True, exist_ok=True)
    test_file = output / "ui-refinement.test.ts"
    with tempfile.TemporaryDirectory(prefix="difflens-ui-") as temporary:
        root = Path(temporary).resolve() / "repo"
        init(root)
        (root / "a.txt").write_text("before\n")
        (root / "staged.txt").write_text("before\n")
        (root / ".gitignore").write_text("nested/\n")
        (root / "src").mkdir()
        for number in range(60):
            (root / f"src/item-{number:03d}.txt").write_text("before\n")
        git(root, "add", ".")
        git(root, "commit", "-m", "Base fixture")
        latest = git(root, "rev-parse", "HEAD").decode().strip()
        worktree = Path(temporary).resolve() / "linked"
        git(root, "worktree", "add", "-b", "linked-fixture", str(worktree))
        for repo in [root, worktree]:
            (repo / "staged.txt").write_text("staged draft\n")
            git(repo, "add", "--", "staged.txt")
        (root / "a.txt").write_text("after\n")
        for number in range(60):
            (root / f"src/item-{number:03d}.txt").write_text("after\n")
        child = root / "nested/child"
        init(child)
        (child / "child.txt").write_text("child\n")
        git(child, "add", ".")
        git(child, "commit", "-m", "Child fixture")
        remote = Path(temporary).resolve() / "remote.git"
        git(root, "init", "--bare", str(remote))
        git(root, "remote", "add", "origin", str(remote))
        repos = [root, child, worktree]
        before = {str(repo): snapshot(repo) for repo in repos}
        files = [file for repo in repos for file in repo.rglob("*.txt") if ".git" not in file.parts]
        hashes = {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
        replacements = {
            "ROOT": json.dumps(str(root)), "LATEST": json.dumps(latest),
            "ENTRY": json.dumps(str(PROJECT / "App.tsx")), "NATIVE": "true" if args.target else "false",
            "FAILURE_IMAGE": json.dumps(str(output / "ui-refinement-failure.png")),
            "LIGHT_IMAGE": json.dumps(str(output / "ui-refinement-light.png")),
            "DARK_IMAGE": json.dumps(str(output / "ui-refinement-dark.png")),
        }
        code = STEPS
        for name in sorted(replacements, key=len, reverse=True):
            code = code.replace(name, replacements[name])
        test_file.write_text(code)
        command = [nsh_command(), "test", str(test_file)]
        if args.target:
            command += ["--target", args.target]
        try:
            subprocess.run(command, cwd=PROJECT, env=dict(os.environ, RUSTUP_TOOLCHAIN="stable", CARGO_NET_OFFLINE="true"), check=True)
            for repo in repos:
                assert snapshot(repo) == before[str(repo)], f"Fixture state changed: {repo.name}"
            for file in files:
                assert hashlib.sha256(file.read_bytes()).hexdigest() == hashes[str(file)]
            print("UI checks passed; fixture HEADs, indexes, worktrees and file bytes unchanged.")
        finally:
            test_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Exercise repository-library flows with disposable Git repositories."""
import argparse
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
from nsh_toolchain import nsh_command

PROJECT = Path(__file__).resolve().parent.parent


def git(repository, *arguments):
    subprocess.run(["git", "-C", str(repository), *arguments], check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def init_repository(repository, filename):
    repository.mkdir(parents=True, exist_ok=True)
    git(repository, "init", "--initial-branch=main")
    git(repository, "config", "user.name", "DiffLens Fixture")
    git(repository, "config", "user.email", "fixture@example.invalid")
    file = repository / filename
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text("baseline\n")
    git(repository, "add", "--", filename)
    git(repository, "commit", "-m", "fixture baseline")
    file.write_text("updated\n")


STEPS = r'''
import { expect, open, test } from "nsh/test";
const entry = ENTRY;
const workspace = WORKSPACE;
const outer = OUTER;
const child = CHILD;
const empty = EMPTY;
const key = "difflens.library.v1";

async function waitForOpened(app) {
  await app.waitUntil(() => !app.shows("id:add-source-dialog") && app.enabled("label:Refresh current source"), { timeout: 15000 });
}

async function enterPath(app, path, directory, valid = true) {
  if (app.shows("Enter a path instead…")) {
    await app.press("Enter a path instead…");
  } else {
    await app.press("label:Add to library");
    await app.waitFor("Enter a path…");
    await app.press("Enter a path…");
  }
  await app.type("id:source-path", path);
  if (directory) await app.press("Workspace directory");
  await app.press("id:confirm-add-source");
  if (directory && path === workspace) {
    await app.waitFor("id:background-scan");
    expect(app.shows("id:loading-spinner")).toBe(true);
    if (NATIVE) await app.screenshot(LOADING_IMAGE);
  }
  if (valid) await waitForOpened(app);
}

test("library import, navigation, refresh and restore", async () => {
  const app = await open(entry, { platform: "macos", locale: "en-US", width: 1180, height: 760 });
  await app.waitFor("id:welcome");
  if (NATIVE) await app.screenshot(WELCOME_IMAGE);
  await enterPath(app, empty, false, false);
  await app.waitFor("id:import-error");
  expect(app.shows("id:add-source-dialog")).toBe(true);
  await app.press("Workspace directory");
  await app.press("id:confirm-add-source");
  await waitForOpened(app);
  await app.waitFor("No Git repositories found");
  await app.waitUntil(() => JSON.parse(app.storage()[key] || "{}").sources?.length === 1);

  await enterPath(app, workspace, true);
  await app.waitUntil(() => app.shows("label:Select repository outer") || app.shows("label:Select repository child"), { timeout: 15000 });
  const firstName = app.shows("label:Select repository child") ? "child" : "outer";
  await app.press("label:Select repository " + firstName);
  await app.waitFor(firstName === "child" ? "Working tree · src/lib.rs" : "Working tree · src/main.rs");
  expect(app.shows("id:background-scan")).toBe(true);
  expect(app.enabled("label:Add to library")).toBe(true);
  await app.press("id:stop-scan");
  await app.waitFor("Scan stopped. The list may be incomplete.");
  expect(app.shows("id:background-scan")).toBe(false);
  const firstFile = firstName === "child" ? "src/lib.rs" : "src/main.rs";
  await app.press("label:Stage " + firstFile);
  await app.waitFor("label:Unstage " + firstFile);
  await app.press("label:Unstage " + firstFile);
  await app.waitFor("label:Stage " + firstFile);
  await app.waitUntil(() => app.enabled("label:Stage " + firstFile));
  await app.press("id:rescan-source");
  await app.waitUntil(() => !app.shows("id:background-scan") && app.enabled("label:Refresh current source"), { timeout: 15000 });
  await app.waitFor("label:Select repository child");
  await app.press("label:Collapse outer");
  expect(app.shows("label:Select repository child")).toBe(false);
  await app.press("label:Expand outer");
  await app.press("label:Select repository child");
  await app.waitFor("Working tree · src/lib.rs");
  await app.press("label:Stage src/lib.rs");
  await app.waitUntil(() => app.enabled("label:Commit message"));
  await app.type("label:Commit message", "keep this draft on refresh");
  await app.press("label:Refresh current source");
  await waitForOpened(app);
  await app.waitFor("Staged · src/lib.rs");
  expect(app.value("label:Commit message")).toBe("keep this draft on refresh");
  await app.press("id:view-flat");
  await app.type("id:repository-filter", "child");
  expect(app.shows("label:Select repository outer")).toBe(false);
  expect(app.shows("label:Select repository child")).toBe(true);
  await app.clear("id:repository-filter");

  await enterPath(app, outer + "/src", false);
  await app.waitFor("label:Select repository outer");
  expect(app.shows("label:Select repository child")).toBe(false);
  await app.waitUntil(() => JSON.parse(app.storage()[key] || "{}").sources?.length === 3);
  await enterPath(app, outer, false);
  await app.waitFor("label:Select repository outer");
  expect(JSON.parse(app.storage()[key]).sources.length).toBe(3);

  await app.press("label:Open directory " + workspace);
  await waitForOpened(app);
  await app.waitFor("Staged · src/lib.rs");
  await app.press("label:Manage " + outer);
  await app.waitFor("Remove from library");
  await app.press("Remove from library");
  await app.waitUntil(() => JSON.parse(app.storage()[key]).sources.length === 2);
  expect(JSON.parse(app.storage()[key]).activeKey).toBe("directory:" + workspace);
  const saved = app.storage();
  const reopened = await open(entry, { platform: "macos", locale: "en-US", storage: saved, width: 1180, height: 760 });
  await reopened.waitFor("Staged · src/lib.rs");
  await reopened.waitUntil(() => reopened.enabled("label:Unstage src/lib.rs"));
  expect(JSON.parse(reopened.storage()[key]).mode).toBe("flat");
  expect(JSON.parse(reopened.storage()[key]).sources.find(x => x.path === workspace).selectedPath).toBe(child);
  if (NATIVE) {
    await reopened.keyboard.press("mod+l");
    await reopened.waitFor("id:add-source-dialog");
    await reopened.screenshot(IMPORT_IMAGE);
    await reopened.press("Cancel");
    await reopened.screenshot(LIGHT_IMAGE);
    await reopened.setColorScheme("dark");
    await reopened.screenshot(DARK_IMAGE);
  }
}, 120000);

test("missing saved folders remain recoverable", async () => {
  const missing = workspace + "/missing";
  const saved = JSON.stringify({ sources: [{ kind: "directory", path: missing, selectedPath: null }], activeKey: "directory:" + missing, mode: "nested" });
  const app = await open(entry, { platform: "macos", locale: "en-US", storage: { [key]: saved }, width: 1180, height: 760 });
  await app.waitFor("id:library-error");
  expect(app.enabled("label:Add existing repository")).toBe(true);
  await enterPath(app, outer, false);
  await app.waitFor("label:Select repository outer");
  expect(app.shows("id:library-error")).toBe(false);
}, 60000);

test("language switches live and survives restart", async () => {
  const settingsKey = "difflens.settings.v1";
  const library = JSON.stringify({ sources: [{ kind: "repository", path: outer, selectedPath: outer }], activeKey: "repository:" + outer, mode: "nested" });
  const app = await open(entry, { platform: "macos", locale: "en-US", width: 1180, height: 760, storage: { [key]: library } });
  await app.waitFor("Working tree · src/main.rs");
  await app.waitUntil(() => app.enabled("label:Stage src/main.rs"));
  await app.press("label:Stage src/main.rs");
  await app.waitUntil(() => app.enabled("label:Commit message"));
  await app.type("label:Commit message", "keep my draft");
  await app.press("label:Show diff for src/main.rs");
  await app.waitFor("Staged · src/main.rs");
  if (NATIVE) await app.keyboard.press("mod+,");
  else await app.press("id:open-settings");
  await app.waitFor("id:settings-dialog");
  if (NATIVE) {
    await app.waitFor("id:diagnostics-info");
    expect(app.enabled("id:open-logs")).toBe(true);
    expect(app.enabled("id:open-crash-reports")).toBe(true);
  }
  await app.press("id:choose-language");
  await app.press("id:language-zh");
  await app.waitUntil(() => JSON.parse(app.storage()[settingsKey] || "{}").language === "zh");
  await app.waitFor("修改后立即生效。");
  if (NATIVE) await app.screenshot(SETTINGS_IMAGE);
  await app.press("id:close-settings");
  await app.waitFor("已暂存 · src/main.rs");
  expect(app.texts()).toContain("文件已暂存。");
  expect(app.value("label:提交说明")).toBe("keep my draft");
  expect(app.shows("label:添加已有仓库")).toBe(true);
  expect(app.shows("label:取消暂存 src/main.rs")).toBe(true);
  await app.press("id:open-settings");
  await app.press("id:choose-language");
  await app.press("id:language-en");
  await app.waitUntil(() => JSON.parse(app.storage()[settingsKey]).language === "en");
  await app.waitFor("Changes apply immediately.");
  await app.press("id:close-settings");
  await app.waitFor("Staged · src/main.rs");
  expect(app.value("label:Commit message")).toBe("keep my draft");
  await app.press("id:open-settings");
  await app.press("id:choose-language");
  await app.press("id:language-zh");
  await app.waitUntil(() => JSON.parse(app.storage()[settingsKey]).language === "zh");
  await app.press("id:close-settings");
  const restored = await open(entry, { platform: "macos", locale: "en-US", width: 1180, height: 760, storage: app.storage() });
  await restored.waitFor("label:选择仓库 outer");
  await restored.waitUntil(() => restored.enabled("label:刷新当前入口"));
  expect(restored.shows("label:设置")).toBe(true);
  if (NATIVE) await restored.screenshot(CHINESE_IMAGE);
}, 120000);

'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["macos"], help="Run in a real macOS window and save screenshots")
    parser.add_argument("--import-only", action="store_true", help="Run only import/navigation/scan cancellation checks")
    options = parser.parse_args()
    verification = PROJECT / ".nsh" / "verification"
    verification.mkdir(parents=True, exist_ok=True)
    test_file = verification / "library.test.ts"
    with tempfile.TemporaryDirectory(prefix="difflens-library-") as temporary:
        workspace = Path(temporary).resolve() / "workspace"
        outer = workspace / "outer"
        child = outer / "packages" / "child"
        empty = Path(temporary).resolve() / "empty"
        empty.mkdir()
        init_repository(outer, "src/main.rs")
        init_repository(child, "src/lib.rs")
        # Delay one real status read in these fixtures, keeping loading feedback observable.
        shim_directory = Path(temporary) / "bin"
        shim_directory.mkdir()
        shim = shim_directory / "git"
        real_git = shutil.which("git")
        if real_git is None:
            raise SystemExit("Git is required for verification.")
        shim.write_text("#!/usr/bin/env python3\n" +
            "import os, pathlib, sys, time\n" +
            "marker = pathlib.Path(" + repr(str(Path(temporary) / 'status-delayed')) + ")\n" +
            "fixture = " + repr(str(workspace)) + "\n" +
            "args = sys.argv[1:]\n" +
            "folder = args[args.index('-C') + 1] if '-C' in args else ''\n" +
            "if folder.startswith(fixture) and 'status' in args and not marker.exists():\n" +
            "    indexes = [pathlib.Path(p) for p in " + repr([str(outer / '.git/index'), str(child / '.git/index')]) + "]\n" +
            "    before = [p.stat().st_mtime_ns for p in indexes]\n" +
            "    marker.touch()\n    deadline = time.monotonic() + 60\n" +
            "    while time.monotonic() < deadline and [p.stat().st_mtime_ns for p in indexes] == before:\n        time.sleep(0.05)\n" +
            "os.execv(" + repr(real_git) + ", [" + repr(real_git) + ", *args])\n")
        shim.chmod(0o755)
        replacements = {
            "ENTRY": json.dumps(str(PROJECT / "App.tsx")),
            "WORKSPACE": json.dumps(str(workspace)),
            "OUTER": json.dumps(str(outer)), "CHILD": json.dumps(str(child)),
            "EMPTY": json.dumps(str(empty)), "NATIVE": "true" if options.target else "false",
            "LIGHT_IMAGE": json.dumps(str(verification / "library-light.png")),
            "DARK_IMAGE": json.dumps(str(verification / "library-dark.png")),
            "WELCOME_IMAGE": json.dumps(str(verification / "welcome.png")),
            "IMPORT_IMAGE": json.dumps(str(verification / "add-source.png")),
            "LOADING_IMAGE": json.dumps(str(verification / "import-loading.png")),
            "SETTINGS_IMAGE": json.dumps(str(verification / "settings-zh.png")),
            "CHINESE_IMAGE": json.dumps(str(verification / "library-zh.png")),
        }
        code = STEPS
        if options.import_only:
            code = code.replace('test("library import, navigation, refresh and restore"', 'test.only("library import, navigation, refresh and restore"', 1)
        for token, value in replacements.items():
            code = code.replace(token, value)
        test_file.write_text(code)
        command = [nsh_command(), "test", str(test_file)]
        if options.target:
            command.extend(["--target", options.target])
        env = dict(os.environ, RUSTUP_TOOLCHAIN="stable")
        env["PATH"] = str(shim_directory) + os.pathsep + env.get("PATH", "")
        try:
            result = subprocess.run(command, cwd=PROJECT, env=env)
            if result.returncode:
                raise SystemExit(result.returncode)
            if not (Path(temporary) / "status-delayed").exists():
                raise SystemExit("The slow-import fixture did not intercept a status read.")
            git(outer, "rev-parse", "--show-toplevel")
            git(child, "rev-parse", "--show-toplevel")
            print("Library checks passed; removing fixture repositories.")
        finally:
            test_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Catch reloads on warm tab switches using a disposable repository and a Git-call trace."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from nsh_toolchain import nsh_command

PROJECT = Path(__file__).resolve().parent.parent
STEPS = r'''
import { expect, open, test } from "nsh/test";
import { LIBRARY_STORAGE_KEY } from "../../library";
const root=ROOT;
const storage={
 [LIBRARY_STORAGE_KEY]:JSON.stringify({sources:[{kind:"repository",path:root,selectedPath:root}],activeKey:"repository:"+root,mode:"nested"}),
 "difflens.settings.v1":JSON.stringify({language:"en"}),
};
test("warm tabs preserve their views without loading again",async()=>{
 const app=await open(ENTRY,{platform:"macos",locale:"en-US",width:1280,height:800,storage});
 try {
  await app.waitFor("id:review-diff",{timeout:15000});
  await app.press("id:files-tab");
  await app.waitFor("label:Preview file b.txt");
  await app.press("label:Preview file b.txt");
  await app.waitFor("id:file-preview-editor");
  await app.press("label:Toggle folder docs");
  await app.waitFor("label:Preview file docs/keep.txt");
  await app.press("id:history-tab");
  await app.waitFor("id:commit-review");
  await app.waitFor("id:commit-file:a.txt");
  await app.type("id:history-query","revision");
  await app.waitFor("id:history-loading",{state:"gone"});
  await app.waitFor("id:commit-file:b.txt");
  await app.press("id:commit-file:b.txt");
  await app.waitFor("id:review-diff");
  console.log("DL_TAB_WARMED");
  const results=[];
  for(let i=0;i<2;i++) for(const tab of ["changes","files","history"]) {
   const start=Date.now();
   await app.press(tab==="changes"?"text:Changes":"id:"+tab+"-tab");
   const reloading=app.shows("text:Reading repository")||app.shows("id:history-loading")||app.shows("text:Reading files…")||app.shows("text:Loading file…")||app.shows("text:Loading commit…");
   if(tab==="changes") {await app.waitFor("id:changed-file-list-unstaged");await app.waitFor("id:review-diff");}
   else if(tab==="files") {
    await app.waitFor("id:file-preview-editor");
    expect(app.shows("label:Preview file docs/keep.txt")).toBe(true);
   } else {
    await app.waitFor("id:commit-review");await app.waitFor("id:review-diff");
    expect(app.value("id:history-query")).toBe("revision");
   }
   results.push({tab,ms:Date.now()-start,reloading});
  }
  console.log("DL_TAB_RESULTS "+JSON.stringify(results));
  console.log("DL_TAB_RETURNED");
  expect(results.some(result=>result.reloading)).toBe(false);
  await app.press("text:Changes");
  await app.press("label:Stage a.txt");
  await app.waitFor("text:Staged · 1");
  expect(app.shows("id:changed-file-list-staged")).toBe(true);
  await app.press("label:Unstage a.txt");
  await app.waitFor("text:Staged · 0");
  await app.press("id:files-tab");
  await app.waitFor("id:file-preview-editor");
  await app.press("label:Refresh current source");
  await app.waitFor("id:file-preview-editor");
  await app.waitUntil(()=>app.enabled("label:Refresh current source"));
 } finally {app.dispose();}
},60000);
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["macos"])
    args = parser.parse_args()
    output = PROJECT / ".nsh/verification"
    output.mkdir(parents=True, exist_ok=True)
    test = output / "tab-navigation.test.ts"
    real_git = shutil.which("git")
    if not real_git:
        raise SystemExit("Git is required.")
    with tempfile.TemporaryDirectory(prefix="difflens-tabs-") as temporary:
        directory = Path(temporary).resolve()
        root = directory / "repo"
        root.mkdir()
        def git(*arguments):
            return subprocess.check_output([real_git, "-C", str(root), *arguments], stderr=subprocess.PIPE)
        git("init", "-b", "main")
        git("config", "user.name", "DiffLens Fixture")
        git("config", "user.email", "fixture@example.invalid")
        git("config", "core.hooksPath", "/dev/null")
        git("config", "commit.gpgsign", "false")
        (root / "docs").mkdir()
        (root / "docs/keep.txt").write_text("preview folder fixture\n")
        for number in range(3):
            for name in ["a.txt", "b.txt"]:
                (root / name).write_text(f"{name} revision {number}\n")
            git("add", ".")
            git("commit", "-m", f"revision {number}")
        (root / "a.txt").write_text("working change\n")
        before = (git("status", "--porcelain=v2", "-z"), git("ls-files", "--stage", "-z"), git("rev-parse", "HEAD"))
        hashes = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ["a.txt", "b.txt"]}
        trace = directory / "git-calls.jsonl"
        bin_path = directory / "bin"
        bin_path.mkdir()
        shim = bin_path / "git"
        shim.write_text("#!/usr/bin/env python3\n" +
            "import os,sys,json,time\n" +
            "args=sys.argv[1:]\n" +
            "folder=args[args.index('-C')+1] if '-C' in args else ''\n" +
            "if folder==" + repr(str(root)) + ":\n" +
            " fd=os.open(" + repr(str(trace)) + ",os.O_APPEND|os.O_CREAT|os.O_WRONLY,0o600)\n" +
            " os.write(fd,(json.dumps(args)+'\\n').encode());os.close(fd)\n" +
            " if any(command in args for command in ['status','log','diff']):time.sleep(.08)\n" +
            "os.execv(" + repr(real_git) + ",[" + repr(real_git) + ",*args])\n")
        shim.chmod(0o755)
        code = STEPS.replace("ROOT", json.dumps(str(root))).replace("ENTRY", json.dumps(str(PROJECT / "App.tsx")))
        test.write_text(code)
        command = [nsh_command(), "test", str(test)]
        if args.target:
            command += ["--target", args.target]
        env = dict(os.environ, RUSTUP_TOOLCHAIN="stable", CARGO_NET_OFFLINE="true")
        env["PATH"] = str(bin_path) + os.pathsep + env.get("PATH", "")
        counts = {}
        def calls():
            return trace.read_text().splitlines() if trace.exists() else []
        try:
            run = subprocess.Popen(command, cwd=PROJECT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in run.stdout:
                print(line, end="", flush=True)
                if "DL_TAB_WARMED" in line:
                    counts["warm"] = len(calls())
                if "DL_TAB_RETURNED" in line:
                    counts["returned"] = len(calls())
            status = run.wait()
            all_calls = calls()
            extra = all_calls[counts.get("warm", 0):counts.get("returned", len(all_calls))]
            (output / "tab-navigation-metrics.json").write_text(json.dumps({"counts":counts,"warmSwitchGitCalls":len(extra),"commands":[json.loads(line) for line in extra]}, indent=2))
            print("Git calls during six warm tab switches:",len(extra))
            assert before == (git("status", "--porcelain=v2", "-z"), git("ls-files", "--stage", "-z"), git("rev-parse", "HEAD"))
            for name, digest in hashes.items():
                assert hashlib.sha256((root/name).read_bytes()).hexdigest() == digest
            if status:
                raise SystemExit(status)
            assert "warm" in counts and "returned" in counts, "Missing measurement markers"
            assert not extra, f"Warm tabs repeated {len(extra)} Git commands"
        finally:
            test.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

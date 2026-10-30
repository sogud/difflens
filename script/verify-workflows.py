#!/usr/bin/env python3
"""Drive common Git menus and confirmed/resumable operations in disposable repositories."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
from nsh_toolchain import nsh_command

PROJECT = Path(__file__).resolve().parent.parent

def git(root, *args, check=True):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=check)
    return result.stdout

def init(root):
    root.mkdir(parents=True)
    git(root,"init","-b","main")
    for key,value in [("user.name","Fixture"),("user.email","fixture@example.invalid"),("core.hooksPath","/dev/null"),("commit.gpgsign","false")]:git(root,"config",key,value)
    commit(root,"a.txt","base\n","base")

def commit(root,name,text,message):
    (root/name).write_text(text);git(root,"add","--",name);git(root,"commit","-m",message)
    return git(root,"rev-parse","HEAD").decode().strip()

STEPS=r'''
import {expect,open,test} from "nsh/test";
import {LIBRARY_STORAGE_KEY} from "../../library";
import {SESSION_STORAGE_KEY} from "../../repository-session";
function storage(root){return {[LIBRARY_STORAGE_KEY]:JSON.stringify({sources:[{kind:"repository",path:root,selectedPath:root}],activeKey:"repository:"+root,mode:"nested"}),"difflens.settings.v1":JSON.stringify({language:"en"})};}
async function start(root){const app=await open(ENTRY,{platform:"macos",locale:"en-US",width:1280,height:800,storage:storage(root)});await app.waitUntil(()=>app.shows("id:open-git-tools")&&app.enabled("id:open-git-tools"));return app;}
async function menu(app,selector,label){await app.rightClick(selector);await app.waitUntil(()=>app.menu()!==null);await app.chooseMenuItem(label);await app.waitFor("id:workflow-dialog");}
async function run(app,name){
 await app.waitFor("id:workflow-dialog");
 if(name)await app.type("id:workflow-name",name);
 await app.press("id:workflow-review");
 await app.waitFor("id:workflow-plan");
 await app.press("id:workflow-run");
 await app.waitFor("id:workflow-dialog",{state:"gone",timeout:15000});
 await app.waitUntil(()=>app.shows("id:open-git-tools")&&app.enabled("id:open-git-tools"));
}
async function tools(app){await app.press("id:open-git-tools");await app.waitFor("id:tools-ref:refs/heads/main");}

test("branch context menus cherry-pick, history revert and branch creation",async()=>{
 const root=CLEAN_ROOT;const app=await start(root);
 try{
  await tools(app);
  await menu(app,"id:tools-ref:refs/heads/feature","Cherry-pick commit…");
  expect(app.shows("text:Run operation")).toBe(false);
  await run(app);
  await app.press("id:history-tab");
  await app.waitFor("id:commit-review");
  await app.waitUntil(()=>{const data=app.storage()[SESSION_STORAGE_KEY];return !!data&&!!JSON.parse(data).entries.find(e=>e.path===root)?.session.commitId;});
  const id=JSON.parse(app.storage()[SESSION_STORAGE_KEY]).entries.find(e=>e.path===root).session.commitId;
  await menu(app,"id:history-commit:"+id,"Revert commit…");
  await app.waitFor("text:Revert creates a new commit and preserves history.");
  await run(app);
  await tools(app);
  await app.press("id:tools-new-branch");
  await run(app,"created-in-ui");
  expect(app.shows("DiffLens encountered an error")).toBe(false);
 }finally{app.dispose();}
},90000);

test("branch menu rebases the current branch onto the selected branch",async()=>{
 const app=await start(REBASE_ROOT);
 try{
  await tools(app);await menu(app,"id:tools-ref:refs/heads/main","Rebase current branch onto…");
  await app.waitFor("text:This operation rewrites commits on the current branch.");
  await run(app);
 }finally{app.dispose();}
},90000);

test("stash push, apply and drop through object menus",async()=>{
 const app=await start(STASH_ROOT);
 try{
  await tools(app);await app.press("id:tools-stash-push");await run(app);
  await tools(app);await app.press("id:tools-stash");await app.waitFor("id:tools-stash:stash@{0}");
  await menu(app,"id:tools-stash:stash@{0}","Apply stash…");await run(app);
  await app.waitFor("label:Stage a.txt");
  await tools(app);await app.press("id:tools-stash");await app.waitFor("id:tools-stash:stash@{0}");
  await menu(app,"id:tools-stash:stash@{0}","Drop stash…");await run(app);
 }finally{app.dispose();}
},90000);

test("in-progress merge is visible and can abort through the confirmation plan",async()=>{
 const app=await start(CONFLICT_ROOT);
 try{
  await app.waitFor("id:git-operation-banner");
  expect(app.enabled("id:git-continue")).toBe(false);
  await app.press("id:git-abort");await run(app);
  await app.waitFor("id:git-operation-banner",{state:"gone"});
 }finally{app.dispose();}
},60000);
test("create and clone repository from the library menu",async()=>{
 const app=await open(ENTRY,{platform:"macos",locale:"en-US",width:1280,height:800,storage:{"difflens.settings.v1":JSON.stringify({language:"en"})}});
 try{
  await app.waitFor("id:welcome");
  await app.press("label:Add to library");await app.press("text:Create repository…");
  await app.waitFor("id:repository-setup");await app.type("id:setup-parent",SETUP_PARENT);await app.type("id:setup-name","initialized");
  await app.press("id:setup-create");await app.waitFor("id:repository-setup",{state:"gone",timeout:15000});await app.waitFor("label:Select repository initialized");
  await app.press("label:Add to library");await app.press("text:Clone repository…");
  await app.waitFor("id:repository-setup");await app.type("id:setup-parent",SETUP_PARENT);await app.type("id:setup-name","cloned");await app.type("id:setup-url",CLONE_URL);
  await app.press("id:setup-create");await app.waitFor("id:repository-setup",{state:"gone",timeout:15000});await app.waitFor("label:Select repository cloned");
 }finally{app.dispose();}
},90000);
'''

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--target",choices=["macos"]);args=parser.parse_args()
    output=PROJECT/".nsh/verification";output.mkdir(parents=True,exist_ok=True);test=output/"workflows.test.ts"
    with tempfile.TemporaryDirectory(prefix="difflens-workflows-") as temporary:
        base=Path(temporary).resolve();clean=base/"clean";stash=base/"stash";conflict=base/"conflict";rebase=base/"rebase"
        for root in [clean,stash,conflict,rebase]:init(root)
        git(rebase,"switch","-c","feature");old_rebase=commit(rebase,"feature.txt","feature\n","feature");git(rebase,"switch","main");onto=commit(rebase,"main.txt","main\n","main");git(rebase,"switch","feature")
        git(clean,"switch","-c","feature");feature=commit(clean,"picked.txt","picked\n","feature");git(clean,"switch","main")
        (stash/"a.txt").write_text("stashed changes\n")
        git(conflict,"switch","-c","feature");commit(conflict,"a.txt","feature\n","feature");git(conflict,"switch","main")
        remote=base/"clone-source.git";git(clean,"clone","--bare",str(clean),str(remote))
        before=commit(conflict,"a.txt","main\n","main");git(conflict,"merge","feature",check=False)
        code=STEPS
        for key,value in {"ENTRY":str(PROJECT/"App.tsx"),"CLEAN_ROOT":str(clean),"STASH_ROOT":str(stash),"CONFLICT_ROOT":str(conflict),"REBASE_ROOT":str(rebase),"SETUP_PARENT":str(base),"CLONE_URL":str(remote)}.items():code=code.replace(key,json.dumps(value))
        test.write_text(code);command=[nsh_command(),"test",str(test)]
        if args.target:command += ["--target",args.target]
        try:
            subprocess.run(command,cwd=PROJECT,env=dict(os.environ,RUSTUP_TOOLCHAIN="stable",CARGO_NET_OFFLINE="true"),check=True)
            assert git(clean,"branch","--show-current").decode().strip()=="created-in-ui"
            assert not (clean/"picked.txt").exists()
            assert git(clean,"rev-parse","feature").decode().strip()==feature
            assert git(clean,"rev-list","--count","HEAD").decode().strip()=="3"
            assert not git(clean,"status","--porcelain")
            assert (stash/"a.txt").read_text()=="stashed changes\n" and not git(stash,"stash","list")
            assert git(conflict,"rev-parse","HEAD").decode().strip()==before
            assert (conflict/"a.txt").read_text()=="main\n" and not git(conflict,"status","--porcelain")
            assert git(rebase,"rev-parse","HEAD").decode().strip()!=old_rebase
            git(rebase,"merge-base","--is-ancestor",onto,"HEAD")
            assert (rebase/"feature.txt").read_text()=="feature\n" and (rebase/"main.txt").read_text()=="main\n"
            assert (base/"initialized/.git").is_dir() and (base/"cloned/.git").is_dir()
            assert git(base/"initialized","branch","--show-current").decode().strip()=="main"
            assert (base/"cloned/a.txt").read_text()=="base\n"
            print("Workflow UI results verified against fixture refs, history, files and operation state.")
        finally:test.unlink(missing_ok=True)

if __name__=="__main__":main()

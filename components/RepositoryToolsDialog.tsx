import { cleanup, computed, List, signal, Text, View } from "nsh";
import { Button, Dialog, Tab, Tabs } from "nsh/base";
import { Menu } from "nsh/desktop";
import { Workspace, type GitContext, type GitReference, type GitStash } from "difflens/native";
import { t } from "../i18n";
import { copyText } from "../context-menu";
import { errorMessage } from "../diagnostics";
import { workflowRequest, type RequestWorkflow } from "../git-workflows";
import { LoadingStatus } from "./LoadingStatus";

export function RepositoryToolsDialog(props: {
  repositoryPath: string;
  onClose: () => void;
  onRequest: RequestWorkflow;
  onSwitch: (branch: string) => void;
}) {
  const context = signal<GitContext | null>(null);
  const error = signal<string | null>(null);
  const loading = signal(true);
  const tab = signal<"local" | "remote" | "tag" | "stash">("local");
  let generation = 0;
  cleanup(() => { generation += 1; });
  async function load() {
    const request = ++generation;
    loading.set(true); error.set(null);
    try { const result = await Workspace.gitContext(props.repositoryPath); if (request === generation) context.set(result); }
    catch (cause) { if (request === generation) error.set(errorMessage(cause)); }
    finally { if (request === generation) loading.set(false); }
  }
  void load();
  const references = computed(() => context()?.references.filter((reference) => reference.kind === tab()) ?? []);
  const choices = [{value:"local",label:"Branches"},{value:"remote",label:"Remotes"},{value:"tag",label:"Tags"},{value:"stash",label:"Stashes"}] as const;
  function referenceMenu(reference: GitReference): Parameters<typeof Menu.popup>[0] {
    return [
      ...(reference.kind === "local" ? [{ label:t("Switch branch"),disabled:reference.current,onSelect:()=>props.onSwitch(reference.shortName) }] : []),
      {label:t("Cherry-pick commit…"),onSelect:()=>props.onRequest(workflowRequest("cherryPick",reference.name))},
      {label:t("Revert commit…"),onSelect:()=>props.onRequest(workflowRequest("revert",reference.name))},
      {label:t("Check out commit…"),onSelect:()=>props.onRequest(workflowRequest("checkoutCommit",reference.name))},
      {label:t("Create branch…"),onSelect:()=>props.onRequest(workflowRequest("createBranch",reference.name))},
      {label:t("Merge into current branch…"),disabled:reference.current,onSelect:()=>props.onRequest(workflowRequest("merge",reference.name))},
      {label:t("Rebase current branch onto…"),disabled:reference.current,onSelect:()=>props.onRequest(workflowRequest("rebase",reference.name))},
      ...(reference.kind === "local" ? [
        {label:t("Rename branch…"),onSelect:()=>props.onRequest({...workflowRequest("renameBranch",reference.name),name:reference.shortName})},
        {label:t("Delete branch…"),disabled:reference.current,onSelect:()=>props.onRequest(workflowRequest("deleteBranch",reference.name))},
      ] : []),
      ...(reference.kind === "tag" ? [{label:t("Delete tag…"),onSelect:()=>props.onRequest(workflowRequest("tagDelete",reference.name))}] : []),
      {type:"separator"},
      {label:t("Copy commit ID"),onSelect:()=>copyText(reference.id)},
    ];
  }
  function stashMenu(stash: GitStash): Parameters<typeof Menu.popup>[0] {
    return [
      {label:t("Apply stash…"),onSelect:()=>props.onRequest(workflowRequest("stashApply",stash.reference))},
      {label:t("Pop stash…"),onSelect:()=>props.onRequest(workflowRequest("stashPop",stash.reference))},
      {label:t("Drop stash…"),onSelect:()=>props.onRequest(workflowRequest("stashDrop",stash.reference))},
      {type:"separator"},{label:t("Copy commit ID"),onSelect:()=>copyText(stash.id)},
    ];
  }
  return <Dialog testID="repository-tools" closeOnBackdropPress={false} onOpenChange={(open)=>{if(!open)props.onClose();}}
    backdropClass="bg-black/30" class="flex-1 items-center justify-center p-4">
    <View class="h-[480px] w-[640px] max-w-full gap-2 rounded-lg border border-border bg-background p-4 shadow-sm">
      <View class="flex-row items-center justify-between gap-2"><Text class="text-[15px] font-semibold text-foreground">{t("Git actions")}</Text>
        <Button testID="tools-refresh" onPress={()=>{void load();}} disabled={loading()} class="h-7 justify-center rounded px-2 hover:bg-muted"><Text class="text-[11px] text-muted-foreground">{t("Refresh")}</Text></Button></View>
      <Text numberOfLines={1} class="font-mono text-[11px] text-muted-foreground">{props.repositoryPath}</Text>
      <Tabs class="flex-row gap-1 rounded bg-muted p-1">{choices.map(choice=><Tab testID={"tools-"+choice.value} selected={tab()===choice.value} onPress={()=>tab.set(choice.value)}
        class="group h-7 min-w-0 flex-1 items-center justify-center rounded selected:bg-background"><Text class="text-[12px] text-muted-foreground group-selected:text-foreground">{t(choice.label)}</Text></Tab>)}</Tabs>
      {loading()?<LoadingStatus label={t("Reading repository")}/>:null}
      {error()?<Text class="text-[12px] text-destructive">{error()}</Text>:null}
      {tab()==="stash"?<List testID="tools-list" each={context()?.stashes??[]} keyExtractor={stash=>stash.id+stash.reference} class="min-h-0 flex-1" estimatedItemSize={44}
        empty={<Text class="p-2 text-[12px] text-muted-foreground">{t("Nothing here yet.")}</Text>}>
        {item=>{const stash=computed(item);return <View onContextMenu={event=>{void Menu.popup(stashMenu(stash()),event.pagePosition);}}>
          <Button testID={"tools-stash:"+stash().reference} onPress={()=>{void Menu.popup(stashMenu(stash()));}} class="h-11 justify-center gap-1 rounded px-2 hover:bg-muted">
            <Text class="font-mono text-[11px] text-foreground">{stash().reference+" · "+stash().id.slice(0,8)}</Text>
            <Text numberOfLines={1} class="text-[12px] text-muted-foreground">{stash().message}</Text>
          </Button></View>;}}</List>
      :<List testID="tools-list" each={references()} keyExtractor={reference=>reference.name} class="min-h-0 flex-1" estimatedItemSize={36}
        empty={<Text class="p-2 text-[12px] text-muted-foreground">{t("Nothing here yet.")}</Text>}>
        {item=>{const reference=computed(item);return <View onContextMenu={event=>{void Menu.popup(referenceMenu(reference()),event.pagePosition);}}>
          <Button testID={"tools-ref:"+reference().name} onPress={()=>{void Menu.popup(referenceMenu(reference()));}} class="h-9 flex-row items-center gap-2 rounded px-2 hover:bg-muted">
            <Text numberOfLines={1} class="min-w-0 flex-1 text-[12px] text-foreground">{(reference().current?"✓  ":"")+reference().shortName}</Text>
            <Text class="font-mono text-[11px] text-muted-foreground">{reference().id.slice(0,8)}</Text>
          </Button></View>;}}</List>}
      <View class="flex-row flex-wrap justify-end gap-2 border-t border-border pt-2">
        <Button testID="tools-new-branch" onPress={()=>props.onRequest(workflowRequest("createBranch"))} class="h-7 justify-center rounded px-2 hover:bg-muted"><Text class="text-[11px] text-foreground">{t("Create branch…")}</Text></Button>
        <Button testID="tools-new-tag" onPress={()=>props.onRequest(workflowRequest("tagCreate"))} class="h-7 justify-center rounded px-2 hover:bg-muted"><Text class="text-[11px] text-foreground">{t("Create tag…")}</Text></Button>
        <Button testID="tools-stash-push" onPress={()=>props.onRequest(workflowRequest("stashPush"))} class="h-7 justify-center rounded px-2 hover:bg-muted"><Text class="text-[11px] text-foreground">{t("Stash changes…")}</Text></Button>
        <Button testID="tools-close" onPress={props.onClose} class="h-7 justify-center rounded bg-secondary px-3"><Text class="text-[12px] text-secondary-foreground">{t("Done")}</Text></Button>
      </View>
    </View>
  </Dialog>;
}

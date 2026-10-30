import { signal, Text, View } from "nsh";
import { Button, Dialog, Input } from "nsh/base";
import { Workspace } from "difflens/native";
import { t } from "../i18n";
import { accentClasses } from "../appearance";
import { errorMessage } from "../diagnostics";
import { LoadingStatus } from "./LoadingStatus";

export function RepositorySetupDialog(props: { clone: boolean; onClose: () => void; onCreated: (path: string) => Promise<string | null> }) {
  const parent = signal("");
  const name = signal("");
  const url = signal("");
  const busy = signal(false);
  const error = signal<string | null>(null);
  async function browse() {
    if (busy()) return;
    try {
      const chosen = await Workspace.chooseFolder(t("Parent folder"));
      if (chosen) parent.set(chosen);
    } catch (cause) { error.set(errorMessage(cause)); }
  }
  async function create() {
    if (busy()) return;
    busy.set(true); error.set(null);
    try {
      const result = await Workspace.setupRepository(parent().trim(), name().trim(), url().trim(), props.clone);
      const problem = await props.onCreated(result.rootPath);
      if (problem) error.set(problem); else props.onClose();
    } catch (cause) { error.set(errorMessage(cause)); }
    finally { busy.set(false); }
  }
  return <Dialog testID="repository-setup" closeOnBackdropPress={false} closeOnEscape={!busy()}
    onOpenChange={open=>{if(!open&&!busy())props.onClose();}} backdropClass="bg-black/30" class="flex-1 items-center justify-center p-4">
    <View class="w-[480px] max-w-full gap-3 rounded-lg border border-border bg-background p-4 shadow-sm">
      <Text class="text-[15px] font-semibold text-foreground">{t(props.clone?"Clone repository…":"Create repository…")}</Text>
      {props.clone?<Input testID="setup-url" value={url()} disabled={busy()} onChange={value=>url.set(value)} placeholder={t("Repository URL")} accessibilityLabel={t("Repository URL")}
        class={"h-7 rounded bg-subtle-input px-2 text-[12px] text-foreground "+accentClasses().focus}/>:null}
      <Text class="text-[11px] text-muted-foreground">{t("Parent folder")}</Text>
      <View class="flex-row gap-2"><Input testID="setup-parent" value={parent()} disabled={busy()} onChange={value=>parent.set(value)} accessibilityLabel={t("Parent folder")}
        class={"h-7 min-w-0 flex-1 rounded bg-subtle-input px-2 text-[12px] text-foreground "+accentClasses().focus}/>
        <Button disabled={busy()} onPress={()=>{void browse();}} class="h-7 justify-center rounded px-2 hover:bg-muted"><Text class="text-[12px] text-foreground">{t("Browse…")}</Text></Button></View>
      <Input testID="setup-name" value={name()} disabled={busy()} onChange={value=>name.set(value)} placeholder={t("Directory name")} accessibilityLabel={t("Directory name")}
        class={"h-7 rounded bg-subtle-input px-2 text-[12px] text-foreground "+accentClasses().focus}/>
      <Text class="text-[11px] text-muted-foreground">{t("A new directory will be created; existing directories are not replaced.")}</Text>
      {busy()?<LoadingStatus label={t("Git operation")+"…"}/>:null}
      {error()?<Text class="text-[12px] text-destructive">{error()}</Text>:null}
      <View class="flex-row justify-end gap-2"><Button disabled={busy()} onPress={props.onClose} class="h-7 justify-center rounded px-3 hover:bg-muted"><Text class="text-[12px] text-muted-foreground">{t("Cancel")}</Text></Button>
        <Button testID="setup-create" disabled={busy()||!parent().trim()||!name().trim()||(props.clone&&!url().trim())} onPress={()=>{void create();}}
          class={"h-7 justify-center rounded px-3 disabled:opacity-40 "+accentClasses().fill}><Text class={"text-[12px] "+accentClasses().foreground}>{t(props.clone?"Clone repository…":"Create repository…")}</Text></Button></View>
    </View>
  </Dialog>;
}

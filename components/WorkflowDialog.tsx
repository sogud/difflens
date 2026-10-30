import { computed, signal, Text, View } from "nsh";
import { Button, Checkbox, Dialog, Input } from "nsh/base";
import { Workspace, type GitOperationOutcome, type GitOperationPlan, type GitOperationRequest } from "difflens/native";
import { t, type Message } from "../i18n";
import { accentClasses } from "../appearance";
import { errorMessage } from "../diagnostics";
import { workflowTitles, type WorkflowKind } from "../git-workflows";
import { LoadingStatus } from "./LoadingStatus";

export function WorkflowDialog(props: {
  repositoryPath: string;
  request: GitOperationRequest;
  onCancel: () => void;
  onExecute: (plan: GitOperationPlan) => Promise<GitOperationOutcome>;
}) {
  const name = signal(props.request.name);
  const message = signal(props.request.message);
  const includeUntracked = signal(props.request.includeUntracked);
  const mainline = signal(String(props.request.mainline));
  const plan = signal<GitOperationPlan | null>(null);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const title = () => t(workflowTitles[props.request.kind as WorkflowKind] ?? "Git operation");
  const needsName = computed(() => ["createBranch", "renameBranch", "tagCreate"].includes(props.request.kind));
  const needsMessage = computed(() => ["stashPush", "tagCreate"].includes(props.request.kind));
  const needsParent = computed(() => ["cherryPick", "revert"].includes(props.request.kind));
  function invalidate() { plan.set(null); error.set(null); }
  const warning = computed<Message | null>(() => {
    switch (props.request.kind) {
      case "rebase": return "This operation rewrites commits on the current branch.";
      case "revert": return "Revert creates a new commit and preserves history.";
      case "checkoutCommit": return "This checks out a commit in detached HEAD state.";
      case "stashPop": case "stashApply": return "Applying a stash can cause conflicts; a failed pop keeps the stash.";
      case "stashDrop": return "This removes the stash entry.";
      case "abort": return "Abort restores the state before this Git operation; conflict-resolution edits may be lost.";
      case "skip": return "Skip omits the current commit from this operation.";
      default: return null;
    }
  });
  async function review() {
    if (busy()) return;
    busy.set(true); error.set(null);
    try {
      const parent = Number(mainline());
      if (!Number.isInteger(parent) || parent < 0) throw new Error(t("Enter a valid parent number."));
      const request = { ...props.request, name: name().trim(), message: message(), includeUntracked: includeUntracked(), mainline: parent };
      plan.set(await Workspace.prepareOperation(props.repositoryPath, request));
    } catch (cause) { error.set(errorMessage(cause)); }
    finally { busy.set(false); }
  }
  async function execute() {
    const current = plan();
    if (!current || busy()) return;
    busy.set(true); error.set(null);
    try {
      const outcome = await props.onExecute(current);
      if (outcome.status === "failed") { error.set(outcome.error ?? t("Git operation failed.")); plan.set(null); }
      else props.onCancel();
    } catch (cause) { error.set(errorMessage(cause)); plan.set(null); }
    finally { busy.set(false); }
  }
  return <Dialog testID="workflow-dialog" closeOnBackdropPress={false} closeOnEscape={!busy()}
    onOpenChange={(open) => { if (!open && !busy()) props.onCancel(); }} backdropClass="bg-black/30" class="flex-1 items-center justify-center p-4">
    <View class="w-[520px] max-w-full gap-3 rounded-lg border border-border bg-background p-4 shadow-sm">
      <Text class="text-[15px] font-semibold text-foreground">{title()}</Text>
      <Text numberOfLines={2} class="font-mono text-[11px] text-muted-foreground">{props.repositoryPath}</Text>
      {props.request.target ? <View class="gap-1"><Text class="text-[11px] text-muted-foreground">{t("Target")}</Text>
        <Text testID="workflow-target" numberOfLines={2} class="font-mono text-[12px] text-foreground">{props.request.target}</Text></View> : null}
      {needsName() ? <Input testID="workflow-name" value={name()} onChange={(value) => { name.set(value); invalidate(); }} disabled={busy()}
        accessibilityLabel={t("Name")} placeholder={t("Name")} class={"h-7 rounded border border-transparent bg-subtle-input px-2 text-[12px] text-foreground " + accentClasses().focus} /> : null}
      {needsMessage() ? <Input testID="workflow-message" value={message()} onChange={(value) => { message.set(value); invalidate(); }} disabled={busy()}
        accessibilityLabel={t("Message")} placeholder={t("Message")} class={"h-7 rounded border border-transparent bg-subtle-input px-2 text-[12px] text-foreground " + accentClasses().focus} /> : null}
      {props.request.kind === "stashPush" ? <Checkbox testID="workflow-untracked" checked={includeUntracked()} disabled={busy()}
        onChange={(value) => { includeUntracked.set(value); invalidate(); }} class="flex-row items-center gap-2">
        <View class="size-4 items-center justify-center rounded border border-border bg-subtle-input"><Text class="text-[11px] text-foreground">{includeUntracked() ? "✓" : ""}</Text></View>
        <Text class="text-[12px] text-foreground">{t("Include untracked files")}</Text>
      </Checkbox> : null}
      {needsParent() ? <View class="flex-row items-center gap-2"><Text class="min-w-0 flex-1 text-[11px] text-muted-foreground">{t("Mainline parent (merge commits)")}</Text>
        <Input testID="workflow-mainline" value={mainline()} disabled={busy()} onChange={(value) => { mainline.set(value); invalidate(); }}
          accessibilityLabel={t("Mainline parent (merge commits)")} class={"h-7 w-14 rounded bg-subtle-input px-2 text-[12px] text-foreground " + accentClasses().focus} /></View> : null}
      {warning() ? <Text class="text-[12px] text-warning">{t(warning()!)}</Text> : null}
      {plan() ? <View testID="workflow-plan" class="gap-1 rounded bg-surface-muted p-2">
        <Text class="text-[11px] text-foreground">{t("Current branch") + ": " + (plan()!.branchName ?? "HEAD")}</Text>
        <Text class="font-mono text-[11px] text-muted-foreground">{"HEAD " + plan()!.headId.slice(0, 12)}</Text>
        {plan()!.targetId ? <Text class="font-mono text-[11px] text-muted-foreground">{t("Target") + ": " + plan()!.targetId.slice(0, 12)}</Text> : null}
        <Text class="text-[11px] text-muted-foreground">{t("Commits affected") + ": " + String(plan()!.affectedCommits)}</Text>
      </View> : null}
      {busy() ? <LoadingStatus label={t("Git operation") + "…"} /> : null}
      {error() ? <Text testID="workflow-error" class="text-[12px] text-destructive">{error()}</Text> : null}
      <View class="flex-row justify-end gap-2">
        <Button disabled={busy()} onPress={props.onCancel} class="h-7 justify-center rounded px-3 hover:bg-muted"><Text class="text-[12px] text-muted-foreground">{t("Cancel")}</Text></Button>
        {plan() ? <Button testID="workflow-run" disabled={busy()} onPress={() => { void execute(); }} class={"h-7 justify-center rounded px-3 disabled:opacity-40 " + accentClasses().fill}>
          <Text class={"text-[12px] " + accentClasses().foreground}>{t("Run operation")}</Text>
        </Button> : <Button testID="workflow-review" disabled={busy()} onPress={() => { void review(); }} class={"h-7 justify-center rounded px-3 disabled:opacity-40 " + accentClasses().fill}>
          <Text class={"text-[12px] " + accentClasses().foreground}>{t("Review operation")}</Text>
        </Button>}
      </View>
    </View>
  </Dialog>;
}

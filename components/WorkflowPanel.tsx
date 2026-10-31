import { cleanup, computed, effect, signal, Text, untracked, View } from "nsh";
import { Button, Checkbox, Input } from "nsh/base";
import type { GitOperationOutcome, GitOperationPlan, GitOperationRequest } from "difflens/native";
import { t, type Message } from "../i18n";
import { accentClasses } from "../appearance";
import { errorMessage } from "../diagnostics";
import { workflowPresentation, workflowTitles, type WorkflowKind } from "../git-workflows";
import { watchUiActivity } from "../ui-activity";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";

type Phase = { kind: "editing" } | { kind: "preparing" } | { kind: "ready"; plan: GitOperationPlan } |
  { kind: "executing" } | { kind: "failed"; message: string };

export function WorkflowPanel(props: {
  repositoryPath: string;
  request: GitOperationRequest;
  onCancel: () => void;
  onCompleted?: (outcome: GitOperationOutcome, request: GitOperationRequest) => void;
  onPrepare: (request: GitOperationRequest, repositoryPath: string) => Promise<GitOperationPlan>;
  onExecute: (plan: GitOperationPlan) => Promise<GitOperationOutcome>;
}) {
  const name = signal("");
  const message = signal("");
  const includeUntracked = signal(false);
  const mainline = signal("0");
  const advancedOpen = signal(false);
  const phase = signal<Phase>({ kind: "editing" });
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const title = () => t(workflowTitles[props.request.kind as WorkflowKind] ?? "Git operation").replace(/…$/, "");
  const confirmation = () => workflowPresentation(props.request.kind) === "confirm";
  const busy = () => phase().kind === "preparing" || phase().kind === "executing";
  const needsName = () => ["createBranch", "renameBranch", "tagCreate"].includes(props.request.kind);
  const needsMessage = () => ["stashPush", "tagCreate"].includes(props.request.kind);
  const needsParent = () => ["cherryPick", "revert"].includes(props.request.kind);
  const nameLabel = (): Message => props.request.kind === "tagCreate" ? "Tag name" : "Branch name";
  const messageLabel = (): Message => props.request.kind === "stashPush" ? "Stash description" : "Tag annotation";
  const confirmLabel = (): Message => {
    switch (props.request.kind) {
      case "merge": return "Confirm merge";
      case "rebase": return "Confirm rebase";
      case "cherryPick": return "Confirm cherry-pick";
      case "revert": return "Confirm revert";
      case "checkoutCommit": return "Check out commit";
      case "deleteBranch": return "Delete branch";
      case "tagDelete": return "Delete tag";
      case "stashDrop": return "Drop stash";
      case "continue": return "Continue operation";
      case "abort": return "Abort operation";
      case "skip": return "Skip commit";
      default: return "Confirm operation";
    }
  };
  const plan = computed(() => { const current = phase(); return current.kind === "ready" ? current.plan : null; });
  const failure = computed(() => { const current = phase(); return current.kind === "failed" ? current.message : null; });
  watchUiActivity(() => busy() ? { kind: "operation", label: title() + "…", detail: props.repositoryPath } : null);
  const warning = computed<Message | null>(() => {
    switch (props.request.kind) {
      case "rebase": return "This operation rewrites commits on the current branch.";
      case "revert": return "Revert creates a new commit and preserves history.";
      case "checkoutCommit": return "This checks out a commit in detached HEAD state.";
      case "stashDrop": return "This removes the stash entry.";
      case "abort": return "Abort restores the state before this Git operation; conflict-resolution edits may be lost.";
      case "skip": return "Skip omits the current commit from this operation.";
      default: return null;
    }
  });
  function request() {
    const parent = Number(mainline());
    if (!Number.isInteger(parent) || parent < 0) throw new Error(t("Enter a valid parent number."));
    return { ...props.request, name: name().trim(), message: message(), includeUntracked: includeUntracked(), mainline: parent };
  }
  async function prepare(token: number) {
    if (token !== generation) return;
    phase.set({ kind: "preparing" });
    try {
      const prepared = await props.onPrepare(request(), props.repositoryPath);
      if (token === generation) phase.set({ kind: "ready", plan: prepared });
    } catch (cause) { if (token === generation) phase.set({ kind: "failed", message: errorMessage(cause) }); }
  }
  function invalidate(delay = 180) {
    clearTimeout(timer);
    const token = ++generation;
    phase.set({ kind: "editing" });
    if (confirmation()) timer = setTimeout(() => { void prepare(token); }, delay);
  }
  effect(() => {
    const incoming = props.request;
    void props.repositoryPath;
    untracked(() => {
      name.set(incoming.name);
      message.set(incoming.message);
      includeUntracked.set(incoming.includeUntracked);
      mainline.set(String(incoming.mainline));
      advancedOpen.set(false);
      invalidate(0);
    });
  });
  cleanup(() => { generation += 1; clearTimeout(timer); });
  async function submit() {
    if (busy() || (needsName() && !name().trim())) return;
    const token = ++generation;
    try {
      let prepared = plan();
      if (confirmation() && !prepared) return;
      if (!prepared) {
        phase.set({ kind: "preparing" });
        prepared = await props.onPrepare(request(), props.repositoryPath);
      }
      if (token !== generation) return;
      phase.set({ kind: "executing" });
      const outcome = await props.onExecute(prepared);
      if (token !== generation) return;
      if (outcome.status === "failed") phase.set({ kind: "failed", message: outcome.error ?? t("Git operation failed.") });
      else {
        props.onCompleted?.(outcome, prepared.request);
        props.onCancel();
      }
    } catch (cause) { if (token === generation) phase.set({ kind: "failed", message: errorMessage(cause) }); }
  }
  return <View testID="workflow-panel" class="shrink-0 gap-2 border-b border-border bg-surface-muted p-2">
    <View class="flex-row items-center gap-1"><Text class="min-w-0 flex-1 text-[12px] font-semibold text-foreground">{title()}</Text>
      <IconButton icon="stop" compact label={t("Cancel")} disabled={busy()} onPress={props.onCancel} /></View>
    {props.request.target ? <Text numberOfLines={2} class="font-mono text-[10px] text-muted-foreground">{props.request.target}</Text> : null}
    {needsName() ? <Input autoFocus value={name()} onChange={value => { name.set(value); invalidate(); }} disabled={busy()}
      placeholder={t(nameLabel())} accessibilityLabel={t(nameLabel())} onSubmit={() => { void submit(); }} class="h-7 rounded bg-subtle-input px-2 text-[12px] text-foreground" /> : null}
    {needsMessage() ? <Input value={message()} onChange={value => { message.set(value); invalidate(); }} disabled={busy()}
      placeholder={t(messageLabel())} accessibilityLabel={t(messageLabel())} class="h-7 rounded bg-subtle-input px-2 text-[12px] text-foreground" /> : null}
    {props.request.kind === "stashPush" ? <Checkbox checked={includeUntracked()} disabled={busy()} onChange={value => { includeUntracked.set(value); invalidate(); }} class="flex-row items-center gap-2">
      <View class="size-4 items-center justify-center rounded border border-border"><Text class="text-[11px] text-foreground">{includeUntracked() ? "✓" : ""}</Text></View>
      <Text class="text-[11px] text-muted-foreground">{t("Include untracked files")}</Text>
    </Checkbox> : null}
    {needsParent() ? <View class="gap-1">
      <Button onPress={() => advancedOpen.set(!advancedOpen())} accessibilityLabel={t("Advanced merge options")}
        class="h-6 flex-row items-center gap-1 px-1 hover:bg-muted/60">
        <Icon name={advancedOpen() ? "chevronDown" : "chevronRight"} size={11} muted />
        <Text class="text-[10px] text-muted-foreground">{t("Advanced merge options")}</Text>
      </Button>
      {advancedOpen() ? <View class="flex-row items-center gap-2"><Text class="min-w-0 flex-1 text-[10px] text-muted-foreground">{t("Mainline parent (merge commits)")}</Text>
        <Input value={mainline()} onChange={value => { mainline.set(value); invalidate(); }} disabled={busy()} accessibilityLabel={t("Mainline parent (merge commits)")} class="h-7 w-10 rounded bg-subtle-input px-1 text-[11px] text-foreground" /></View> : null}
    </View> : null}
    {warning() ? <Text class="text-[11px] text-warning">{t(warning()!)}</Text> : null}
    {plan() ? <View class="gap-0.5"><Text class="text-[10px] text-muted-foreground">{t("Current branch") + ": " + (plan()!.branchName ?? "HEAD")}</Text>
      <Text class="font-mono text-[10px] text-muted-foreground">{"HEAD " + plan()!.headId.slice(0, 10)}</Text>
      {plan()!.targetId ? <Text class="font-mono text-[10px] text-muted-foreground">{t("Target") + ": " + plan()!.targetId.slice(0, 10)}</Text> : null}
      {plan()!.affectedCommits > 0 ? <Text class="text-[10px] text-muted-foreground">{t("Commits affected") + ": " + plan()!.affectedCommits}</Text> : null}</View> : null}
    {failure() ? <Text class="text-[11px] text-destructive">{failure()}</Text> : null}
    <View class="flex-row justify-end gap-1">
      {confirmation() && failure() ? <Button onPress={() => invalidate(0)} class="h-7 justify-center px-2 hover:bg-muted"><Text class="text-[11px] text-foreground">{t("Retry")}</Text></Button> : null}
      <Button disabled={busy()} onPress={props.onCancel} class="h-7 justify-center px-2 hover:bg-muted"><Text class="text-[11px] text-muted-foreground">{t("Cancel")}</Text></Button>
      <Button disabled={busy() || (needsName() && !name().trim()) || (confirmation() && !plan())} onPress={() => { void submit(); }}
        class={"h-7 justify-center rounded px-2 disabled:opacity-35 " + accentClasses().fill}>
        <Text class={"text-[11px] " + accentClasses().foreground}>{confirmation() ? t(confirmLabel()) : title()}</Text>
      </Button>
    </View>
  </View>;
}

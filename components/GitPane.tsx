import { cleanup, computed, effect, List, signal, Text, untracked, View, type YNode } from "nsh";
import { Button, Input } from "nsh/base";
import { Menu } from "nsh/desktop";
import type { GitContext, GitReference, GitStash, GitOperationRequest, GitOperationPlan, GitOperationOutcome } from "difflens/native";
import { t, type Message } from "../i18n";
import { copyText } from "../context-menu";
import { workflowRequest } from "../git-workflows";
import { DENSITY } from "../ui-density";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { WorkflowPanel } from "./WorkflowPanel";

type Group = "local" | "remote" | "tag" | "stash";
type GitRow = { kind: "group"; key: string; group: Group; title: Message; count: number; expanded: boolean } |
  { kind: "reference"; key: string; value: GitReference } | { kind: "stash"; key: string; value: GitStash };
const groups: { kind: Group; title: Message }[] = [
  { kind: "local", title: "Branches" }, { kind: "remote", title: "Remotes" }, { kind: "tag", title: "Tags" }, { kind: "stash", title: "Stashes" },
];

export function GitPane(props: {
  active: boolean;
  repositoryPath: string;
  context: GitContext | null;
  loading: boolean;
  disabled: boolean;
  request: GitOperationRequest | null;
  onClose: () => void;
  onRefresh: (root: string) => void;
  onRequest: (request: GitOperationRequest, root: string) => void;
  onSwitch: (branch: string, root: string) => void;
  onCancelRequest: () => void;
  onPrepare: (request: GitOperationRequest, root: string) => Promise<GitOperationPlan>;
  onExecute: (plan: GitOperationPlan) => Promise<GitOperationOutcome>;
}) {
  const query = signal("");
  const selectedKey = signal<string | null>(null);
  const collapsed = signal<ReadonlySet<Group>>(new Set(["remote", "tag", "stash"]));
  const revealRequest = signal<string | null>(null);
  let list: YNode | undefined;
  let filterInput: YNode | undefined;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let stashIdsBefore: ReadonlySet<string> | null = null;
  cleanup(() => { if (focusTimer !== undefined) clearTimeout(focusTimer); });
  effect(() => { void props.repositoryPath; untracked(() => { query.set(""); selectedKey.set(null); revealRequest.set(null); stashIdsBefore = null; }); });
  const rows = computed<GitRow[]>(() => {
    const result: GitRow[] = [];
    const text = query().trim().toLowerCase();
    for (const group of groups) {
      const values = group.kind === "stash"
        ? (props.context?.stashes ?? []).filter(item => !text || (item.reference + " " + item.message).toLowerCase().includes(text))
        : (props.context?.references ?? []).filter(item => item.kind === group.kind && (!text || item.name.toLowerCase().includes(text)));
      if (text && values.length === 0) continue;
      const expanded = !!text || !collapsed().has(group.kind);
      result.push({ kind: "group", key: "group:" + group.kind, group: group.kind, title: group.title, count: values.length, expanded });
      if (expanded) {
        if (group.kind === "stash") for (const value of values as GitStash[]) result.push({ kind: "stash", key: "stash:" + value.id + value.reference, value });
        else for (const value of values as GitReference[]) result.push({ kind: "reference", key: "ref:" + value.name, value });
      }
    }
    return result;
  });
  function toggle(group: Group) {
    const next = new Set(collapsed());
    if (next.has(group)) next.delete(group); else next.add(group);
    collapsed.set(next);
  }
  function revealKey(key: string) {
    const index = rows().findIndex(row => row.key === key);
    if (index < 0 || !list) return;
    revealRequest.set(null);
    list.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
  }
  effect(() => {
    const key = revealRequest();
    if (!key) return;
    void rows();
    untracked(() => revealKey(key));
  });
  function completedResult(outcome: GitOperationOutcome, request: GitOperationRequest): { group: Group; key: string; search: string } | null {
    if (outcome.details.path !== props.repositoryPath) return null;
    switch (request.kind) {
      case "createBranch":
      case "renameBranch": {
        const reference = outcome.context.references.find(value => value.kind === "local" &&
          (value.shortName === request.name || value.name === "refs/heads/" + request.name));
        return reference ? { group: "local", key: "ref:" + reference.name, search: reference.name } : null;
      }
      case "tagCreate": {
        const reference = outcome.context.references.find(value => value.kind === "tag" &&
          (value.shortName === request.name || value.name === "refs/tags/" + request.name));
        return reference ? { group: "tag", key: "ref:" + reference.name, search: reference.name } : null;
      }
      case "stashPush": {
        const previousIds = stashIdsBefore;
        const stash = previousIds ? outcome.context.stashes.find(value =>
          value.reference === "stash@{0}" && !previousIds.has(value.id)) : undefined;
        return stash ? { group: "stash", key: "stash:" + stash.id + stash.reference, search: stash.reference + " " + stash.message } : null;
      }
      default:
        return null;
    }
  }
  function focusFilter() {
    if (focusTimer !== undefined) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => { focusTimer = undefined; filterInput?.focus(); }, 0);
  }
  effect(() => {
    const focus = props.active && !props.request;
    void props.repositoryPath;
    untracked(() => {
      if (focus) focusFilter();
      else if (focusTimer !== undefined) { clearTimeout(focusTimer); focusTimer = undefined; }
    });
  });
  async function executeWorkflow(plan: GitOperationPlan) {
    stashIdsBefore = plan.request.kind === "stashPush" && props.context
      ? new Set(props.context.stashes.map(stash => stash.id)) : null;
    return props.onExecute(plan);
  }
  function completeWorkflow(outcome: GitOperationOutcome, request: GitOperationRequest) {
    if (outcome.status !== "completed" || outcome.details.path !== props.repositoryPath) return;
    focusFilter();
    const result = completedResult(outcome, request);
    stashIdsBefore = null;
    if (!result) return;
    const filter = query().trim().toLowerCase();
    if (filter && !result.search.toLowerCase().includes(filter)) query.set("");
    if (collapsed().has(result.group)) {
      const next = new Set(collapsed());
      next.delete(result.group);
      collapsed.set(next);
    }
    selectedKey.set(result.key);
    revealRequest.set(result.key);
  }
  function menu(row: GitRow): Parameters<typeof Menu.popup>[0] {
    const root = props.repositoryPath;
    const request = (value: GitOperationRequest) => props.onRequest(value, root);
    if (row.kind === "stash") {
      const stash = row.value;
      return [
        { label: t("Apply stash…").replace(/…$/, ""), disabled: props.disabled, onSelect: () => request(workflowRequest("stashApply", stash.reference)) },
        { label: t("Pop stash…").replace(/…$/, ""), disabled: props.disabled, onSelect: () => request(workflowRequest("stashPop", stash.reference)) },
        { label: t("Drop stash…"), disabled: props.disabled, onSelect: () => request(workflowRequest("stashDrop", stash.reference)) },
        { type: "separator" }, { label: t("Copy commit ID"), onSelect: () => copyText(stash.id) },
      ];
    }
    if (row.kind !== "reference") return [];
    const reference = row.value;
    return [
      ...(reference.kind === "local" ? [{ label: t("Switch branch"), disabled: props.disabled || reference.current, onSelect: () => props.onSwitch(reference.shortName, root) }] : []),
      { label: t("Create branch…"), disabled: props.disabled, onSelect: () => request(workflowRequest("createBranch", reference.name)) },
      { label: t("Merge into current branch…"), disabled: props.disabled || reference.current, onSelect: () => request(workflowRequest("merge", reference.name)) },
      { label: t("Rebase current branch onto…"), disabled: props.disabled || reference.current, onSelect: () => request(workflowRequest("rebase", reference.name)) },
      { label: t("Cherry-pick commit…"), disabled: props.disabled, onSelect: () => request(workflowRequest("cherryPick", reference.name)) },
      { label: t("Revert commit…"), disabled: props.disabled, onSelect: () => request(workflowRequest("revert", reference.name)) },
      { label: t("Check out commit…"), disabled: props.disabled, onSelect: () => request(workflowRequest("checkoutCommit", reference.name)) },
      ...(reference.kind === "local" ? [
        { label: t("Rename branch…"), disabled: props.disabled, onSelect: () => request({ ...workflowRequest("renameBranch", reference.name), name: reference.shortName }) },
        { label: t("Delete branch…"), disabled: props.disabled || reference.current, onSelect: () => request(workflowRequest("deleteBranch", reference.name)) },
      ] : []),
      ...(reference.kind === "tag" ? [{ label: t("Delete tag…"), disabled: props.disabled, onSelect: () => request(workflowRequest("tagDelete", reference.name)) }] : []),
      { type: "separator" }, { label: t("Copy commit ID"), onSelect: () => copyText(reference.id) },
    ];
  }
  const selected = computed<GitRow | null>(() => {
    const key = selectedKey();
    if (!key) return null;
    const reference = props.context?.references.find(value => "ref:" + value.name === key);
    if (reference) return { kind: "reference", key, value: reference };
    const stash = props.context?.stashes.find(value => "stash:" + value.id + value.reference === key);
    return stash ? { kind: "stash", key, value: stash } : null;
  });
  const switchableBranch = computed(() => {
    const row = selected();
    return row?.kind === "reference" && row.value.kind === "local" && !row.value.current ? row.value.shortName : null;
  });
  return <View testID="git-pane" class="min-h-0 flex-1 bg-surface-muted">
    <View class="h-8 shrink-0 flex-row items-center gap-1 px-2">
      <Text class="min-w-0 flex-1 text-[11px] font-medium text-foreground">{t("Branches and Stash")}</Text>
      <IconButton icon="plus" compact label={t("Create branch…")} disabled={props.disabled} onPress={() => props.onRequest(workflowRequest("createBranch"), props.repositoryPath)} />
      <IconButton icon="refresh" compact label={t("Refresh")} disabled={props.disabled || props.loading} onPress={() => props.onRefresh(props.repositoryPath)} />
      <IconButton icon="stop" compact label={t("Close navigation")} onPress={props.onClose} />
    </View>
    {props.request ? <WorkflowPanel repositoryPath={props.repositoryPath} request={props.request} onCancel={props.onCancelRequest}
      onCompleted={completeWorkflow}
      onPrepare={props.onPrepare} onExecute={executeWorkflow} /> : null}
    <View class="shrink-0 px-2 py-1.5"><Input ref={node => { filterInput = node; }} value={query()} onChange={value => { query.set(value); selectedKey.set(null); }}
      accessibilityLabel={t("Filter…")} placeholder={t("Filter…")} class="h-7 rounded bg-subtle-input px-2 text-[11px] text-foreground" /></View>
    <List ref={node => { list = node; const key = revealRequest(); if (key) untracked(() => revealKey(key)); }}
      each={rows()} keyExtractor={row => row.key} estimatedItemSize={DENSITY.compactRowSize} class="min-h-0 flex-1"
      empty={props.loading ? <View /> : <Text class="px-3 py-2 text-[11px] text-muted-foreground">{t(query().trim() ? "No matching items" : "Nothing here yet.")}</Text>}>
      {item => {
        const group = computed(() => { const row = item(); return row.kind === "group" ? row : null; });
        const label = () => { const row = item(); return row.kind === "reference" ? row.value.shortName : row.kind === "stash" ? row.value.reference + " · " + row.value.message : ""; };
        return <View class={DENSITY.compactRow}>
          {group() ? <Button onPress={() => { const current = group(); if (current) toggle(current.group); }} class={DENSITY.compactRow + " flex-row items-center gap-1.5 px-2 hover:bg-muted/50"}>
          <Icon name={group()?.expanded ? "chevronDown" : "chevronRight"} size={11} muted />
          <Text class="min-w-0 flex-1 text-[11px] font-medium text-foreground">{group() ? t(group()!.title) : ""}</Text>
          <Text class="text-[10px] text-muted-foreground">{group()?.count}</Text>
        </Button> : <View class={DENSITY.compactRow + " flex-row items-center pl-3 pr-1"} onContextMenu={event => { const row = item(); void Menu.popup(menu(row), event.pagePosition); }}>
          <Button selected={item().key === selectedKey()} onPress={() => selectedKey.set(item().key)} class={DENSITY.compactRow + " min-w-0 flex-1 flex-row items-center gap-1.5 px-1 hover:bg-muted/50 selected:bg-accent"}>
            <Icon name={item().kind === "stash" ? "history" : "worktree"} size={13} muted />
            <Text numberOfLines={1} class="min-w-0 flex-1 text-[11px] text-foreground">{label()}</Text>
            {(() => { const row = item(); return row.kind === "reference" && row.value.current ? <Text class="text-[10px] text-muted-foreground">✓</Text> : null; })()}
          </Button>
          <IconButton icon="more" compact label={t("More actions")} onPress={() => { void Menu.popup(menu(item())); }} />
        </View>}
        </View>;
      }}
    </List>
    {selected() && selected()!.kind !== "group" && !props.request ? <View class="shrink-0 gap-1 px-2 py-2">
      <Text numberOfLines={2} class="text-[11px] text-foreground">{(() => { const row = selected(); return row?.kind === "reference" ? row.value.name : row?.kind === "stash" ? row.value.message : ""; })()}</Text>
      <Text numberOfLines={1} class="font-mono text-[10px] text-muted-foreground">{(() => { const row = selected(); return row?.kind === "reference" || row?.kind === "stash" ? row.value.id : ""; })()}</Text>
      <View class="flex-row items-center gap-1">
        {switchableBranch() ? <Button disabled={props.disabled} onPress={() => { const name = switchableBranch(); if (name && !props.disabled) props.onSwitch(name, props.repositoryPath); }}
          class="h-6 justify-center rounded px-1.5 hover:bg-muted disabled:opacity-35"><Text class="text-[11px] text-foreground">{t("Switch branch")}</Text></Button> : null}
        <Button onPress={() => { const row = selected(); if (row) void Menu.popup(menu(row)); }} class="h-6 justify-center px-1 hover:bg-muted"><Text class="text-[11px] text-muted-foreground">{t("More actions")}</Text></Button>
      </View>
    </View> : null}
    <View class="shrink-0 flex-row flex-wrap gap-1 p-1.5">
      <Button disabled={props.disabled} onPress={() => props.onRequest(workflowRequest("tagCreate"), props.repositoryPath)} class="h-7 justify-center px-2 hover:bg-muted"><Text class="text-[11px] text-foreground">{t("Create tag…")}</Text></Button>
      <Button disabled={props.disabled} onPress={() => props.onRequest(workflowRequest("stashPush"), props.repositoryPath)} class="h-7 justify-center px-2 hover:bg-muted"><Text class="text-[11px] text-foreground">{t("Stash changes…")}</Text></Button>
    </View>
  </View>;
}

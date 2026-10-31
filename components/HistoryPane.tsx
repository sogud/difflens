import { cleanup, computed, effect, List, signal, Text, untracked, View } from "nsh";
import { Button, Input } from "nsh/base";
import { Menu } from "nsh/desktop";
import { Workspace, type CommitSummary } from "difflens/native";
import { copyText } from "../context-menu";
import { t } from "../i18n";
import { freshHistory, type HistoryNavigation, type HistorySearchField } from "../repository-session";
import { Hint } from "./Hint";
import { IconButton } from "./IconButton";
import { accentClasses } from "../appearance";
import { watchUiActivity } from "../ui-activity";
import { commitWorkflowMenu, type RequestWorkflow } from "../git-workflows";

export function HistoryPane(props: {
  revision: number;
  active: boolean;
  onWorkflow: RequestWorkflow;
  repositoryPath: string;
  branch: string;
  initialHistory: HistoryNavigation;
  selectedId: string | null;
  disabled: boolean;
  changedCount: number;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  onNavigation: (value: HistoryNavigation) => void;
  onWorkingChanges: () => void;
}) {
  const commits = signal<CommitSummary[]>([]);
  const query = signal("");
  const field = signal<HistorySearchField>("message");
  const loading = signal(true);
  watchUiActivity(() => loading() ? { kind: "history", label: t("Loading history…"), detail: props.branch } : null);
  const error = signal<string | null>(null);
  const hasMore = signal(false);
  const changed = signal(false);
  const restoredIndex = signal(0);
  const startOffset = signal(0);
  let tip: string | null = null;
  let nextOffset: number | null = null;
  let pageSize = 50;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastIndex = 0;
  let loadingMore = false;
  const needsLongerId = computed(() => field() === "id" && query().trim().length > 0 && query().trim().length < 7);
  cleanup(() => { generation += 1; clearTimeout(timer); });

  function remember(index = lastIndex) {
    lastIndex = Math.max(0, index);
    props.onNavigation({ query: query(), field: field(), tipId: tip,
      offset: startOffset() + Math.floor(lastIndex / pageSize) * pageSize,
      index: lastIndex % pageSize, branch: props.branch });
  }

  async function load(offset: number, append: boolean, request: number) {
    if (request !== generation) return;
    const root = props.repositoryPath;
    loading.set(true);
    loadingMore = append;
    error.set(null);
    if (needsLongerId()) { loading.set(false); remember(); return; }
    try {
      const page = await Workspace.historyPage(root, query(), field(), tip, offset);
      if (request !== generation || props.repositoryPath !== root) return;
      tip = page.tipId ?? null;
      pageSize = page.pageSize;
      nextOffset = page.nextOffset ?? null;
      changed.set(tip !== (page.currentTipId ?? null));
      if (append) commits.set([...commits(), ...page.commits]);
      else { startOffset.set(page.offset); commits.set(page.commits); }
      hasMore.set(nextOffset !== null);
      loading.set(false);
      remember();
      if (props.active && !props.selectedId && page.commits[0]) props.onSelect(page.commits[0].id);
    } catch (cause) {
      if (request !== generation || props.repositoryPath !== root) return;
      error.set(cause instanceof Error ? cause.message : String(cause));
      loading.set(false);
    }
  }

  function restart(delay = 0) {
    clearTimeout(timer);
    const request = ++generation;
    tip = null;
    nextOffset = null;
    lastIndex = 0;
    startOffset.set(0);
    restoredIndex.set(0);
    commits.set([]);
    hasMore.set(false);
    changed.set(false);
    loading.set(true);
    error.set(null);
    props.onClearSelection();
    remember(0);
    if (delay) timer = setTimeout(() => { void load(0, false, request); }, delay);
    else void load(0, false, request);
  }

  effect(() => {
    const root = props.repositoryPath;
    const branch = props.branch;
    // Repository refreshes invalidate data; a tab switch only changes visibility.
    void props.revision;
    untracked(() => {
      clearTimeout(timer);
      const saved = props.initialHistory;
      const branchChanged = saved.branch !== "" && saved.branch !== branch;
      const nav = branchChanged ? freshHistory(branch) : saved;
      if (branchChanged) props.onClearSelection();
      query.set(nav.query);
      field.set(nav.field);
      tip = nav.tipId;
      lastIndex = nav.index;
      startOffset.set(nav.offset);
      restoredIndex.set(nav.index);
      commits.set([]);
      hasMore.set(false);
      nextOffset = null;
      const request = ++generation;
      if (root) void load(nav.offset, false, request);
    });
  });

  effect(() => {
    if (props.active && !loading() && !props.selectedId && commits()[0]) props.onSelect(commits()[0].id);
  });

  function select(id: string, index: number) {
    if (props.disabled || loading()) return;
    remember(index);
    props.onSelect(id);
  }

  const fields: { value: HistorySearchField; label: "Message" | "Author" | "Commit ID" }[] = [
    { value: "message", label: "Message" }, { value: "author", label: "Author" }, { value: "id", label: "Commit ID" },
  ];

  return <View testID="history-pane" class="min-h-0 flex-1">
    <Button testID="history-wip" disabled={props.disabled} onPress={props.onWorkingChanges}
      class="flex-row items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 hover:bg-muted">
      <View class={"size-2 rounded-full " + accentClasses().fill} />
      <Text class="min-w-0 flex-1 text-[12px] font-medium text-foreground">{t("Working changes")}</Text>
      <Text class="text-[11px] text-muted-foreground">{String(props.changedCount)}</Text>
    </Button>
    <View class="gap-1.5 border-b border-border px-2 py-2">
      <View class="flex-row items-center gap-1">
        <Input testID="history-query" value={query()} disabled={props.disabled}
          accessibilityLabel={t("Search current branch history")}
          placeholder={t("Search current branch history")}
          onChange={(value) => { query.set(value); restart(250); }}
          onSubmit={() => restart()}
          class={"h-7 min-w-0 flex-1 rounded border border-transparent bg-subtle-input px-2 text-[11px] text-foreground focus:bg-background " + accentClasses().focus} />
        <IconButton testID="refresh-history" icon="refresh" label={t("Refresh history")} disabled={props.disabled} onPress={() => restart()} />
      </View>
      <View class="flex-row gap-1">{fields.map((choice) => <Button
        testID={"history-field:" + choice.value} selected={field() === choice.value} disabled={props.disabled}
        accessibilityLabel={t("Search by {field}", { field: t(choice.label) })}
        onPress={() => { field.set(choice.value); restart(); }}
        class="rounded px-2 py-1 hover:bg-muted selected:bg-accent">
        <Text class="text-[10px] text-foreground">{t(choice.label)}</Text>
      </Button>)}</View>
      <View class="flex-row items-center gap-2">
        <Text testID="history-scope" class="min-w-0 flex-1 text-[10px] text-muted-foreground">{t("Current branch · {count} loaded", { count: commits().length })}</Text>
        {startOffset() > 0 ? <Button testID="history-latest" disabled={props.disabled} onPress={() => restart()} class="rounded px-1 py-0.5 hover:bg-muted"><Text class={"text-[10px] " + accentClasses().text}>{t("Back to latest")}</Text></Button> : null}
      </View>
      {changed() ? <Text testID="history-changed" class="text-[10px] text-muted-foreground">{t("History changed. Refresh to see the latest commits.")}</Text> : null}
      {error() ? <View class="gap-1">
        <Text testID="history-error" class="text-[11px] text-destructive">{error()}</Text>
        <Button testID="history-retry" disabled={props.disabled} onPress={() => { void load(loadingMore ? nextOffset ?? startOffset() : startOffset(), loadingMore, generation); }} class="rounded px-2 py-1 hover:bg-muted"><Text class="text-[11px] text-foreground">{t("Retry")}</Text></Button>
      </View> : null}
    </View>
    {commits().length > 0 ? <List testID="history-list" each={commits()} keyExtractor={(commit) => commit.id}
      initialScrollIndex={Math.min(restoredIndex(), commits().length - 1)} estimatedItemSize={49}
      class="min-h-0 flex-1" viewabilityConfig={{ minimumViewTime: 150 }}
      onViewableItemsChange={({ viewableItems }) => {
        if (!props.active || loading() || !viewableItems.length) return;
        remember(Math.min(...viewableItems.map((item) => item.index)));
      }}
      footer={<View class="px-3 py-2">{hasMore() ? <Button testID="history-more" disabled={props.disabled || loading()}
        onPress={() => { if (nextOffset !== null && !loading()) void load(nextOffset, true, generation); }}
        class="items-center rounded bg-secondary/60 px-2 py-1.5 hover:bg-accent disabled:opacity-35"><Text class="text-[11px] text-foreground">{t("Load older commits")}</Text></Button> : <Text class="text-[10px] text-muted-foreground">{t("End of this history query")}</Text>}</View>}
    >{(item, index) => {
      const commit = computed(item);
      return <View tooltip={<Hint text={commit().subject} />} onContextMenu={(event) => {
        const current = commit();
        const position = index();
        void Menu.popup([
          { label: t("View commit"), disabled: props.disabled || loading(), onSelect: () => select(current.id, position) },
          ...commitWorkflowMenu(current.id, props.disabled || loading(), props.onWorkflow),
          { label: t("Copy commit ID"), onSelect: () => copyText(current.id) },
          { type: "separator" },
          { label: t("Back to working changes"), disabled: props.disabled, onSelect: props.onWorkingChanges },
        ], event.pagePosition);
      }}>
        <Button testID={"history-commit:" + commit().id} selected={props.selectedId === commit().id}
          disabled={props.disabled || loading()} accessibilityLabel={t("View commit {id}", { id: commit().shortId })}
          onPress={() => select(commit().id, index())}
          class="h-12 justify-center gap-1 px-3 text-left hover:bg-muted/60 selected:bg-accent">
          <View class="flex-row items-center gap-2"><Text class="font-mono text-[10px] text-muted-foreground">{commit().shortId}</Text>
            <Text numberOfLines={1} class="min-w-0 flex-1 text-[12px] font-medium text-foreground">{commit().subject}</Text></View>
          <Text numberOfLines={1} class="text-[10px] text-muted-foreground">{commit().author + " · " + commit().authoredAt}</Text>
        </Button>
      </View>;
    }}</List> : !loading() && !error() ? <Text testID="history-empty" class="px-3 py-3 text-[12px] text-muted-foreground">{t(needsLongerId() ? "Enter at least 7 hexadecimal characters to search by ID." : query().trim() ? "No commits match. Change the search or clear it to browse history." : "No commits yet.")}</Text> : <View class="flex-1" />}
  </View>;
}

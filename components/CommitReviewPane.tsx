import { cleanup, computed, effect, List, signal, Text, View } from "nsh";
import { Button, ResizablePanel, ResizablePanelGroup } from "nsh/base";
import { Menu } from "nsh/desktop";
import { Workspace, type CommitDetails, type CommitFile } from "difflens/native";
import { t } from "../i18n";
import { errorMessage } from "../diagnostics";
import { copyText } from "../context-menu";
import type { DiffState } from "../ui-types";
import { DiffPane } from "./DiffPane";
import { watchUiActivity } from "../ui-activity";
import { commitWorkflowMenu, type RequestWorkflow } from "../git-workflows";
import { panelGripClass, panelHandleClass, PANEL_LIMITS, type PanelSizes, type ResizePanel } from "../panel-layout";
import { ReviewHeader, type ReviewFocus } from "./ReviewHeader";
import { Hint } from "./Hint";

type CommitState = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready" };

export function CommitReviewPane(props: {
  focus?: ReviewFocus;
  onWorkflow: RequestWorkflow;
  panelSizes: PanelSizes;
  onPanelResize: ResizePanel;
  repositoryPath: string;
  commitId: string;
  onBack: () => void;
  disabled: boolean;
  initialFilePath: string | null;
  onFileSelection: (path: string) => void;
}) {
  const state = signal<CommitState>({ kind: "loading" });
  const displayed = signal<CommitDetails | null>(null);
  const diff = signal<DiffState>({ kind: "idle" });
  let loadedRoot = "";
  let generation = 0;
  let diffRequest = 0;
  const pending = () => state().kind === "loading";
  const failed = computed(() => { const value = state(); return value.kind === "failed" ? value.message : null; });
  watchUiActivity(() => pending() ? { kind: "commit", label: t("Loading commit…"), detail: props.commitId.slice(0, 8) } : null);
  cleanup(() => { generation += 1; diffRequest += 1; });

  async function selectFile(file: CommitFile, commit: CommitDetails, root: string, request: number) {
    if (request !== generation || props.repositoryPath !== root || props.commitId !== commit.id) return;
    props.onFileSelection(file.path);
    const next = ++diffRequest;
    diff.set({ kind: "loading", filePath: file.path, staged: false });
    try {
      const patch = await Workspace.commitDiff(root, commit.id, file.path);
      if (generation !== request || diffRequest !== next) return;
      diff.set({ kind: "ready", filePath: file.path, staged: false, patch });
    } catch (cause) {
      if (generation !== request || diffRequest !== next) return;
      diff.set({ kind: "failed", filePath: file.path, staged: false, message: errorMessage(cause) });
    }
  }
  async function load(root: string, id: string) {
    const request = ++generation;
    diffRequest += 1;
    if (loadedRoot !== root) { displayed.set(null); diff.set({ kind: "idle" }); loadedRoot = root; }
    state.set({ kind: "loading" });
    try {
      const commit = await Workspace.inspectCommit(root, id);
      if (generation !== request || props.repositoryPath !== root || props.commitId !== id) return;
      const selected = commit.files.find(file => file.path === props.initialFilePath) ?? commit.files[0];
      diff.set(selected ? { kind: "loading", filePath: selected.path, staged: false } : { kind: "idle" });
      displayed.set(commit);
      state.set({ kind: "ready" });
      if (selected) await selectFile(selected, commit, root, request);
    } catch (cause) {
      if (generation !== request) return;
      displayed.set(null);
      diff.set({ kind: "idle" });
      state.set({ kind: "failed", message: errorMessage(cause) });
    }
  }
  effect(() => { const root = props.repositoryPath; const id = props.commitId; void load(root, id); });
  const title = () => t("Commit {id}", { id: displayed()?.shortId ?? props.commitId.slice(0, 8) });
  return <View testID="commit-review" class="min-h-0 flex-1">
    <ReviewHeader label={title()} focus={props.focus} actions={<View tooltip={<Hint text={t("Back to working changes")} />}>
      <Button testID="back-to-wip" accessibilityLabel={t("Back to working changes")} disabled={props.disabled} onPress={props.onBack} class="size-6 items-center justify-center hover:bg-muted">
        <Text class="text-[15px] text-muted-foreground">←</Text>
      </Button>
    </View>}><Text class="font-mono text-[11px] text-foreground">{title()}</Text></ReviewHeader>
    {failed() ? <View class="flex-1 items-center justify-center gap-2 p-4">
      <Text class="text-[12px] text-destructive">{t("Could not read commit")}</Text>
      <Text class="text-[11px] text-muted-foreground">{failed()}</Text>
      <Button onPress={() => { void load(props.repositoryPath, props.commitId); }}><Text>{t("Retry")}</Text></Button>
    </View> : null}
    <View class={failed() ? "hidden" : "min-h-0 flex-1"}>
      <View class="h-[88px] shrink-0 gap-0.5 border-b border-border px-3 py-2" onContextMenu={event => {
        const commit = displayed();
        if (!commit) return;
        void Menu.popup([...commitWorkflowMenu(commit.id, props.disabled || pending(), props.onWorkflow),
          { label: t("Copy commit ID"), onSelect: () => copyText(commit.id) },
          { label: t("Copy commit message"), onSelect: () => copyText(commit.message) }], event.pagePosition);
      }}>
        <Text numberOfLines={2} class="text-[12px] font-semibold text-foreground">{displayed()?.message ?? ""}</Text>
        <Text numberOfLines={1} class="text-[11px] text-muted-foreground">{displayed() ? displayed()!.author + " · " + displayed()!.authoredAt : ""}</Text>
        {displayed() && displayed()!.parentIds.length !== 1 ? <Text testID="commit-comparison" numberOfLines={1} class="text-[10px] text-muted-foreground">{displayed()!.parentIds[0]
          ? t("Compared with first parent {id}", { id: displayed()!.parentIds[0].slice(0, 8) }) : t("Initial commit · compared with empty tree")}</Text> : null}
      </View>
      <ResizablePanelGroup axis="vertical" class="min-h-0 flex-1" handleClass={panelHandleClass()} handleThumbClass={panelGripClass()} handleAccessibilityLabel={t("Resize commit files and diff")}>
        <ResizablePanel fixed size={props.panelSizes.commitFiles} minSize={PANEL_LIMITS.commitFiles.min} maxSize={PANEL_LIMITS.commitFiles.max}
          onResize={size => props.onPanelResize("commitFiles", size)} class="min-h-0">
          <View class="border-b border-border bg-surface-muted px-3 py-1"><Text class="text-[11px] text-muted-foreground">{t("Changed files · {count}", { count: displayed()?.files.length ?? 0 })}</Text></View>
          <List testID="commit-file-list" each={displayed()?.files ?? []} keyExtractor={file => file.path} estimatedItemSize={28} class="min-h-0 flex-1"
            empty={pending() ? <View /> : <Text class="px-3 py-2 text-[11px] text-muted-foreground">{t("This commit has no file changes.")}</Text>}>
            {item => {
              const file = computed(item);
              const path = () => file().oldPath ? file().oldPath + " → " + file().path : file().path;
              const selected = () => {
                const current = diff();
                return current.kind !== "idle" && current.filePath === file().path;
              };
              return <View tooltip={<Hint text={path()} />} onContextMenu={event => {
                const value = file(); const commit = displayed(); const root = props.repositoryPath; const request = generation;
                void Menu.popup([
                  { label: t("Show diff for {path}", { path: value.path }), disabled: props.disabled || pending(), onSelect: () => { if (commit) void selectFile(value, commit, root, request); } },
                  { label: t("Copy file path"), onSelect: () => copyText(value.path) },
                  { label: t("Back to working changes"), disabled: props.disabled, onSelect: props.onBack },
                ], event.pagePosition);
              }}><Button testID={"commit-file:" + file().path} accessibilityLabel={t("Show diff for {path}", { path: file().path })}
                disabled={props.disabled || pending()} selected={selected()}
                onPress={() => { const commit = displayed(); if (commit) void selectFile(file(), commit, props.repositoryPath, generation); }}
                class="h-7 flex-row items-center gap-2 px-3 hover:bg-muted selected:bg-accent">
                <Text class="w-5 font-mono text-[10px] text-muted-foreground">{file().status}</Text>
                <Text numberOfLines={1} class="min-w-0 flex-1 text-[11px] text-foreground">{path()}</Text>
              </Button></View>;
            }}
          </List>
        </ResizablePanel>
        <ResizablePanel minSize={140} class="min-h-0"><DiffPane diff={diff()} title={title()} /></ResizablePanel>
      </ResizablePanelGroup>
    </View>
  </View>;
}

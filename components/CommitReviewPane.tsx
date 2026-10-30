import { Hint } from "./Hint";
import { cleanup, computed, effect, List, signal, Text, untracked, View } from "nsh";
import { Button, ResizablePanel, ResizablePanelGroup } from "nsh/base";
import { Menu } from "nsh/desktop";
import { Workspace, type CommitDetails, type CommitFile } from "difflens/native";
import { t } from "../i18n";
import { errorMessage } from "../diagnostics";
import { copyText } from "../context-menu";
import type { DiffState } from "../ui-types";
import { DiffPane } from "./DiffPane";
import { LoadingStatus } from "./LoadingStatus";
import { commitWorkflowMenu, type RequestWorkflow } from "../git-workflows";
import { panelGripClass, panelHandleClass, PANEL_LIMITS, type PanelSizes, type ResizePanel } from "../panel-layout";

type CommitState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; commit: CommitDetails };

export function CommitReviewPane(props: {
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
  const diff = signal<DiffState>({ kind: "idle" });
  let generation = 0;
  let diffRequest = 0;
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
    state.set({ kind: "loading" });
    diff.set({ kind: "idle" });
    try {
      const commit = await Workspace.inspectCommit(root, id);
      if (generation !== request) return;
      state.set({ kind: "ready", commit });
      const selected = commit.files.find((file) => file.path === props.initialFilePath) ?? commit.files[0];
      if (selected) await selectFile(selected, commit, root, request);
    } catch (cause) {
      if (generation !== request) return;
      state.set({ kind: "failed", message: errorMessage(cause) });
    }
  }

  effect(() => {
    const root = props.repositoryPath;
    const id = props.commitId;
    untracked(() => { void load(root, id); });
  });

  return <View testID="commit-review" class="min-h-0 flex-1">
    <View class="flex-row items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <Text class="min-w-0 flex-1 font-mono text-[11px] text-foreground">{t("Commit {id}", { id: props.commitId.slice(0, 8) })}</Text>
      <Button testID="back-to-wip" disabled={props.disabled} onPress={props.onBack} class="rounded px-2 py-1 hover:bg-muted">
        <Text class="text-[11px] text-foreground">{t("Back to working changes")}</Text>
      </Button>
    </View>
    {(() => {
      const current = state();
      if (current.kind === "loading") return <View class="flex-1 items-center justify-center"><LoadingStatus label={t("Loading commit…")} /></View>;
      if (current.kind === "failed") return <View class="flex-1 items-center justify-center gap-2 p-4">
        <Text class="text-[12px] text-destructive">{t("Could not read commit")}</Text>
        <Text class="text-[11px] text-muted-foreground">{current.message}</Text>
        <Button onPress={() => { void load(props.repositoryPath, props.commitId); }}><Text>{t("Retry")}</Text></Button>
      </View>;
      const commit = current.commit;
      const root = props.repositoryPath;
      const request = generation;
      return <>
        <View class="gap-1 border-b border-border py-2 pl-3 pr-[140px]" onContextMenu={(event) => {
          void Menu.popup([
            ...commitWorkflowMenu(commit.id, props.disabled, props.onWorkflow),
            { label: t("Copy commit ID"), onSelect: () => copyText(commit.id) },
            { label: t("Copy commit message"), onSelect: () => copyText(commit.message) },
          ], event.pagePosition);
        }}>
          <Text numberOfLines={3} class="text-[12px] font-semibold text-foreground">{commit.message}</Text>
          <Text class="text-[11px] text-muted-foreground">{commit.author + " · " + commit.authoredAt}</Text>
          <Text class="font-mono text-[10px] text-muted-foreground">{commit.id}</Text>
          <Text testID="commit-comparison" class="text-[11px] text-muted-foreground">{commit.parentIds[0]
            ? t("Compared with first parent {id}", { id: commit.parentIds[0].slice(0, 8) })
            : t("Initial commit · compared with empty tree")}</Text>
        </View>
        <ResizablePanelGroup axis="vertical" class="min-h-0 flex-1" handleClass={panelHandleClass()} handleThumbClass={panelGripClass()} handleAccessibilityLabel={t("Resize commit files and diff")}>
          <ResizablePanel fixed size={props.panelSizes.commitFiles} minSize={PANEL_LIMITS.commitFiles.min} maxSize={PANEL_LIMITS.commitFiles.max}
            onResize={(size) => props.onPanelResize("commitFiles", size)} class="min-h-0">
            <View class="border-b border-border bg-muted/30 px-3 py-1"><Text class="text-[11px] font-semibold text-foreground">{t("Changed files · {count}", { count: commit.files.length })}</Text></View>
            <List testID="commit-file-list" each={commit.files} keyExtractor={(file) => file.path} class="min-h-0 flex-1"
              initialScrollIndex={Math.max(0, commit.files.findIndex((file) => file.path === props.initialFilePath))}
              empty={<Text class="px-3 py-2 text-[11px] text-muted-foreground">{t("This commit has no file changes.")}</Text>}>
              {(item) => {
                const file = computed(item);
                const path = computed(() => {
                  const current = file();
                  return current.oldPath ? current.oldPath + " → " + current.path : current.path;
                });
                return <View tooltip={<Hint text={path()} />} onContextMenu={(event) => {
                  const current = file();
                  void Menu.popup([
                  { label: t("Show diff for {path}", { path: current.path }), onSelect: () => { void selectFile(current, commit, root, request); } },
                  { label: t("Copy file path"), onSelect: () => copyText(current.path) },
                  { label: t("Back to working changes"), disabled: props.disabled, onSelect: props.onBack },
                ], event.pagePosition); }}>
                  <Button testID={"commit-file:" + file().path} accessibilityLabel={t("Show diff for {path}", { path: file().path })}
                    selected={(() => { const current = diff(); return current.kind !== "idle" && current.filePath === file().path; })()}
                    onPress={() => { void selectFile(file(), commit, root, request); }}
                    class="h-7 flex-row items-center gap-2 rounded px-3 hover:bg-muted selected:bg-accent">
                    <Text class="w-8 font-mono text-[10px] text-muted-foreground">{file().status}</Text>
                    <Text numberOfLines={1} class="min-w-0 flex-1 font-mono text-[11px] text-foreground">{path()}</Text>
                  </Button>
                </View>;
              }}
            </List>
          </ResizablePanel>
          <ResizablePanel minSize={140} class="min-h-0"><DiffPane diff={diff()} title={t("Commit {id}", { id: commit.shortId }) + (() => { const current = diff(); return current.kind === "idle" ? "" : " · " + current.filePath; })()} /></ResizablePanel>
        </ResizablePanelGroup>
      </>;
    })()}
  </View>;
}

import { Hint } from "./Hint";
import { Menu as DesktopMenu } from "nsh/desktop";
import { copyText } from "../context-menu";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { accentClasses } from "../appearance";
import { panelGripClass, panelHandleClass, PANEL_LIMITS, type PanelSizes, type ResizePanel } from "../panel-layout";
import { FileBrowser } from "./FileBrowser";
import { computed, effect, List, signal, Text, untracked, View } from "nsh";
import { preferences } from "../preferences";
import { changedFileRows } from "../changed-file-tree";
import { Input, Button, Menu, MenuItem, MenuSeparator, ResizablePanel, ResizablePanelGroup } from "nsh/base";
import { LoadingStatus } from "./LoadingStatus";
import { workflowRequest, type RequestWorkflow } from "../git-workflows";
import { RetainedPane } from "./RetainedPane";
import { HistoryPane } from "./HistoryPane";
import type { HistoryNavigation } from "../repository-session";
import type {
  ChangedFile,
  GitOperationRequest,
  RepositoryDetails,
} from "difflens/native";
import type {
  ChangedFileRowProps,
  DetailState,
  DiffState,
  OperationState,
  RepositoryAction,
  RepositoryTab,
} from "../ui-types";

function ChangedFileRow(props: ChangedFileRowProps) {
  const actionLabel = computed(() =>
    props.section === "staged" ? t("Unstage") : t("Stage"),
  );
  const canChange = computed(
    () => props.file.actionable && !props.file.conflicted && !props.disabled,
  );
  const displayPath = computed(() => props.file.oldPath
    ? props.file.oldPath + " → " + props.file.path
    : props.file.path);
  const name = computed(() => props.file.path.slice(props.file.path.lastIndexOf("/") + 1));
  const directory = computed(() => {
    const separator = props.file.path.lastIndexOf("/");
    return separator < 0 ? "" : props.file.path.slice(0, separator);
  });

  return (
    <View class="flex-row items-center gap-1 px-2 py-0.5" onContextMenu={(event) => {
      void DesktopMenu.popup([
        { label: t("Show diff for {path}", { path: props.file.path }), disabled: props.disabled,
          onSelect: () => props.onSelect(props.file.path, props.section === "staged") },
        { label: actionLabel(), disabled: !canChange(), onSelect: () => props.onAction({ kind: props.section === "staged" ? "unstageFile" : "stageFile", filePath: props.file.path }) },
        { type: "separator" },
        { label: t("Copy file path"), onSelect: () => copyText(props.file.path) },
        ...(props.onOpenEditor ? [{ label: t("Open in editor"), disabled: props.disabled, onSelect: () => props.onOpenEditor?.(props.file.path) }] : []),
        ...(props.file.conflicted && props.onWorkflow ? [{ label: t("Mark resolved…"), disabled: props.disabled, onSelect: () => props.onWorkflow?.(workflowRequest("resolve", props.file.path)) }] : []),
      ], event.pagePosition);
    }}>
      <View class="min-w-0 flex-1" tooltip={<Hint text={displayPath()} />}>
      <Button
        selected={props.selected}
        disabled={props.disabled}
        accessibilityLabel={t("Show diff for {path}", { path: displayPath() })}
        onPress={() =>
          props.onSelect(props.file.path, props.section === "staged")
        }
        class="group h-7 min-w-0 justify-center px-1 text-left hover:bg-muted/60 active:bg-accent/60 selected:bg-accent"
      >
        <View class="flex-row items-center gap-1.5">
          <Icon name="file" size={14} muted />
          <Text numberOfLines={1} class={"min-w-0 flex-1 text-[12px] text-foreground" + (props.file.statusLabel.includes("D") ? " line-through" : "")}>{name()}</Text>
          {!props.tree && directory() ? <Text numberOfLines={1} class="min-w-0 max-w-20 text-[10px] text-muted-foreground">{directory()}</Text> : null}
          <Text class={"w-4 font-mono text-[10px] " + (props.file.conflicted || props.file.statusLabel.includes("D")
              ? "text-destructive" : props.file.untracked || props.file.statusLabel.includes("A") ? "text-success" : "text-status-modified")}>
            {props.file.statusLabel.trim()}
          </Text>
          {props.file.conflicted ? (
            <Text class="text-[11px] font-medium text-destructive">
              {t("Conflict")}
            </Text>
          ) : null}
        </View>
      </Button>
      </View>
      <IconButton
        icon={props.section === "staged" ? "minus" : "plus"}
        disabled={!canChange()}
        label={actionLabel() + " " + displayPath()}
        onPress={() => props.onAction({
          kind: props.section === "staged" ? "unstageFile" : "stageFile", filePath: props.file.path,
        })}
      />
    </View>
  );
}

function FileSection(props: {
  title: string;
  files: ChangedFile[];
  section: "staged" | "unstaged";
  selectedPath: string | undefined;
  selectedStaged: boolean;
  busy: boolean;
  onSelectFile: (path: string, staged: boolean) => void;
  onAction: (action: RepositoryAction) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onWorkflow: RequestWorkflow;
  onOpenEditor: (path: string) => void;
}) {
  const collapsed = signal<ReadonlySet<string>>(new Set());
  const rows = computed(() => changedFileRows(props.files, preferences().changeView, collapsed()));
  function toggleFolder(path: string) {
    const next = new Set(collapsed());
    if (next.has(path)) next.delete(path); else next.add(path);
    collapsed.set(next);
  }
  effect(() => {
    const selected = props.selectedPath;
    if (!selected || props.selectedStaged !== (props.section === "staged")) return;
    untracked(() => {
      const previous = collapsed();
      const next = new Set([...previous].filter(path => !selected.startsWith(path + "/")));
      if (next.size !== previous.size) collapsed.set(next);
    });
  });
  return (
    <View class="min-h-0 flex-1">
      <View class="flex-row items-center justify-between bg-surface-muted px-3 py-1.5">
        <Text class="text-[11px] font-semibold text-foreground">
          {props.title + " · " + String(props.files.length)}
        </Text>
        {props.onUnstageAll ? <Button disabled={props.busy || props.files.length === 0} onPress={props.onUnstageAll}
          class="h-6 justify-center rounded px-1.5 hover:bg-accent disabled:opacity-35"><Text class="text-[11px] text-muted-foreground">{t("Unstage all")}</Text></Button> : null}
        {props.onStageAll ? (
          <Button disabled={props.busy || props.files.length === 0} onPress={props.onStageAll}
            class="rounded px-1.5 py-0.5 hover:bg-accent active:bg-accent disabled:opacity-35">
            <Text class="text-[11px] text-muted-foreground">{t("Stage all")}</Text>
          </Button>
        ) : null}
      </View>
      <List testID={"changed-file-list-" + props.section} each={rows()}
        keyExtractor={row => row.key} estimatedItemSize={32} class="min-h-0 flex-1"
        initialScrollIndex={Math.max(0, rows().findIndex(row => row.kind === "file" && row.file.path === props.selectedPath && props.selectedStaged === (props.section === "staged")))}
        empty={<Text class="px-3 py-2 text-[11px] text-muted-foreground">{t("No files")}</Text>}>
        {(item) => {
          const folder = computed(() => { const row = item(); return row.kind === "folder" ? row : null; });
          const file = computed(() => { const row = item(); return row.kind === "file" ? row.file : null; });
          return <View class="h-8" style={{ paddingLeft: item().depth * 12 }}>
            {folder() ? <Button
              accessibilityLabel={t("Toggle folder {path}", { path: folder()!.path }) + " · " + t(props.section === "staged" ? "Staged" : "Unstaged")}
              onPress={() => { const current = folder(); if (current) toggleFolder(current.path); }}
              class="h-8 flex-row items-center gap-1.5 px-2 hover:bg-muted/60">
              <Icon name={folder()!.expanded ? "chevronDown" : "chevronRight"} size={11} muted />
              <Icon name="folder" size={14} muted />
              <Text numberOfLines={1} class="min-w-0 flex-1 text-[12px] text-foreground">{folder()!.label}</Text>
              <Text class="pr-1 text-[10px] text-muted-foreground">{folder()!.count}</Text>
            </Button> : file() ? <ChangedFileRow file={file()!} section={props.section} tree={preferences().changeView === "tree"}
              selected={props.selectedPath === file()!.path && props.selectedStaged === (props.section === "staged")}
              disabled={props.busy} onSelect={props.onSelectFile} onAction={props.onAction}
              onWorkflow={props.onWorkflow} onOpenEditor={props.onOpenEditor} /> : null}
          </View>;
        }}
      </List>
    </View>
  );
}

function RepositoryChanges(props: {
  onWorkflow: (request: GitOperationRequest, root: string) => void;
  onOpenEditor: (path: string, root: string) => void;
  revision: number;
  panelSizes: PanelSizes;
  onPanelResize: ResizePanel;
  disabled: boolean;
  details: RepositoryDetails;
  operation: OperationState;
  diff: DiffState;
  branchName: string;
  onBranchNameChange: (value: string) => void;
  onSelectFile: (path: string, staged: boolean) => void;
  onPreviewFile: (path: string) => void;
  previewedFile: string | null;
  tab: RepositoryTab;
  onTabChange: (tab: RepositoryTab) => void;
  selectedCommitId: string | null;
  onSelectCommit: (id: string, repositoryPath: string) => void;
  initialHistory: HistoryNavigation;
  onHistoryNavigation: (value: HistoryNavigation, repositoryPath: string) => void;
  onClearCommitSelection: (repositoryPath: string) => void;
  onAction: (action: RepositoryAction, repositoryPath: string) => void;
}) {
  const repositoryPath = props.details.path;
  const onAction = (action: RepositoryAction) => props.onAction(action, repositoryPath);
  const onWorkflow: RequestWorkflow = (request) => props.onWorkflow(request, repositoryPath);
  const onOpenEditor = (path: string) => props.onOpenEditor(path, repositoryPath);
  const activeTab = () => props.tab;
  const busy = computed(
    () => props.disabled || props.operation.kind === "running",
  );
  const selectedFile = computed(() => {
    if (props.diff.kind === "idle") {
      return undefined;
    }
    return { path: props.diff.filePath, staged: props.diff.staged };
  });
  const stagedFiles = computed(() =>
    props.details.changes.filter((file) => file.staged),
  );
  const unstagedFiles = computed(() =>
    props.details.changes.filter((file) => file.unstaged || file.untracked),
  );

  return (
    <View class="min-h-0 flex-1 flex-col">
      <View class="hidden">
        <View class="flex-row items-center gap-1.5">
          <Menu
            offset={4}
            margin={8}
            popupClass="min-w-52 gap-1 rounded-md border border-border bg-popover p-1"
            trigger={
              <View
                disabled={busy()}
                role="button"
                focusable
                accessibilityLabel={t("Choose local branch")}
                class="flex-row items-center gap-1.5 rounded bg-accent/60 px-2 py-1 hover:bg-accent active:bg-accent disabled:opacity-35"
              >
                <Icon name="worktree" size={13} muted />
                <Text class="font-mono text-[11px] text-foreground">
                  {(props.details.branchName ?? props.details.headLabel) + " ▾"}
                </Text>
              </View>
            }
          >
            {props.details.branches.length === 0 ? (
              <MenuItem disabled>
                <Text class="text-[12px] text-muted-foreground">
                  {t("No local branches")}
                </Text>
              </MenuItem>
            ) : (
              props.details.branches.map((branch) => (
                <MenuItem
                  class="rounded px-2 py-1 active:bg-accent"
                  disabled={busy() || branch === props.details.branchName}
                  onSelect={() =>
                    onAction({ kind: "switchBranch", branchName: branch })
                  }
                >
                  <Text class="text-[12px] text-foreground">
                    {(branch === props.details.branchName ? "✓  " : "") +
                      branch}
                  </Text>
                </MenuItem>
              ))
            )}
            <MenuSeparator class="my-1 h-px bg-border" />
            <MenuItem disabled>
              <Text class="text-[11px] text-muted-foreground">
                {props.details.hasUpstream
                  ? props.details.upstream
                  : t("No upstream branch")}
              </Text>
            </MenuItem>
          </Menu>
          <Text class="min-w-0 flex-1 text-[11px] text-muted-foreground">
            {props.details.ahead > 0 || props.details.behind > 0
              ? "↑ " +
                String(props.details.ahead) +
                "  ↓ " +
                String(props.details.behind)
              : props.details.hasUpstream
                ? t("Up to date")
                : t("No upstream")}
          </Text>
        </View>

        <View class="flex-row gap-1">
          <View class="min-w-0 flex-1 flex-row items-center gap-1">
            <Input
              value={props.branchName}
              onChange={props.onBranchNameChange}
              disabled={busy()}
              placeholder={t("New branch")}
              accessibilityLabel={t("New branch name")}
              class={"h-7 min-w-0 flex-1 rounded border border-transparent bg-subtle-input px-2 text-[11px] text-foreground focus:bg-background " + accentClasses().focus}
            />
            <Button
              disabled={busy() || props.branchName.trim().length === 0}
              onPress={() =>
                onAction({
                  kind: "createBranch",
                  branchName: props.branchName.trim(),
                })
              }
              class="rounded px-2 py-1 hover:bg-accent active:bg-accent disabled:opacity-35"
            >
              <Text class="text-[11px] text-muted-foreground">
                {t("New")}
              </Text>
            </Button>
          </View>
        </View>
      </View>

      <RetainedPane active={activeTab() === "files"}>
        <FileBrowser onOpenEditor={onOpenEditor} revision={props.revision} repository={props.details} selectedPath={props.previewedFile} disabled={busy()} onPreview={props.onPreviewFile} />
      </RetainedPane>
      <RetainedPane active={activeTab() === "history"}>
        <HistoryPane onWorkflow={onWorkflow} active={activeTab() === "history"} revision={props.revision} repositoryPath={props.details.path} branch={props.details.branchName ?? "detached"}
          initialHistory={props.initialHistory} selectedId={props.selectedCommitId} disabled={busy()}
          changedCount={props.details.changes.length} onSelect={(id) => props.onSelectCommit(id, repositoryPath)}
          onClearSelection={() => props.onClearCommitSelection(repositoryPath)} onNavigation={(value) => props.onHistoryNavigation(value, repositoryPath)}
          onWorkingChanges={() => props.onTabChange("changes")} />
      </RetainedPane>
      <RetainedPane active={activeTab() === "changes"}>
        <ResizablePanelGroup axis="vertical" class="min-h-0 flex-1" handleClass={panelHandleClass()} handleThumbClass={panelGripClass()}
          handleAccessibilityLabel={t("Resize staged and unstaged files")}>
          <ResizablePanel minSize={80} class="min-h-0">
            <FileSection title={t("Unstaged")} files={unstagedFiles()} section="unstaged"
              selectedPath={selectedFile()?.path} selectedStaged={selectedFile()?.staged ?? false}
              busy={busy()} onSelectFile={props.onSelectFile} onAction={onAction}
              onWorkflow={onWorkflow} onOpenEditor={onOpenEditor}
              onStageAll={() => onAction({ kind: "stageAll" })} />
          </ResizablePanel>
          <ResizablePanel fixed size={props.panelSizes.staged} minSize={PANEL_LIMITS.staged.min} maxSize={PANEL_LIMITS.staged.max}
            onResize={(size) => props.onPanelResize("staged", size)} class="min-h-0">
            <FileSection title={t("Staged")} files={stagedFiles()} section="staged"
              selectedPath={selectedFile()?.path} selectedStaged={selectedFile()?.staged ?? false}
              busy={busy()} onSelectFile={props.onSelectFile} onAction={onAction}
              onWorkflow={onWorkflow} onOpenEditor={onOpenEditor}
              onUnstageAll={() => onWorkflow(workflowRequest("unstageAll"))} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </RetainedPane>
    </View>
  );
}

export function ChangesPane(props: {
  onWorkflow: (request: GitOperationRequest, root: string) => void;
  onOpenEditor: (path: string, root: string) => void;
  revision: number;
  panelSizes: PanelSizes;
  onPanelResize: ResizePanel;
  disabled: boolean;
  details: DetailState;
  operation: OperationState;
  diff: DiffState;
  branchName: string;
  onBranchNameChange: (value: string) => void;
  onSelectFile: (path: string, staged: boolean) => void;
  onPreviewFile: (path: string) => void;
  previewedFile: string | null;
  tab: RepositoryTab;
  onTabChange: (tab: RepositoryTab) => void;
  selectedCommitId: string | null;
  onSelectCommit: (id: string, repositoryPath: string) => void;
  initialHistory: HistoryNavigation;
  onHistoryNavigation: (value: HistoryNavigation, repositoryPath: string) => void;
  onClearCommitSelection: (repositoryPath: string) => void;
  onAction: (action: RepositoryAction, repositoryPath: string) => void;
}) {
  const content = computed(() => {
    if (props.details.kind === "loading") {
      return (
        <EmptyPanel
          loading
          title={t("Reading repository")}
          message={t("Loading status, branches, and history.")}
        />
      );
    }
    if (props.details.kind === "failed") {
      return (
        <EmptyPanel
          title={t("Could not read repository")}
          message={props.details.message}
        />
      );
    }
    if (props.details.kind === "idle") {
      return (
        <EmptyPanel
          title={t("Select a repository")}
          message={t("Choose a repository to see its changes.")}
        />
      );
    }
    return (
      <RepositoryChanges onWorkflow={props.onWorkflow} onOpenEditor={props.onOpenEditor} revision={props.revision}
        panelSizes={props.panelSizes} onPanelResize={props.onPanelResize}
        disabled={props.disabled}
        details={props.details.details}
        operation={props.operation}
        diff={props.diff}
        branchName={props.branchName}
        onBranchNameChange={props.onBranchNameChange}
        onSelectFile={props.onSelectFile}
        onPreviewFile={props.onPreviewFile}
        previewedFile={props.previewedFile}
        tab={props.tab}
        onTabChange={props.onTabChange}
        selectedCommitId={props.selectedCommitId}
        onSelectCommit={props.onSelectCommit}
        initialHistory={props.initialHistory}
        onHistoryNavigation={props.onHistoryNavigation}
        onClearCommitSelection={props.onClearCommitSelection}
        onAction={props.onAction}
      />
    );
  });

  return (
    <View class="min-h-0 flex-1 flex-col bg-surface-muted">
      {content()}
    </View>
  );
}

function EmptyPanel(props: {
  title: string;
  message: string;
  loading?: boolean;
}) {
  return (
    <View class="flex-1 items-center justify-center gap-1.5 p-4">
      {props.loading ? (
        <LoadingStatus label={props.title} />
      ) : (
        <Text class="text-[12px] font-medium text-foreground">
          {props.title}
        </Text>
      )}
      <Text class="max-w-72 text-center text-[11px] text-muted-foreground">
        {props.message}
      </Text>
    </View>
  );
}

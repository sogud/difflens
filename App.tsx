import { createDiffCache, createReadCache } from "./diff-cache";
import { ReviewHeader, type ReviewFocus } from "./components/ReviewHeader";
import { currentUiActivity, watchUiActivity, watchUiPresentation } from "./ui-activity";
import { Hint } from "./components/Hint";
import { closeWorkingEditors, openWorkingEditor, workingFileKey, type CloseWorkingEditors, type OpenWorkingEditors } from "./working-editor-tabs";
import { ReviewFileRibbon, type ReviewFileEntry } from "./components/ReviewFileRibbon";
import { GitOperationBanner } from "./components/GitOperationBanner";
import type { PushFeedback } from "./git-sync";
import { IconButton } from "./components/IconButton";
import { Icon } from "./components/Icon";
import { preferences, updatePreferences } from "./preferences";
import { accentClasses, applyAppearance, appearanceThemeProps } from "./appearance";
import { createPanelLayout, panelGripClass, panelHandleClass, PANEL_LIMITS } from "./panel-layout";
import { restoreLanguage, t, type Message } from "./i18n";
import { cleanup, computed, effect, ErrorBoundary, mount, signal, Storage, Text, untracked, View, setAccessibilityFocus, type YNode } from "nsh";
import { installUpdate, markUpdateHealthy, startUpdateController, stopUpdateController, updateStatus } from "./update-controller";
import { loadDiagnostics } from "./diagnostics";
import { FailurePane } from "./components/FailurePane";
import { FilePreviewPane } from "./components/FilePreviewPane";
import { Menu as DesktopMenu, titleBar, Window } from "nsh/desktop";
import { Button, ResizablePanel, ResizablePanelGroup } from "nsh/base";
import {
  Workspace,
  type RepositoryDetails,
  type FilePreview,
  type RepositoryNode,
  type WorkspaceScan,
  type ScanProgress,
  type GitContext, type GitOperationRequest, type GitOperationPlan, type GitOperationOutcome,
} from "difflens/native";
import { RepositorySetupDialog } from "./components/RepositorySetupDialog";
import { GitPane } from "./components/GitPane";
import { QuickSwitcher, type SwitcherItem } from "./components/QuickSwitcher";
import { workflowPresentation, workflowRequest, workflowTitles, type WorkflowKind } from "./git-workflows";
import { RetainedPane } from "./components/RetainedPane";
import { CommitReviewPane } from "./components/CommitReviewPane";
import { DirectoryChangesPane } from "./components/DirectoryChangesPane";
import { ChangesPane } from "./components/ChangesPane";
import { DiffPane } from "./components/DiffPane";
import { RepositoryPane } from "./components/RepositoryPane";
import { AddSourceDialog } from "./components/AddSourceDialog";
import { WelcomePane } from "./components/WelcomePane";
import { SettingsDialog } from "./components/SettingsDialog";
import { LoadingStatus } from "./components/LoadingStatus";
import {
  folderName,
  LIBRARY_STORAGE_KEY,
  readLibrary,
  sourceKey,
  type LibrarySource,
  type SourceKind,
} from "./library";
import {
  freshHistory, freshSession, readRepositorySessions, rememberSession,
  serializeRepositorySessions, SESSION_STORAGE_KEY,
  type HistoryNavigation, type RepositorySessions, type WorkingSelection,
} from "./repository-session";
import type {
  DetailState,
  DiffState,
  DisplayMode,
  OperationState,
  ReviewView,
  FilePreviewState,
  RepositoryTab,
  RepositoryAction,
} from "./ui-types";

type Auxiliary = "none" | "repositories" | "files" | "git";
type ReviewPresentation =
  | { kind: "review"; auxiliary: Auxiliary }
  | { kind: "focus"; restore: Auxiliary };

type ScanState =
  | { kind: "idle" }
  | { kind: "ready"; result: WorkspaceScan; selectedPath: string | null };

type BackgroundScan =
  | { kind: "idle" }
  | { kind: "running"; found: number; visited: number; discovering: boolean };

type ImportForm = { kind: SourceKind; path: string; error: string | null };
type SourceLoad =
  | { kind: "idle" }
  | { kind: "opening" | "scanning" | "details"; path: string };

function flattenRepositories(repositories: RepositoryNode[]): RepositoryNode[] {
  const result: RepositoryNode[] = [];
  for (const repository of repositories) {
    result.push(repository);
    result.push(...flattenRepositories(repository.children));
  }
  return result;
}

function updateRepositorySummary(
  repositories: RepositoryNode[],
  repositoryPath: string,
  details: RepositoryDetails,
): RepositoryNode[] {
  const updated: RepositoryNode[] = [];
  for (const repository of repositories) {
    if (repository.path === repositoryPath) {
      updated.push({
        ...repository,
        headLabel: details.headLabel,
        cached: false,
        changedFiles: details.changes.length,
        stagedFiles: details.changes.filter((file) => file.staged).length,
        unstagedFiles: details.changes.filter(
          (file) => file.unstaged || file.untracked,
        ).length,
        untrackedFiles: details.changes.filter((file) => file.untracked).length,
        hasUpstream: details.hasUpstream,
        ahead: details.ahead,
        behind: details.behind,
      });
      continue;
    }

    updated.push({
      ...repository,
      children: updateRepositorySummary(
        repository.children,
        repositoryPath,
        details,
      ),
    });
  }
  return updated;
}

function actionLabel(action: RepositoryAction): Message {
  switch (action.kind) {
    case "stageFile":
      return "Staging file";
    case "unstageFile":
      return "Unstaging file";
    case "stageAll":
      return "Staging changes";
    case "commit":
      return "Creating commit";
    case "createBranch":
      return "Creating branch";
    case "switchBranch":
      return "Switching branch";
    case "fetch":
      return "Fetching from remotes";
    case "pull":
      return "Pulling changes";
    case "push":
      return "Pushing changes";
  }
}

function actionSuccess(action: RepositoryAction): Message {
  switch (action.kind) {
    case "stageFile":
      return "File staged.";
    case "unstageFile":
      return "File unstaged.";
    case "stageAll":
      return "Changes staged.";
    case "commit":
      return "Committed locally.";
    case "createBranch":
      return "Branch created and checked out.";
    case "switchBranch":
      return "Branch switched.";
    case "fetch":
      return "Remote status updated.";
    case "pull":
      return "Upstream changes pulled.";
    case "push":
      return "Branch pushed.";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  applyAppearance();
  const sources = signal<LibrarySource[]>([]);
  const activeKey = signal<string | null>(null);
  const libraryReady = signal(false);
  const sourceLoad = signal<SourceLoad>({ kind: "idle" });
  const backgroundScan = signal<BackgroundScan>({ kind: "idle" });
  const scanNotice = signal<Message | null>(null);
  const inventoryComplete = signal(false);
  let activeScan: number | null = null;
  let disposed = false;
  let rootLaidOut = false;
  let restorationFinished = false;
  let startupAcknowledged = false;
  cleanup(() => {
    disposed = true;
    stopUpdateController();
    if (activeScan !== null) Workspace.stopScan(activeScan);
  });
  function acknowledgeStartup() {
    if (startupAcknowledged || !rootLaidOut || !restorationFinished) return;
    startupAcknowledged = true;
    markUpdateHealthy();
  }
  const loading = computed(() => sourceLoad().kind !== "idle");
  const picking = signal(false);
  const sourceError = signal<string | null>(null);
  const storageError = signal<string | null>(null);
  const importForm = signal<ImportForm | null>(null);
  const settingsOpen = signal(false);
  const settingsSection = signal<"updates" | null>(null);
  function openSettings() {
    settingsSection.set(null);
    settingsOpen.set(true);
  }
  function openUpdateSettings() {
    settingsSection.set("updates");
    settingsOpen.set(true);
  }
  const pickerOpen = signal<"repository" | null>(null);
  const setupClone = signal<boolean | null>(null);
  const workflowForm = signal<{ root: string; request: GitOperationRequest } | null>(null);
  const gitContextState = signal<{ root: string; value: GitContext } | null>(null);
  const contextLoading = signal(false);
  const workflowPreparation = signal<{ root: string; label: Message } | null>(null);
  let contextRequest = 0;
  cleanup(() => { contextRequest += 1; });
  const settingsError = signal<string | null>(null);
  const scanState = signal<ScanState>({ kind: "idle" });
  const detailState = signal<DetailState>({ kind: "idle" });
  const diffState = signal<DiffState>({ kind: "idle" });
  const reviewView = signal<ReviewView>({ kind: "diff" });
  const previewCache = signal<{ repositoryPath: string; state: FilePreviewState } | null>(null);
  const diffCache = createDiffCache();
  const fileContentCache = createReadCache<FilePreview>(file => file.content.length * 2, 4);
  function invalidateReadCaches() { diffCache.clear(); fileContentCache.clear(); }
  const repositoryRevision = signal(0);
  const repositoryTab = signal<RepositoryTab>("changes");
  const directoryChanges = signal(false);
  const directoryOpening = signal(false);
  const directoryRefresh = signal(0);
  let directoryFileRequest = 0;
  effect(() => {
    void activeKey();
    untracked(() => { directoryChanges.set(false); directoryOpening.set(false); directoryFileRequest += 1; });
  });
  const directoryChangesVisible = computed(() => directoryChanges() && repositoryTab() === "changes");
  const canvasSize = signal({ width: 1200, height: 700 });
  const presentation = signal<ReviewPresentation>({ kind: "review", auxiliary: "files" });
  const repositoryNavigationVisible = computed(() => { const state = presentation(); return state.kind === "review" && state.auxiliary === "repositories"; });
  const fileNavigationVisible = computed(() => { const state = presentation(); return state.kind === "review" && state.auxiliary === "files"; });
  const gitNavigationVisible = computed(() => { const state = presentation(); return state.kind === "review" && state.auxiliary === "git"; });
  let repositoryOpener: YNode | undefined;
  let fileOpener: YNode | undefined;
  let gitOpener: YNode | undefined;
  let composerInput: { node: YNode; root: string } | null = null;
  let pendingCommitFocus: string | null = null;
  const focusOpeners = new Map<RepositoryTab, YNode>();
  function reviewFocus(tab: RepositoryTab): ReviewFocus {
    return {
      active: () => presentation().kind === "focus",
      toggle: toggleFocus,
      register: node => {
        focusOpeners.set(tab, node);
        return () => { if (focusOpeners.get(tab) === node) focusOpeners.delete(tab); };
      },
    };
  }
  function toggleNavigation(auxiliary: Exclude<Auxiliary, "none">) {
    const state = presentation();
    const closing = state.kind === "review" && state.auxiliary === auxiliary;
    presentation.set({ kind: "review", auxiliary: closing ? "none" : auxiliary });
    if (closing) {
      const opener = auxiliary === "repositories" ? repositoryOpener : auxiliary === "git" ? gitOpener : fileOpener;
      if (opener) setAccessibilityFocus(opener);
    }
  }
  function toggleFocus() {
    const state = presentation();
    presentation.set(state.kind === "focus" ? { kind: "review", auxiliary: state.restore }
      : { kind: "focus", restore: state.auxiliary });
    const opener = focusOpeners.get(repositoryTab()) ?? repositoryOpener;
    if (opener) setAccessibilityFocus(opener);
  }
  function showCommitComposer() {
    const root = selectedPath();
    if (!root || isOperating() || isScanning()) return;
    pendingCommitFocus = root;
    directoryChanges.set(false);
    changeRepositoryTab("changes");
    presentation.set({ kind: "review", auxiliary: "files" });
    if (composerInput?.root === root) { composerInput.node.focus(); pendingCommitFocus = null; }
  }
  function registerComposer(node: YNode, root: string) {
    composerInput = { node, root };
    if (pendingCommitFocus === root && selectedPath() === root) { node.focus(); pendingCommitFocus = null; }
  }
  function openTask(tab: RepositoryTab) {
    if (!hasRepositories() || isScanning() || isOperating() || directoryOpening()) return;
    const sameTask = repositoryTab() === tab;
    const state = presentation();
    changeRepositoryTab(tab);
    presentation.set({
      kind: "review",
      auxiliary: sameTask && state.kind === "review" && state.auxiliary === "files" ? "none" : "files",
    });
  }
  const workingSelection = signal<WorkingSelection | null>(null);
  const openedWorkingEditors = signal<OpenWorkingEditors>({ kind: "fresh" });
  const lastPreviewPath = signal<string | null>(null);
  const selectedHistoryCommit = signal<string | null>(null);
  const selectedHistoryFile = signal<string | null>(null);
  const historyRestore = signal<HistoryNavigation>(freshHistory());
  const sessionError = signal<string | null>(null);
  let repositorySessions: RepositorySessions = {};
  const repositoryCatalog = new Map<string, SwitcherItem[]>();
  let sessionPersistenceEnabled = true;
  let sessionWrites: Promise<void> = Promise.resolve();
  let libraryWrites: Promise<void> = Promise.resolve();
  let fileRequest = 0;
  const previewedFile = computed(() => repositoryTab() === "files" ? lastPreviewPath() : null);
  const previewState = () => {
    const cached = previewCache();
    return cached?.repositoryPath === selectedPath() ? cached.state : null;
  };
  const associatedWorktrees = computed(() => {
    const state = detailState();
    return state.kind === "ready" ? state.details.worktrees : [];
  });
  const operationState = signal<OperationState>({ kind: "idle" });
  const pushFeedback = signal<PushFeedback>({ kind: "idle" });
  const displayMode = signal<DisplayMode>("nested");
  const commitMessage = signal("");
  const branchName = signal("");
  const layoutError = signal<string | null>(null);
  const panelLayout = createPanelLayout((message) => layoutError.set(message));
  const scanRequest = signal(0);
  const detailRequest = signal(0);
  const diffRequest = signal(0);
  const operationRequest = signal(0);
  const gitContext = () => { const state = gitContextState(); return state?.root === selectedPath() ? state.value : null; };

  const isScanning = computed(() => loading() || picking() || !libraryReady());
  const updateInstallRequested = signal(false);
  const isOperating = computed(() => updateInstallRequested() || operationState().kind === "running" || workflowPreparation() !== null);
  const loadingMessage = computed(() => {
    if (!libraryReady()) return t("Restoring your library…");
    if (picking()) return t("Choosing folder…");
    switch (sourceLoad().kind) {
      case "opening":
        return t("Opening repository…");
      case "scanning":
        return t("Scanning nested repositories…");
      case "details":
        return t("Reading repository details…");
      case "idle":
        return t("Ready");
    }
  });
  const loadingPath = computed(() => {
    const current = sourceLoad();
    return current.kind === "idle" ? undefined : current.path;
  });
  watchUiActivity(() => {
    const operation = operationState();
    if (operation.kind === "running") return { kind: "operation", label: t(operation.label) + "…" };
    const preparing = workflowPreparation();
    if (preparing) return { kind: "operation", label: t(preparing.label), detail: preparing.root };
    if (!libraryReady() || picking() || loading()) return {
      kind: "source", label: loadingMessage(), detail: loadingPath(),
      cancel: backgroundScan().kind === "running" ? stopBackgroundScan : undefined,
    };
    if (detailState().kind === "loading" || (gitNavigationVisible() && contextLoading())) return { kind: "repository", label: t("Reading repository") };
    const scan = backgroundScan();
    return scan.kind === "running" ? {
      kind: "scan", label: t(scan.discovering ? "Scanning in background · {count} repositories" : "Refreshing cached repositories · {count} repositories", { count: scan.found }),
      cancel: stopBackgroundScan,
    } : null;
  });
  watchUiPresentation();
  const uiActivity = computed(currentUiActivity);
  const updateNotification = computed(() => {
    const status = updateStatus();
    return status.phase === "recovered" || (status.supported && (status.phase === "available" || status.phase === "ready")) ? status : null;
  });
  const activeSource = computed(() =>
    sources().find((source) => sourceKey(source) === activeKey()),
  );
  const repositories = computed(() => {
    const current = scanState();
    return current.kind === "ready" ? current.result.repositories : [];
  });
  const warnings = computed(() => {
    const current = scanState();
    return current.kind === "ready" ? current.result.warnings.length : 0;
  });
  const selectedPath = computed(() => {
    const current = scanState();
    return current.kind === "ready" ? current.selectedPath : null;
  });
  effect(() => { void selectedPath(); void repositoryRevision(); invalidateReadCaches(); });
  const currentDetails = computed(() => {
    const state = detailState();
    return state.kind === "ready" && state.details.path === selectedPath() ? state.details : null;
  });
  async function toggleChangesScope() {
    if (isScanning() || isOperating() || directoryOpening()) return;
    if (directoryChanges()) { directoryChanges.set(false); return; }
    const source = activeSource();
    if (!source) return;
    if (source.kind === "repository" || (!inventoryComplete() && backgroundScan().kind !== "running")) {
      const error = await loadSource({ kind: "directory", path: source.path, selectedPath: selectedPath() }, true);
      if (error) return;
    }
    changeRepositoryTab("changes");
    directoryChanges.set(true);
    presentation.set({ kind: "review", auxiliary: "files" });
  }
  async function openDirectoryFile(root: string, path: string, staged: boolean) {
    if (isScanning() || isOperating() || directoryOpening() || !flattenRepositories(repositories()).some(node => node.path === root)) return;
    const request = ++directoryFileRequest;
    const source = activeKey();
    directoryOpening.set(true);
    try {
      await selectRepository(root);
      if (request !== directoryFileRequest || activeKey() !== source || selectedPath() !== root) return;
      changeRepositoryTab("changes");
      await selectFileDiff(path, staged);
    } finally { if (request === directoryFileRequest) directoryOpening.set(false); }
  }
  async function openDirectoryRepository(root: string) {
    if (isScanning() || isOperating() || directoryOpening() || !flattenRepositories(repositories()).some(node => node.path === root)) return;
    const source = activeKey();
    const request = ++directoryFileRequest;
    directoryOpening.set(true);
    try {
      await selectRepository(root);
      if (request !== directoryFileRequest || activeKey() !== source || selectedPath() !== root) return;
      changeRepositoryTab("changes"); directoryChanges.set(false);
    } finally { if (request === directoryFileRequest) directoryOpening.set(false); }
  }
  const availableRibbonEntries = computed<ReviewFileEntry[]>(() => {
    const files = currentDetails()?.changes ?? [];
    return [false, true].flatMap(staged => files.filter(file => staged ? file.staged : file.unstaged || file.untracked)
      .map(file => ({ key: (staged ? "staged:" : "unstaged:") + file.path, path: file.path,
        oldPath: file.oldPath ?? null, staged, statusLabel: file.statusLabel, conflicted: file.conflicted })));
  });
  const ribbonEntries = computed<ReviewFileEntry[]>(() => {
    const state = openedWorkingEditors();
    if (state.kind === "fresh") return [];
    const available = new Map(availableRibbonEntries().map(entry => [entry.key, entry]));
    return state.files.flatMap(file => { const entry = available.get(workingFileKey(file)); return entry ? [entry] : []; });
  });
  effect(() => {
    const details = currentDetails();
    if (!details) return;
    untracked(() => {
      const state = openedWorkingEditors();
      if (state.kind === "fresh") return;
      const available = new Set(availableRibbonEntries().map(entry => entry.key));
      const files = state.files.filter(file => available.has(workingFileKey(file)));
      if (files.length === state.files.length) return;
      openedWorkingEditors.set({ kind: "ready", files });
      const selected = workingSelection();
      if (selected && !files.some(file => workingFileKey(file) === workingFileKey(selected))) {
        diffRequest.set(diffRequest() + 1);
        diffState.set({ kind: "idle" });
        workingSelection.set(null);
      }
      rememberCurrentSession();
    });
  });
  const ribbonSelection = computed<WorkingSelection | null>(() => {
    const diff = diffState();
    return currentDetails() && diff.kind !== "idle" ? { path: diff.filePath, staged: diff.staged } : null;
  });
  function closeWorkingTabs(target: WorkingSelection, mode: CloseWorkingEditors, expectedRoot: string) {
    if (selectedPath() !== expectedRoot || isScanning() || isOperating()) return;
    const state = openedWorkingEditors();
    if (state.kind !== "ready") return;
    const active = ribbonSelection() ?? workingSelection();
    const result = closeWorkingEditors(state.files, target, mode, active);
    if (!result.changed) return;
    openedWorkingEditors.set({ kind: "ready", files: result.files });
    if (result.files.length === 0) diffCache.clear();
    const changedSelection = (active ? workingFileKey(active) : null) !== (result.selection ? workingFileKey(result.selection) : null);
    if (changedSelection) {
      diffRequest.set(diffRequest() + 1);
      diffState.set({ kind: "idle" });
      workingSelection.set(result.selection);
      if (repositoryTab() === "changes") {
        reviewView.set({ kind: "diff" });
        if (result.selection) void selectFileDiff(result.selection.path, result.selection.staged);
      }
    }
    rememberCurrentSession();
  }
  effect(() => {
    const root = selectedPath();
    const branch = currentDetails()?.branchName;
    untracked(() => {
      const feedback = pushFeedback();
      if (feedback.kind !== "idle" && (feedback.root !== root || feedback.branch !== branch)) pushFeedback.set({ kind: "idle" });
    });
  });
  const stagedFileCount = computed(() => currentDetails()?.changes.filter(file => file.staged).length ?? 0);
  const canCommit = computed(() => !isScanning() && !isOperating() && stagedFileCount() > 0 && commitMessage().trim().length > 0);
  function commit(expectedRoot = selectedPath()) {
    const root = selectedPath();
    if (root && root === expectedRoot && canCommit()) void performRepositoryAction({ kind: "commit", message: commitMessage().trim() }, root);
  }
  async function installPendingUpdate(): Promise<string | null> {
    if (isOperating() || isScanning() || backgroundScan().kind === "running") {
      return t("Finish the current Git operation or scan before installing the update.");
    }
    updateInstallRequested.set(true);
    try {
      rememberCurrentSession();
      await sessionWrites;
      if (sessionError() || !sessionPersistenceEnabled) throw new Error(sessionError() ?? "Reading state could not be saved.");
      await saveLibrary();
      if (storageError()) throw new Error(storageError()!);
      await updatePreferences({});
      await installUpdate();
      Window.close();
      return null;
    } catch (cause) {
      updateInstallRequested.set(false);
      return t("Could not install the update: {error}", { error: getErrorMessage(cause) });
    }
  }
  const counts = computed(() => {
    const current = scanState();
    if (current.kind !== "ready") {
      return undefined;
    }

    const all = flattenRepositories(current.result.repositories);
    return {
      total: all.length,
      changed: all.filter((repository) => repository.changedFiles > 0).length,
      nested: all.length - current.result.repositories.length,
    };
  });

  effect(() => {
    const key = activeKey();
    const nodes = flattenRepositories(repositories());
    if (key) untracked(() => repositoryCatalog.set(key, nodes.map(node => ({ key: node.path, label: node.name, detail: node.path }))));
  });
  function repositoryChoices(): SwitcherItem[] {
    const validSources = new Set(sources().map(sourceKey));
    const choices = new Map<string, SwitcherItem>();
    for (const [key, items] of repositoryCatalog) if (validSources.has(key)) for (const item of items) choices.set(item.key, item);
    for (const node of flattenRepositories(repositories())) choices.set(node.path, { key: node.path, label: node.name, detail: node.path });
    const recent = Object.keys(repositorySessions).sort((left, right) => repositorySessions[right].updatedAt - repositorySessions[left].updatedAt);
    for (const source of sources()) if (source.kind === "repository") choices.set(source.path, { key: source.path, label: folderName(source.path), detail: source.path });
    for (const path of recent) if (!choices.has(path)) choices.set(path, { key: path, label: folderName(path), detail: path });
    const worktrees = associatedWorktrees().filter(worktree => worktree.available);
    for (const worktree of worktrees) choices.set(worktree.path, { key: worktree.path, label: folderName(worktree.path), detail: worktree.path });
    const main = worktrees.find(worktree => worktree.isMain);
    const knownWorktrees = new Set(worktrees.map(worktree => worktree.path));
    for (const item of choices.values()) {
      if (knownWorktrees.has(item.key)) continue;
      const marker = item.key.indexOf("/.worktrees/");
      if (marker < 0) continue;
      const prefix = item.key.slice(0, marker);
      const nested = item.key.slice(marker + "/.worktrees/".length).split("/");
      const task = nested.shift();
      const parent = prefix + (nested.length ? "/" + nested.join("/") : "");
      if (task && parent !== item.key && choices.has(parent)) choices.set(item.key, { ...item, parent, worktree: task });
    }
    if (main) for (const worktree of worktrees) {
      const item = choices.get(worktree.path)!;
      choices.set(worktree.path, worktree.path === main.path ? { ...item, parent: undefined, worktree: undefined }
        : { ...item, parent: main.path, worktree: worktree.headLabel || folderName(worktree.path) });
    }
    return [...choices.values()].map(item => ({ ...item, current: item.key === selectedPath(), recent: recent.includes(item.key) }))
      .sort((left, right) => Number(right.current) - Number(left.current) ||
        (recent.includes(left.key) ? recent.indexOf(left.key) : 999999) - (recent.includes(right.key) ? recent.indexOf(right.key) : 999999) || left.label.localeCompare(right.label));
  }
  effect(() => {
    const root = selectedPath();
    untracked(() => {
      if (workflowForm() && workflowForm()!.root !== root) workflowForm.set(null);
      if (pendingCommitFocus !== root) pendingCommitFocus = null;
    });
  });

  function rememberCurrentSession(history?: HistoryNavigation) {
    const path = selectedPath();
    if (!path || !libraryReady()) return;
    const previous = repositorySessions[path] ?? freshSession();
    const editors = openedWorkingEditors();
    rememberSession(repositorySessions, path, {
      ...previous, tab: repositoryTab(), commitMessage: commitMessage(), branchName: branchName(),
      workingFile: workingSelection(),
      openFiles: editors.kind === "ready" ? [...editors.files] : undefined,
      previewPath: lastPreviewPath(),
      commitId: selectedHistoryCommit(), commitFilePath: selectedHistoryFile(),
      history: history ?? previous.history,
    });
    if (!sessionPersistenceEnabled) return;
    let serialized: string;
    try { serialized = serializeRepositorySessions(repositorySessions); }
    catch (error) {
      sessionError.set(t("Could not save reading state: {error}", { error: getErrorMessage(error) }));
      return;
    }
    sessionWrites = sessionWrites.then(() => Storage.setItem(SESSION_STORAGE_KEY, serialized)).then(
      () => sessionError.set(null),
      (error: unknown) => sessionError.set(t("Could not save reading state: {error}", { error: getErrorMessage(error) })),
    );
  }

  function restoreRepositorySession(path: string) {
    previewCache.set(null);
    // Keep the current task tab for a first visit; saved workdirs restore their own tab.
    const saved = repositorySessions[path] ?? { ...freshSession(), tab: repositoryTab() };
    historyRestore.set({ ...saved.history });
    repositoryTab.set(saved.tab);
    commitMessage.set(saved.commitMessage);
    branchName.set(saved.branchName);
    const restoredWorkingFile = saved.workingFile && (saved.openFiles === undefined || saved.openFiles.some(file => workingFileKey(file) === workingFileKey(saved.workingFile!)))
      ? saved.workingFile : saved.openFiles?.[0] ?? null;
    workingSelection.set(restoredWorkingFile);
    openedWorkingEditors.set(saved.openFiles !== undefined ? { kind: "ready", files: saved.openFiles }
      : saved.workingFile ? { kind: "ready", files: [saved.workingFile] } : { kind: "fresh" });
    lastPreviewPath.set(saved.previewPath);
    selectedHistoryCommit.set(saved.commitId);
    selectedHistoryFile.set(saved.commitFilePath);
    // Selection restoration is metadata; loading starts only when a diff request is made.
    diffState.set({ kind: "idle" });
    if (saved.tab === "history" && saved.commitId) reviewView.set({ kind: "commit", repositoryPath: path, commitId: saved.commitId });
    else if (saved.tab === "files" && saved.previewPath) reviewView.set({ kind: "file", state: { kind: "loading", path: saved.previewPath } });
    else reviewView.set({ kind: "diff" });
  }

  cleanup(() => rememberCurrentSession());

  function saveLibrary(): Promise<void> {
    if (!libraryReady()) return libraryWrites;
    const snapshot = JSON.stringify({
      sources: sources(),
      activeKey: activeKey(),
      mode: displayMode(),
    });
    libraryWrites = libraryWrites.then(() => Storage.setItem(LIBRARY_STORAGE_KEY, snapshot)).then(
      () => storageError.set(null),
      (error: unknown) =>
        storageError.set(
          t("Could not save your library: {error}", {
            error: getErrorMessage(error),
          }),
        ),
    );
    return libraryWrites;
  }

  async function loadRepositoryDetails(repositoryPath: string) {
    invalidateReadCaches();
    rememberCurrentSession();
    historyRestore.set({ ...(repositorySessions[repositoryPath]?.history ?? freshHistory()) });
    const existingPreview = previewedFile();
    fileRequest += 1;
    previewCache.set(null);
    diffState.set({ kind: "idle" });
    const request = detailRequest() + 1;
    detailRequest.set(request);
    detailState.set({ kind: "loading" });
    try {
      const details = await Workspace.inspectRepository(repositoryPath);
      if (detailRequest() !== request || selectedPath() !== repositoryPath) {
        return;
      }
      detailState.set({ kind: "ready", details });
      repositoryRevision.set(repositoryRevision() + 1);
      const review = reviewView();
      if (repositoryTab() === "history") {
        if (review.kind !== "commit" || review.repositoryPath !== repositoryPath) reviewView.set({ kind: "diff" });
        return;
      }
      if (existingPreview) {
        await previewFile(existingPreview);
        return;
      }
      const previousSelection = workingSelection();
      const selectedFile = previousSelection ? details.changes.find(
        (file) => file.path === previousSelection.path &&
          (previousSelection.staged ? file.staged : file.unstaged || file.untracked),
      ) : undefined;
      const editors = openedWorkingEditors();
      const openFile = editors.kind === "ready" ? editors.files.find(open => details.changes.some(file => file.path === open.path && (open.staged ? file.staged : file.unstaged || file.untracked))) : null;
      const firstFile = selectedFile ?? (openFile ? details.changes.find(file => file.path === openFile.path)
        : editors.kind === "fresh" ? details.changes.find(file => file.unstaged || file.untracked) ?? details.changes[0] : undefined);
      if (firstFile) {
        await selectFileDiff(
          firstFile.path,
          selectedFile && previousSelection ? previousSelection.staged : openFile?.staged ?? !(firstFile.unstaged || firstFile.untracked),
        );
      } else {
        diffState.set({ kind: "idle" });
      }
    } catch (error) {
      if (detailRequest() !== request || selectedPath() !== repositoryPath) {
        return;
      }
      detailState.set({ kind: "failed", message: getErrorMessage(error) });
    }
  }

  function stopBackgroundScan() {
    const id = activeScan;
    // Invalidate polling before native cancellation, which can outlive an in-flight Git read.
    activeScan = null;
    scanRequest.set(scanRequest() + 1);
    sourceLoad.set({ kind: "idle" });
    backgroundScan.set({ kind: "idle" });
    scanNotice.set("Scan stopped. The list may be incomplete.");
    if (id !== null) {
      try { Workspace.stopScan(id); }
      catch (error) { sourceError.set(getErrorMessage(error)); }
    }
  }

  async function followScan(initial: ScanProgress, key: string, request: number) {
    let revision = initial.revision;
    while (!disposed && activeScan === initial.id) {
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
      if (disposed || activeScan !== initial.id || scanRequest() !== request) return;
      try {
        const progress = Workspace.scanProgress(initial.id, revision);
        inventoryComplete.set(progress.inventoryComplete);
        if (progress.revision !== revision) {
          revision = progress.revision;
          const current = scanState();
          if (current.kind === "ready" && activeKey() === key) {
            const all = flattenRepositories(progress.scan.repositories);
            const path = all.some((node) => node.path === current.selectedPath) ? current.selectedPath : all[0]?.path ?? null;
            const details = detailState();
            const repositories = details.kind === "ready" && details.details.path === path
              ? updateRepositorySummary(progress.scan.repositories, path ?? "", details.details)
              : progress.scan.repositories;
            if (path !== current.selectedPath) { rememberCurrentSession(); detailState.set({ kind: "loading" }); }
            scanState.set({ kind: "ready", result: { ...progress.scan, repositories }, selectedPath: path });
            if (path !== current.selectedPath) {
              fileRequest += 1;
              if (path) restoreRepositorySession(path);
              else { reviewView.set({ kind: "diff" }); diffState.set({ kind: "idle" }); }
              sources.set(sources().map((source) => sourceKey(source) === key ? { ...source, selectedPath: path } : source));
              saveLibrary();
              if (path) await loadRepositoryDetails(path);
              else detailState.set({ kind: "idle" });
            }
          }
        }
        if (disposed || activeScan !== initial.id || scanRequest() !== request) return;
        if (progress.phase !== "running") {
          activeScan = null;
          backgroundScan.set({ kind: "idle" });
          if (progress.error) sourceError.set(progress.error);
          return;
        }
        backgroundScan.set({ kind: "running", found: progress.repositoryCount, visited: progress.visitedDirectories, discovering: progress.discovering });
      } catch (error) {
        if (disposed || activeScan !== initial.id) return;
        Workspace.stopScan(initial.id);
        activeScan = null;
        backgroundScan.set({ kind: "idle" });
        sourceError.set(getErrorMessage(error));
        return;
      }
    }
  }

  async function loadSource(source: LibrarySource, rescan = false): Promise<string | null> {
    if (isOperating() || loading())
      return t("Another operation is still running.");
    rememberCurrentSession();
    if (activeScan !== null) { Workspace.stopScan(activeScan); activeScan = null; }
    backgroundScan.set({ kind: "idle" });
    scanNotice.set(null);
    const request = scanRequest() + 1;
    scanRequest.set(request);
    sourceLoad.set({
      kind: source.kind === "repository" ? "opening" : "scanning",
      path: source.path,
    });
    sourceError.set(null);
    try {
      let progress: ScanProgress | null = null;
      let result: WorkspaceScan;
      if (source.kind === "repository") result = await Workspace.openRepository(source.path);
      else {
        progress = await Workspace.startScan(source.path, source.selectedPath, rescan, process.dataDir);
        result = progress.scan;
      }
      if (disposed || scanRequest() !== request) {
        if (progress) Workspace.stopScan(progress.id);
        return null;
      }
      inventoryComplete.set(progress?.inventoryComplete ?? true);
      const allRepositories = flattenRepositories(result.repositories);
      const nextPath =
        allRepositories.find(
          (repository) => repository.path === source.selectedPath,
        )?.path ??
        allRepositories[0]?.path ??
        null;
      const nextSource: LibrarySource = {
        kind: source.kind,
        path: result.rootPath,
        selectedPath: nextPath,
      };
      const key = sourceKey(nextSource);
      const sameSelection = selectedPath() === nextPath && activeKey() === key;
      detailRequest.set(detailRequest() + 1);
      diffRequest.set(diffRequest() + 1);
      operationState.set({ kind: "idle" });
      if (!sameSelection) { fileRequest += 1; detailState.set({ kind: "loading" }); }
      sources.set(
        sources().some((entry) => sourceKey(entry) === key)
          ? sources().map((entry) =>
              sourceKey(entry) === key ? nextSource : entry,
            )
          : [...sources(), nextSource],
      );
      activeKey.set(key);
      scanState.set({ kind: "ready", result, selectedPath: nextPath });
      if (!sameSelection && nextPath) restoreRepositorySession(nextPath);
      saveLibrary();
      if (progress) {
        activeScan = progress.id;
        if (!progress.discovering && !progress.inventoryComplete) scanNotice.set("Cached list is partial. Use Rescan to find more repositories.");
        backgroundScan.set({ kind: "running", found: progress.repositoryCount, visited: progress.visitedDirectories, discovering: progress.discovering });
      }
      if (nextPath) {
        sourceLoad.set({ kind: "details", path: nextPath });
        await loadRepositoryDetails(nextPath);
      } else detailState.set({ kind: "idle" });
      if (progress && activeScan === progress.id) void followScan(progress, key, request);
      return null;
    } catch (error) {
      const message = getErrorMessage(error);
      if (scanRequest() === request) sourceError.set(message);
      return message;
    } finally {
      if (scanRequest() === request) sourceLoad.set({ kind: "idle" });
    }
  }

  async function addSource(
    kind: SourceKind,
    path: string,
  ): Promise<string | null> {
    const error = await loadSource({ kind, path, selectedPath: null }, kind === "directory");
    if (error === null) importForm.set(null);
    return error;
  }

  async function chooseSource(kind: SourceKind) {
    if (
      isScanning() ||
      isOperating() ||
      importForm() !== null ||
      settingsOpen()
    )
      return;
    picking.set(true);
    let path: string | null = null;
    try {
      path = await Workspace.chooseFolder(
        kind === "repository"
          ? t("Add an existing Git repository")
          : t("Add a workspace directory"),
      );
    } catch (error) {
      importForm.set({ kind, path: "", error: getErrorMessage(error) });
    } finally {
      picking.set(false);
    }
    if (path !== null) {
      const error = await addSource(kind, path);
      if (error) importForm.set({ kind, path, error });
    }
  }

  function enterPath() {
    if (!isScanning() && !isOperating() && !settingsOpen())
      importForm.set({ kind: "repository", path: "", error: null });
  }

  function refreshSource() {
    const source = activeSource();
    if (source && !isScanning() && !isOperating()) {
      if (directoryChanges()) directoryRefresh.set(directoryRefresh() + 1);
      void loadSource(source);
    }
  }

  function rescanSource() {
    const source = activeSource();
    if (source?.kind === "directory" && !isScanning() && !isOperating()) void loadSource(source, true);
  }

  async function removeSource(key: string) {
    if (isScanning() || isOperating()) return;
    rememberCurrentSession();
    const remaining = sources().filter((source) => sourceKey(source) !== key);
    sources.set(remaining);
    if (activeKey() === key) {
      activeKey.set(null);
      scanState.set({ kind: "idle" });
      detailRequest.set(detailRequest() + 1);
      diffRequest.set(diffRequest() + 1);
      detailState.set({ kind: "idle" });
      diffState.set({ kind: "idle" });
      operationState.set({ kind: "idle" });
      commitMessage.set("");
      branchName.set("");
      sourceError.set(null);
      if (remaining[0]) await loadSource(remaining[0]);
    }
    saveLibrary();
  }

  function revealSource(path: string) {
    void Workspace.revealDirectory(path).catch((error: unknown) =>
      sourceError.set(getErrorMessage(error)),
    );
  }

  async function restoreLibrary() {
    try {
      await restoreLanguage();
    } catch (error) {
      settingsError.set(
        t("Could not load settings: {error}", {
          error: getErrorMessage(error),
        }),
      );
    }
    startUpdateController();
    await panelLayout.restore();
    try {
      repositorySessions = readRepositorySessions(await Storage.getItem(SESSION_STORAGE_KEY));
    } catch (error) {
      sessionPersistenceEnabled = false;
      sessionError.set(t("Could not restore reading state: {error}", { error: getErrorMessage(error) }) + " " + t("Saved data was left unchanged; reading state is kept in memory for this launch."));
    }
    try {
      const saved = readLibrary(await Storage.getItem(LIBRARY_STORAGE_KEY));
      sources.set(saved.sources);
      displayMode.set(saved.mode);
      libraryReady.set(true);
      restorationFinished = true;
      acknowledgeStartup();
      const source = saved.sources.find(
        (entry) => sourceKey(entry) === saved.activeKey,
      );
      if (source) await loadSource(source);
    } catch (error) {
      sourceError.set(getErrorMessage(error));
    } finally {
      libraryReady.set(true);
      restorationFinished = true;
      acknowledgeStartup();
    }
  }

  effect(() => {
    Window.setTitleBar("hidden", 40);
    cleanup(() => Window.setTitleBar("default"));
  });

  effect(() => {
    void loadDiagnostics();
    void restoreLibrary();
  });

  async function selectRepository(repositoryPath: string) {
    const current = scanState();
    if (current.kind !== "ready" || current.selectedPath === repositoryPath) {
      return;
    }
    if (isOperating() || isScanning()) {
      return;
    }

    rememberCurrentSession();
    fileRequest += 1;
    diffRequest.set(diffRequest() + 1);
    operationState.set({ kind: "idle" });
    detailState.set({ kind: "loading" });
    scanState.set({ ...current, selectedPath: repositoryPath });
    restoreRepositorySession(repositoryPath);
    sources.set(
      sources().map((source) =>
        sourceKey(source) === activeKey()
          ? { ...source, selectedPath: repositoryPath }
          : source,
      ),
    );
    saveLibrary();
    await loadRepositoryDetails(repositoryPath);
  }

  function selectCommit(commitId: string, repositoryPath: string) {
    const current = detailState();
    if (!repositoryPath || selectedPath() !== repositoryPath || isOperating() || current.kind !== "ready" || current.details.path !== repositoryPath ||
        !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(commitId)) return;
    if (selectedHistoryCommit() !== commitId) selectedHistoryFile.set(null);
    selectedHistoryCommit.set(commitId);
    repositoryTab.set("history");
    reviewView.set({ kind: "commit", repositoryPath, commitId });
    rememberCurrentSession();
  }

  function clearCommitSelection(repositoryPath: string) {
    if (selectedPath() !== repositoryPath) return;
    selectedHistoryCommit.set(null);
    selectedHistoryFile.set(null);
    if (repositoryTab() === "history") reviewView.set({ kind: "diff" });
    rememberCurrentSession();
  }

  function changeRepositoryTab(tab: RepositoryTab) {
    if (isScanning() || isOperating() || repositoryTab() === tab) return;
    const root = selectedPath();
    repositoryTab.set(tab);
    if (tab === "history") {
      const id = selectedHistoryCommit();
      reviewView.set(root && id ? { kind: "commit", repositoryPath: root, commitId: id } : { kind: "diff" });
    } else if (tab === "changes") {
      reviewView.set({ kind: "diff" });
      const current = detailState();
      if (root && current.kind === "ready" && diffState().kind === "idle") {
        const previous = workingSelection();
        const editors = openedWorkingEditors();
        const open = editors.kind === "ready" ? editors.files.find(item => current.details.changes.some(file => file.path === item.path && (item.staged ? file.staged : file.unstaged || file.untracked))) : null;
        const target = previous ?? open;
        const file = target ? current.details.changes.find(file => file.path === target.path && (target.staged ? file.staged : file.unstaged || file.untracked))
          : editors.kind === "fresh" ? current.details.changes.find(file => file.unstaged || file.untracked) ?? current.details.changes[0] : undefined;
        if (file) void selectFileDiff(file.path, target?.staged ?? !(file.unstaged || file.untracked));
      }
    } else {
      const path = lastPreviewPath();
      const cached = previewState();
      if (root && path && !cached) void previewFile(path);
      else if (cached) reviewView.set({ kind: "file", state: cached });
    }
    rememberCurrentSession();
  }

  async function previewFile(path: string) {
    const repository = selectedPath();
    if (!repository || isOperating()) return;
    lastPreviewPath.set(path);
    const request = ++fileRequest;
    const cacheKey = JSON.stringify([repository, repositoryRevision(), path]);
    const cachedFile = fileContentCache.get(cacheKey) ?? undefined;
    const pending: FilePreviewState = { kind: "loading", path, cachedFile };
    reviewView.set({ kind: "file", state: pending });
    previewCache.set({ repositoryPath: repository, state: pending });
    rememberCurrentSession();
    try {
      const file = await Workspace.readFile(repository, path);
      if (request !== fileRequest || selectedPath() !== repository) return;
      fileContentCache.set(cacheKey, file);
      reviewView.set({ kind: "file", state: { kind: "ready", file } });
      previewCache.set({ repositoryPath: repository, state: { kind: "ready", file } });
    } catch (error) {
      if (request !== fileRequest || selectedPath() !== repository) return;
      reviewView.set({ kind: "file", state: { kind: "failed", path, message: getErrorMessage(error) } });
      previewCache.set({ repositoryPath: repository, state: { kind: "failed", path, message: getErrorMessage(error) } });
    }
  }

  async function openWorktree(path: string) {
    if (directoryOpening()) return;
    const current = scanState();
    if (current.kind === "ready" && flattenRepositories(current.result.repositories).some((node) => node.path === path)) {
      await selectRepository(path);
    } else {
      const error = await loadSource({ kind: "repository", path, selectedPath: path });
      if (error) sourceError.set(error);
    }
  }

  async function selectFileDiff(filePath: string, staged: boolean) {
    const repositoryPath = selectedPath();
    if (!repositoryPath || isOperating()) {
      return;
    }
    const current = detailState();
    if (current.kind === "ready" && current.details.changes.some((file) => file.path === filePath && file.conflicted)) {
      repositoryTab.set("files");
      await previewFile(filePath);
      return;
    }

    if (current.kind !== "ready" || current.details.path !== repositoryPath ||
        !current.details.changes.some(file => file.path === filePath && (staged ? file.staged : file.unstaged || file.untracked))) return;
    const shown = diffState();
    if (shown.kind === "ready" && shown.filePath === filePath && shown.staged === staged) {
      reviewView.set({ kind: "diff" });
      return;
    }
    openedWorkingEditors.set(openWorkingEditor(openedWorkingEditors(), { path: filePath, staged }));
    reviewView.set({ kind: "diff" });
    const cacheKey = JSON.stringify([repositoryPath, repositoryRevision(), filePath, staged]);
    const cached = diffCache.get(cacheKey);
    const request = diffRequest() + 1;
    diffRequest.set(request);
    workingSelection.set({ path: filePath, staged });
    diffState.set({ kind: "loading", filePath, staged, cachedPatch: cached ?? undefined });
    rememberCurrentSession();
    try {
      const patch = await Workspace.diffFile(repositoryPath, filePath, staged);
      if (diffRequest() !== request || selectedPath() !== repositoryPath) {
        return;
      }
      diffCache.set(cacheKey, patch);
      diffState.set({ kind: "ready", filePath, staged, patch });
    } catch (error) {
      if (diffRequest() !== request || selectedPath() !== repositoryPath) {
        return;
      }
      diffState.set({
        kind: "failed",
        filePath,
        staged,
        message: getErrorMessage(error),
      });
    }
  }

  async function performRepositoryAction(action: RepositoryAction, expectedRepositoryPath: string) {
    const currentScan = scanState();
    if (
      currentScan.kind !== "ready" ||
      !currentScan.selectedPath ||
      currentScan.selectedPath !== expectedRepositoryPath ||
      isOperating() ||
      isScanning()
    ) {
      return;
    }

    const repositoryPath = currentScan.selectedPath;
    invalidateReadCaches();
    const request = operationRequest() + 1;
    operationRequest.set(request);
    detailRequest.set(detailRequest() + 1);
    diffRequest.set(diffRequest() + 1);
    if (action.kind !== "push") {
      diffState.set({ kind: "idle" });
      fileRequest += 1;
      previewCache.set(null);
      if (action.kind !== "stageFile" && action.kind !== "unstageFile" && action.kind !== "stageAll") pushFeedback.set({ kind: "idle" });
    } else {
      pushFeedback.set({ kind: "running", root: repositoryPath, branch: currentDetails()?.branchName ?? "" });
    }
    operationState.set({ kind: "running", label: actionLabel(action) });

    try {
      let details: RepositoryDetails;
      switch (action.kind) {
        case "stageFile":
          details = await Workspace.stageFile(repositoryPath, action.filePath);
          break;
        case "unstageFile":
          details = await Workspace.unstageFile(
            repositoryPath,
            action.filePath,
          );
          break;
        case "stageAll":
          details = await Workspace.stageAll(repositoryPath);
          break;
        case "commit":
          details = await Workspace.commit(repositoryPath, action.message);
          break;
        case "createBranch":
          details = await Workspace.createBranch(
            repositoryPath,
            action.branchName,
          );
          break;
        case "switchBranch":
          details = await Workspace.switchBranch(
            repositoryPath,
            action.branchName,
          );
          break;
        case "fetch":
          details = await Workspace.fetch(repositoryPath);
          break;
        case "pull":
          details = await Workspace.pull(repositoryPath);
          break;
        case "push": {
          const pushed = await Workspace.pushWithOutcome(repositoryPath);
          if (operationRequest() !== request || selectedPath() !== repositoryPath) return;
          pushFeedback.set({ kind: "confirmed", root: repositoryPath, branch: pushed.branchName, refreshError: pushed.refreshError });
          if (!pushed.details) {
            operationState.set({ kind: "succeeded", message: "Push confirmed" });
            return;
          }
          details = pushed.details;
          break;
        }
      }

      const latestScan = scanState();
      if (
        operationRequest() !== request ||
        latestScan.kind !== "ready" ||
        latestScan.selectedPath !== repositoryPath
      ) {
        return;
      }

      const updatedScan: ScanState = {
        ...latestScan,
        result: {
          ...latestScan.result,
          repositories: updateRepositorySummary(
            latestScan.result.repositories,
            repositoryPath,
            details,
          ),
        },
      };
      scanState.set(updatedScan);
      detailState.set({ kind: "ready", details });
      repositoryRevision.set(repositoryRevision() + 1);
      operationState.set({ kind: "succeeded", message: action.kind === "push" ? "Push confirmed" : actionSuccess(action) });
      if (action.kind === "commit") {
        commitMessage.set("");
      }
      if (action.kind === "createBranch") {
        branchName.set("");
      }
      if (action.kind === "switchBranch" || action.kind === "createBranch") {
        selectedHistoryCommit.set(null);
        selectedHistoryFile.set(null);
        reviewView.set({ kind: "diff" });
        const navigation = freshHistory(details.branchName ?? "detached");
        historyRestore.set(navigation);
        rememberCurrentSession(navigation);
      } else rememberCurrentSession();
      const openFile = previewedFile();
      if (openFile) await previewFile(openFile);
    } catch (error) {
      if (operationRequest() === request && selectedPath() === repositoryPath) {
        if (action.kind === "push" && pushFeedback().kind !== "confirmed") pushFeedback.set({ kind: "unconfirmed", root: repositoryPath, branch: currentDetails()?.branchName ?? "", error: getErrorMessage(error) });
        operationState.set({ kind: "failed", message: getErrorMessage(error) });
      }
    }
  }

  async function refreshGitContext(root: string | null) {
    const request = ++contextRequest;
    if (!root) { gitContextState.set(null); contextLoading.set(false); return; }
    contextLoading.set(true);
    try {
      const context = await Workspace.gitContext(root);
      if (request === contextRequest && selectedPath() === root) gitContextState.set({ root, value: context });
    } catch (cause) {
      if (request === contextRequest && selectedPath() === root) sourceError.set(getErrorMessage(cause));
    } finally { if (request === contextRequest) contextLoading.set(false); }
  }

  async function prepareWorkflow(request: GitOperationRequest, root: string): Promise<GitOperationPlan> {
    if (selectedPath() !== root || isOperating() || isScanning()) throw new Error(t("Repository selection changed. Review the operation again."));
    const preparing = { root, label: workflowTitles[request.kind as WorkflowKind] ?? "Git operation" };
    operationState.set({ kind: "idle" });
    workflowPreparation.set(preparing);
    try {
      const plan = await Workspace.prepareOperation(root, request);
      if (selectedPath() !== root) throw new Error(t("Repository selection changed. Review the operation again."));
      return plan;
    } finally { workflowPreparation.set(null); }
  }
  async function runSimpleWorkflow(request: GitOperationRequest, root: string) {
    try { const plan = await prepareWorkflow(request, root); await executeWorkflow(plan); }
    catch (cause) { if (selectedPath() === root) operationState.set({ kind: "failed", message: getErrorMessage(cause) }); }
  }
  function requestWorkflow(request: GitOperationRequest, root: string) {
    if (isOperating() || isScanning() || selectedPath() !== root) return;
    if (workflowPresentation(request.kind) === "direct") {
      workflowForm.set(null);
      void runSimpleWorkflow(request, root);
    } else {
      workflowForm.set({ root, request });
      presentation.set({ kind: "review", auxiliary: "git" });
    }
  }

  async function showTools(root: string) {
    if (isOperating() || isScanning() || directoryOpening()) return;
    if (selectedPath() !== root) await selectRepository(root);
    if (selectedPath() === root) presentation.set({ kind: "review", auxiliary: "git" });
  }

  function openEditor(path: string, root: string) {
    if (selectedPath() !== root || isOperating()) return;
    void Workspace.openWorkingFile(root, path).catch((cause: unknown) => sourceError.set(getErrorMessage(cause)));
  }

  async function executeWorkflow(plan: GitOperationPlan): Promise<GitOperationOutcome> {
    const root = selectedPath();
    if (!root || root !== plan.repositoryPath || isOperating()) throw new Error(t("Repository selection changed. Review the operation again."));
    invalidateReadCaches();
    pushFeedback.set({ kind: "idle" });
    operationState.set({ kind: "running", label: "Git operation" });
    detailRequest.set(detailRequest() + 1);
    diffRequest.set(diffRequest() + 1);
    fileRequest += 1;
    previewCache.set(null);
    diffState.set({ kind: "idle" });
    try {
      const outcome = await Workspace.executeOperation(root, plan);
      if (selectedPath() !== root) return outcome;
      const current = scanState();
      if (current.kind === "ready") scanState.set({ ...current, result: { ...current.result, repositories: updateRepositorySummary(current.result.repositories, root, outcome.details) } });
      detailState.set({ kind: "ready", details: outcome.details });
      gitContextState.set({ root, value: outcome.context });
      selectedHistoryCommit.set(null);
      selectedHistoryFile.set(null);
      const navigation = freshHistory(outcome.details.branchName ?? "detached");
      historyRestore.set(navigation);
      repositoryRevision.set(repositoryRevision() + 1);
      operationState.set(outcome.status === "completed" ? { kind: "succeeded", message: "Git operation completed." }
        : { kind: "failed", message: outcome.error ?? t("Git operation paused") });
      if (outcome.context.conflicts.length) repositoryTab.set("changes");
      rememberCurrentSession(navigation);
      return outcome;
    } catch (cause) {
      operationState.set({ kind: "failed", message: getErrorMessage(cause) });
      // Re-read state after an uncertain outcome; never retry a Git write automatically.
      await loadRepositoryDetails(root);
      throw cause;
    }
  }

  effect(() => {
    const root = selectedPath();
    void repositoryRevision();
    void refreshGitContext(root);
  });

  const onDisplayModeChange = (mode: DisplayMode) => {
    displayMode.set(mode);
    saveLibrary();
  };
  const onCommitMessageChange = (value: string) => { commitMessage.set(value); rememberCurrentSession(); };

  effect(() => {
    const disabled =
      isScanning() || isOperating() || directoryOpening() || importForm() !== null || settingsOpen() || pickerOpen() !== null || setupClone() !== null;
    const active = activeSource();
    Window.setTitle(
      active ? folderName(active.path) + " — DiffLens" : "DiffLens",
    );
    DesktopMenu.setApplicationMenu([
      {
        label: "DiffLens",
        submenu: [
          { role: "about", label: t("About DiffLens") },
          { label: t("Check for Updates…"), disabled: importForm() !== null, onSelect: openUpdateSettings },
          {
            label: t("Settings…"),
            shortcut: "mod+,",
            disabled: importForm() !== null,
            onSelect: openSettings,
          },
          { type: "separator" },
          { role: "hide", label: t("Hide DiffLens") },
          { role: "hideOthers", label: t("Hide Others") },
          { role: "showAll", label: t("Show All") },
          { type: "separator" },
          { role: "quit", label: t("Quit DiffLens") },
        ],
      },
      {
        label: t("File"),
        submenu: [
          {
            label: t("Add Repository…"),
            shortcut: "mod+o",
            disabled,
            onSelect: () => {
              void chooseSource("repository");
            },
          },
          {
            label: t("Add Directory…"),
            shortcut: "mod+shift+o",
            disabled,
            onSelect: () => {
              void chooseSource("directory");
            },
          },
          {
            label: t("Enter Folder Path…"),
            shortcut: "mod+l",
            disabled,
            onSelect: enterPath,
          },
          { type: "separator" },
          {
            label: t("Refresh"),
            shortcut: "mod+r",
            disabled: disabled || !active,
            onSelect: refreshSource,
          },
          {
            label: t("Rescan repositories"),
            shortcut: "mod+shift+r",
            disabled: disabled || active?.kind !== "directory",
            onSelect: rescanSource,
          },
          { label: t("Fetch"), disabled: disabled || !currentDetails()?.remoteNames.length,
            onSelect: () => { const root = selectedPath(); if (root) void performRepositoryAction({ kind: "fetch" }, root); } },
          { label: t("Commit staged"), shortcut: "mod+enter", disabled: disabled || repositoryTab() !== "changes" || !fileNavigationVisible() || !canCommit(), onSelect: () => commit() },
          { label: t("Close tab"), shortcut: "mod+w", disabled: disabled || repositoryTab() !== "changes" || !ribbonSelection(),
            onSelect: () => { const root = selectedPath(); const file = ribbonSelection(); if (root && file) closeWorkingTabs(file, "one", root); } },
          { role: "close", label: t("Close Window"), shortcut: "mod+shift+w" },
        ],
      },
      {
        label: t("Edit"),
        submenu: [
          { role: "undo", label: t("Undo") },
          { role: "redo", label: t("Redo") },
          { type: "separator" },
          { role: "cut", label: t("Cut") },
          { role: "copy", label: t("Copy") },
          { role: "paste", label: t("Paste") },
          { role: "selectAll", label: t("Select All") },
        ],
      },
      {
        label: t("View"),
        submenu: [
          { label: t("Repository navigation"), shortcut: "mod+shift+1", when: "notEditing", disabled,
            checked: repositoryNavigationVisible(), onSelect: () => toggleNavigation("repositories") },
          { label: t("File navigation"), shortcut: "mod+shift+2", when: "notEditing", disabled,
            checked: fileNavigationVisible(), onSelect: () => toggleNavigation("files") },
          { label: t("Focus review"), shortcut: "mod+shift+f", when: "notEditing", disabled,
            checked: presentation().kind === "focus", onSelect: toggleFocus },
          { label: t("Commit composer"), shortcut: "mod+shift+c", when: "notEditing", disabled, onSelect: showCommitComposer },
          { type: "separator" },
          {
            label: t("Nested Repositories"),
            checked: displayMode() === "nested",
            onSelect: () => onDisplayModeChange("nested"),
          },
          {
            label: t("Flat Repositories"),
            checked: displayMode() === "flat",
            onSelect: () => onDisplayModeChange("flat"),
          },
        ],
      },
      {
        label: t("Window"),
        submenu: [
          { role: "minimize", label: t("Minimize") },
          { role: "zoom", label: t("Zoom") },
          { role: "toggleFullScreen", label: t("Toggle Full Screen") },
        ],
      },
    ]);
  });
  cleanup(() => DesktopMenu.setApplicationMenu(null));

  const importDialog = computed(() => {
    const form = importForm();
    return form ? (
      <AddSourceDialog
        kind={form.kind}
        initialPath={form.path}
        initialError={form.error}
        onCancel={() => importForm.set(null)}
        onAdd={addSource}
      />
    ) : null;
  });
  const hasRepositories = computed(() => (counts()?.total ?? 0) > 0);
  function reviewTabHint(label: Message): string {
    if (!hasRepositories()) return t("Select a repository");
    if (isScanning() || isOperating()) return t("Another operation is still running.");
    return t(label);
  }
  function gitToolsHint(): string {
    if (!hasRepositories()) return t("Select a repository");
    if (isScanning() || isOperating()) return t("Another operation is still running.");
    if (!currentDetails()) return t("Reading repository");
    return t("Branches and Stash");
  }
  const editorContent = <View testID="review-canvas" class="relative min-h-0 min-w-0 flex-1">
    <ReviewFileRibbon entries={ribbonEntries()} selection={ribbonSelection()} repositoryPath={selectedPath()}
      onClose={(file, mode, root) => closeWorkingTabs(file, mode, root)}
      visible={presentation().kind === "review" && repositoryTab() === "changes" && hasRepositories()}
      disabled={isScanning() || isOperating() || !currentDetails()}
      onSelect={(path, staged) => { void selectFileDiff(path, staged); }} />
    <View class="relative min-h-0 min-w-0 flex-1">
      {hasRepositories() ? <>
        <RetainedPane active={repositoryTab() === "changes"}><DiffPane diff={diffState()} focus={reviewFocus("changes")} /></RetainedPane>
        <RetainedPane active={repositoryTab() === "files"}><FilePreviewPane state={previewState()} focus={reviewFocus("files")} /></RetainedPane>
        <RetainedPane active={repositoryTab() === "history"}>
          {(() => {
            const root = selectedPath();
            const id = selectedHistoryCommit();
            return root && id ? <CommitReviewPane focus={reviewFocus("history")} onWorkflow={(request) => requestWorkflow(request, root)} panelSizes={panelLayout.sizes()} onPanelResize={panelLayout.resize}
              disabled={isScanning() || isOperating()} repositoryPath={root} commitId={id}
              initialFilePath={selectedHistoryFile()} onFileSelection={path => {
                if (selectedPath() === root && selectedHistoryCommit() === id) { selectedHistoryFile.set(path); rememberCurrentSession(); }
              }} onBack={() => changeRepositoryTab("changes")} />
              : <View class="flex-1"><ReviewHeader focus={reviewFocus("history")}><Text class="text-[12px] text-foreground">{t("History")}</Text></ReviewHeader><View class="flex-1 items-center justify-center p-4"><Text class="text-[12px] text-muted-foreground">{t("Select a commit to review its files and diff.")}</Text></View></View>;
          })()}
        </RetainedPane>
      </> : <WelcomePane busy={isScanning() || backgroundScan().kind === "running"}
        emptyDirectory={scanState().kind === "ready" && inventoryComplete() && backgroundScan().kind !== "running"}
        onChoose={kind => { void chooseSource(kind); }} onEnterPath={enterPath} />}
    </View>
  </View>;

  return (
    <View {...appearanceThemeProps()} class="min-h-0 flex-1 flex-col bg-chrome text-foreground" onLayout={() => { rootLaidOut = true; acknowledgeStartup(); }}>
      <View class="bg-chrome">
        <View
          testID="window-toolbar"
          desktop={{ windowDrag: true }}
          style={{
            height: Math.max(36, titleBar().height),
            paddingLeft: titleBar().left + 8,
            paddingRight: titleBar().right + 8,
          }}
          class="flex-row items-center gap-1.5"
        >
          <QuickSwitcher label={t("Repository")} value={selectedPath() ? folderName(selectedPath()!) : t("Choose repository")}
            icon="folder" placeholder={t("Search repositories…")} scope={selectedPath()} disabled={isScanning() || isOperating()}
            items={repositoryChoices} onSelect={path => { void openWorktree(path); }} onTriggerRef={node => { repositoryOpener = node; }}
            onOpenChange={open => pickerOpen.set(open ? "repository" : pickerOpen() === "repository" ? null : pickerOpen())}
            actions={[
              { label: t("Manage repositories…"), onSelect: () => presentation.set({ kind: "review", auxiliary: "repositories" }) },
              { label: t("Add Repository…"), onSelect: () => { void chooseSource("repository"); } },
              { label: t("Add Directory…"), onSelect: () => { void chooseSource("directory"); } },
              { label: t("Clone repository…"), onSelect: () => setupClone.set(true) },
            ]} />
          <View tooltip={<Hint text={t("Branch") + " · " + (currentDetails()?.branchName ?? currentDetails()?.headLabel ?? "-") + "\n" + t("Branches and Stash")} />}>
            <Button testID="open-current-branch" selected={gitNavigationVisible()} disabled={isScanning() || isOperating() || !currentDetails()}
              accessibilityLabel={t("Branch") + " · " + (currentDetails()?.branchName ?? currentDetails()?.headLabel ?? "-")}
              onPress={() => { const root = selectedPath(); if (root) void showTools(root); }}
              class="h-7 min-w-0 flex-row items-center gap-1 rounded px-1.5 hover:bg-muted/60 selected:bg-muted/60 disabled:opacity-35">
              <Icon name="worktree" size={13} muted />
              <Text class="text-[10px] text-muted-foreground">{t("Branch")}</Text>
              <Text numberOfLines={1} class="max-w-40 min-w-0 text-[11px] font-medium text-foreground">{currentDetails()?.branchName ?? currentDetails()?.headLabel ?? "-"}</Text>
            </Button>
          </View>
          <View class="min-w-0 flex-1 flex-row items-center justify-center px-3">
            {(() => {
              const activity = uiActivity();
              return activity ? <View testID="window-activity" class="min-w-0 max-w-96 flex-row items-center gap-1">
                <View class="min-w-0 flex-1" tooltip={<Hint text={activity.detail ? activity.label + "\n" + activity.detail : activity.label} />}>
                  <LoadingStatus label={activity.label} />
                </View>
                {activity.cancel ? <IconButton icon="stop" testID="stop-scan" compact label={t("Stop scanning")} onPress={() => uiActivity()?.cancel?.()} /> : null}
              </View> : null;
            })()}
          </View>
          {(() => {
            const update = updateNotification();
            if (!update) return null;
            const label = update.phase === "recovered" ? t("Updates") : update.phase === "ready" ? t("Update ready") : t("Update available");
            return <Button testID="update-notification" accessibilityLabel={label} onPress={openUpdateSettings}
              class="h-6 shrink-0 flex-row items-center gap-1 rounded px-1.5 hover:bg-accent active:bg-accent">
              <Icon name="fetch" size={12} />
              <Text numberOfLines={1} class="text-[11px] text-foreground">{label}</Text>
            </Button>;
          })()}
        </View>
        {(() => { const notice = scanNotice(); return notice ? <Text class="px-3 pb-2 text-[11px] text-muted-foreground">{t(notice)}</Text> : null; })()}
        {sourceError() ? (
          <Text testID="library-error" class="px-3 pb-2 text-[12px] text-destructive">
            {sourceError()}
          </Text>
        ) : null}
        {storageError() ? (
          <Text class="text-[11px] text-destructive">{storageError()}</Text>
        ) : null}
        {sessionError() ? <Text testID="session-error" class="px-3 pb-2 text-[11px] text-destructive">{sessionError()}</Text> : null}
        {layoutError() ? <Text testID="layout-error" class="px-3 pb-2 text-[11px] text-destructive">{layoutError()}</Text> : null}
      </View>

      <View class="min-h-0 flex-1 flex-row">
        <View testID="review-navigation-rail" class={presentation().kind === "focus" ? "hidden" : "w-[42px] shrink-0 items-center gap-1 border-r border-border/40 bg-chrome py-1"}>
          <IconButton ref={node => { fileOpener = node; }} icon="nested" testID="changes-tab" label={t("Changes")} hint={reviewTabHint("Changes")}
            selected={repositoryTab() === "changes" && !gitNavigationVisible() && !repositoryNavigationVisible()} disabled={!hasRepositories() || isScanning() || isOperating()} onPress={() => openTask("changes")} />
          <IconButton icon="file" testID="files-tab" label={t("Files")} hint={reviewTabHint("Files")}
            selected={repositoryTab() === "files" && !gitNavigationVisible() && !repositoryNavigationVisible()} disabled={!hasRepositories() || isScanning() || isOperating()} onPress={() => openTask("files")} />
          <IconButton icon="history" testID="history-tab" label={t("History")} hint={reviewTabHint("History")}
            selected={repositoryTab() === "history" && !gitNavigationVisible() && !repositoryNavigationVisible()} disabled={!hasRepositories() || isScanning() || isOperating()} onPress={() => openTask("history")} />
          <View class="my-1 h-px w-5 bg-border" />
          <IconButton ref={node => { gitOpener = node; }} icon="worktree" testID="open-git-tools" label={t("Branches and Stash")} hint={gitToolsHint()} selected={gitNavigationVisible()} disabled={!currentDetails() || isScanning() || isOperating()}
            onPress={() => toggleNavigation("git")} />
          <View class="min-h-0 flex-1" />
          <IconButton icon="settings" testID="open-settings" label={t("Settings")} hint={t("Settings (⌘,)")} onPress={openSettings} />
        </View>
        <View class="min-h-0 min-w-0 flex-1">
          {(() => {
            const operation = operationState();
            return operation.kind === "failed" ? <Text testID="review-operation-error" class="px-3 py-1 text-[11px] text-destructive">{operation.message}</Text> : null;
          })()}
          {detailState().kind === "failed" ? <Text testID="review-detail-error" class="px-3 py-1 text-[11px] text-destructive">{(detailState() as Extract<DetailState, { kind: "failed" }>).message}</Text> : null}
          <GitOperationBanner context={gitContext()} disabled={isScanning() || isOperating()}
            onRequest={request => { const root = selectedPath(); if (root) requestWorkflow(request, root); }} />
          <View onLayout={bounds => {
            const previous = canvasSize();
            if (previous.width !== bounds.size.width || previous.height !== bounds.size.height) canvasSize.set({ width: bounds.size.width, height: bounds.size.height });
          }} class="relative min-h-0 min-w-0 flex-1 bg-background">
          <ResizablePanelGroup axis="horizontal" class="min-h-0 min-w-0 flex-1" handleClass={panelHandleClass()} handleThumbClass={panelGripClass()} handleAccessibilityLabel={t("Resize sidebar")}>

            <ResizablePanel testID="repository-drawer" fixed visible={repositoryNavigationVisible()}
              size={Math.min(panelLayout.sizes().sidebar, Math.max(PANEL_LIMITS.sidebar.min, canvasSize().width - 328))}
              minSize={PANEL_LIMITS.sidebar.min} maxSize={Math.max(PANEL_LIMITS.sidebar.min, Math.min(PANEL_LIMITS.sidebar.max, canvasSize().width - 328))}
              onResize={size => panelLayout.resize("sidebar", size)} class="min-h-0 overflow-hidden bg-chrome">
              <View class="h-8 flex-row items-center justify-between px-2"><Text class="text-[11px] text-muted-foreground">{t("Repositories")}</Text>
                <IconButton icon="stop" compact label={t("Close navigation")} testID="close-repository-drawer" onPress={() => toggleNavigation("repositories")} /></View>
                  <RepositoryPane
                    onTools={(root) => { void showTools(root); }} onSetup={(clone) => setupClone.set(clone)}
                    panelSizes={panelLayout.sizes()} onPanelResize={panelLayout.resize}
                    sources={sources()}
                    activeKey={activeKey()}
                    activeSource={activeSource()}
                    onOpenSource={(source) => {
                      void loadSource(source);
                    }}
                    onRemoveSource={(key) => {
                      void removeSource(key);
                    }}
                    onRevealSource={revealSource}
                    onChooseSource={(kind) => {
                      void chooseSource(kind);
                    }}
                    onEnterPath={enterPath}
                    repositories={repositories()}
                    selectedPath={selectedPath()}
                    mode={displayMode()}
                    warnings={warnings()}
                    disabled={isScanning() || isOperating()}
                    worktrees={associatedWorktrees()}
                    onOpenWorktree={(path) => { void openWorktree(path); }}
                    onModeChange={onDisplayModeChange}
                    onSelect={(path) => { void selectRepository(path); }}
                  />
            </ResizablePanel>
            <ResizablePanel testID="file-drawer" fixed visible={fileNavigationVisible() && hasRepositories()}
              size={Math.min(panelLayout.sizes().navigation, Math.max(PANEL_LIMITS.navigation.min, canvasSize().width - 328))}
              minSize={PANEL_LIMITS.navigation.min} maxSize={Math.max(PANEL_LIMITS.navigation.min, Math.min(PANEL_LIMITS.navigation.max, canvasSize().width - 328))}
              onResize={size => panelLayout.resize("navigation", size)} class="min-h-0 overflow-hidden bg-background">
              <View class={repositoryTab() === "files" && currentDetails() ? "hidden" : "h-8 flex-row items-center bg-surface-muted px-2"}>
                {repositoryTab() === "changes" ? <Button testID="changes-scope" disabled={isScanning() || isOperating() || directoryOpening()}
                  accessibilityLabel={t(directoryChanges() ? "Current repository" : "All repositories in this directory")}
                  onPress={() => { void toggleChangesScope(); }} class="h-8 min-w-0 flex-1 flex-row items-center gap-1 pr-1 hover:bg-muted/50 disabled:opacity-35">
                  <Text numberOfLines={1} class="min-w-0 flex-1 text-[11px] font-medium text-foreground">{t("Changes") + " · " + t(directoryChanges() ? "Current directory" : "Current repository")}</Text>
                  <Icon name={directoryChanges() ? "folder" : "worktree"} size={12} muted />
                </Button> : <Text class="min-w-0 flex-1 text-[11px] font-medium text-foreground">{t(repositoryTab() === "files" ? "Files" : "History")}</Text>}
                {repositoryTab() === "changes" ? <IconButton icon={preferences().changeView === "tree" ? "flat" : "nested"} compact testID="toggle-changed-file-view"
                  label={t(preferences().changeView === "tree" ? "View changes as list" : "View changes as tree")}
                  onPress={() => {
                    sourceError.set(null);
                    void updatePreferences({ changeView: preferences().changeView === "tree" ? "list" : "tree" })
                      .catch(cause => sourceError.set(t("Could not save settings: {error}", { error: getErrorMessage(cause) })));
                  }} /> : null}
                {repositoryTab() === "changes" ? <IconButton icon="more" compact testID="changes-sync-actions" label={t("More actions")}
                  disabled={isScanning() || isOperating() || !currentDetails()}
                  onPress={() => {
                    const root = selectedPath();
                    const details = currentDetails();
                    if (!root || !details) return;
                    void DesktopMenu.popup([
                      ...(!directoryChanges() ? [
                        { label: t("Pull"), disabled: !details.hasUpstream, onSelect: () => { void performRepositoryAction({ kind: "pull" }, root); } },
                        { label: t("Fetch"), disabled: !details.remoteNames.length, onSelect: () => { void performRepositoryAction({ kind: "fetch" }, root); } },
                      ] : []),
                      { label: t("Refresh"), onSelect: () => { if (root === selectedPath()) refreshSource(); } },
                      ...(activeSource()?.kind === "directory" ? [{ label: t("Rescan repositories"), onSelect: () => { if (root === selectedPath()) rescanSource(); } }] : []),
                    ]);
                  }} /> : null}
                <IconButton icon="stop" compact label={t("Close navigation")} testID="close-file-drawer" onPress={() => toggleNavigation("files")} />
              </View>
                  <RetainedPane active={directoryChangesVisible()}>
                    <DirectoryChangesPane active={directoryChangesVisible()} directory={activeSource()?.path ?? ""} repositories={repositories()}
                      complete={inventoryComplete()} scanning={backgroundScan().kind === "running"} warnings={warnings()}
                      refreshEpoch={directoryRefresh()} disabled={isScanning() || isOperating() || directoryOpening()}
                      selectedRoot={selectedPath()} selectedFile={ribbonSelection()} latestDetails={currentDetails()}
                      onFile={(root, path, staged) => { void openDirectoryFile(root, path, staged); }}
                      onRepository={root => { void openDirectoryRepository(root); }} />
                  </RetainedPane>
                  <RetainedPane active={!directoryChangesVisible()}>
                  <ChangesPane onCloseNavigation={() => toggleNavigation("files")} onWorkflow={requestWorkflow} onOpenEditor={openEditor} revision={repositoryRevision()}
                    pushFeedback={pushFeedback()} onRefresh={root => { if (root === selectedPath()) refreshSource(); }}
                    commitMessage={commitMessage()} onCommitMessageChange={onCommitMessageChange} onCommit={root => commit(root)}
                    canCommit={canCommit()} onComposerReady={registerComposer}
                    panelSizes={panelLayout.sizes()} onPanelResize={panelLayout.resize}
                    disabled={isScanning() || isOperating()}
                    details={detailState()}
                    operation={operationState()}
                    diff={diffState()}
                    tab={repositoryTab()}
                    onTabChange={changeRepositoryTab}
                    selectedCommitId={selectedHistoryCommit()}
                    onSelectCommit={selectCommit}
                    initialHistory={historyRestore()}
                    onHistoryNavigation={(value, path) => { if (path === selectedPath()) rememberCurrentSession(value); }}
                    onClearCommitSelection={clearCommitSelection}
                    previewedFile={previewedFile()}
                    onPreviewFile={(path) => { void previewFile(path); }}
                    onSelectFile={(path, staged) => { void selectFileDiff(path, staged); }}
                    onAction={(action, repositoryPath) => {
                      void performRepositoryAction(action, repositoryPath);
                    }}
                  />
                  </RetainedPane>
            </ResizablePanel>
            <ResizablePanel testID="git-sidebar" fixed visible={gitNavigationVisible() && hasRepositories()}
              size={Math.min(panelLayout.sizes().git, Math.max(PANEL_LIMITS.git.min, canvasSize().width - 328))}
              minSize={PANEL_LIMITS.git.min} maxSize={Math.max(PANEL_LIMITS.git.min, Math.min(PANEL_LIMITS.git.max, canvasSize().width - 328))}
              onResize={size => panelLayout.resize("git", size)} class="min-h-0 overflow-hidden bg-surface-muted">
                  {(() => {
                    const root = selectedPath();
                    return root ? <GitPane active={gitNavigationVisible()} repositoryPath={root} context={gitContext()} loading={contextLoading()} disabled={isScanning() || isOperating()}
                      request={workflowForm()?.root === root ? workflowForm()!.request : null}
                      onClose={() => toggleNavigation("git")} onRefresh={value => { if (value === selectedPath()) void refreshGitContext(value); }}
                      onRequest={requestWorkflow} onSwitch={(branch, value) => { void performRepositoryAction({ kind: "switchBranch", branchName: branch }, value); }}
                      onCancelRequest={() => workflowForm.set(null)} onPrepare={prepareWorkflow} onExecute={executeWorkflow} /> : null;
                  })()}
            </ResizablePanel>
            <ResizablePanel minSize={320} class="min-h-0 min-w-0 bg-background">{editorContent}</ResizablePanel>
          </ResizablePanelGroup>
          </View>
        </View>
      </View>

      <View class="h-6 flex-row items-center gap-2 border-t border-border bg-chrome px-2">
        <Text
          numberOfLines={1}
          class="min-w-0 flex-1 text-[11px] text-muted-foreground"
        >
          {currentDetails()
            ? fileNavigationVisible() && repositoryTab() === "changes" ? null
              : t("Unstaged") + " " + currentDetails()!.changes.filter(file => file.unstaged || file.untracked).length + "  ·  " + t("Staged") + " " + stagedFileCount()
            : activeSource()?.path ?? t("Add a repository or workspace directory to get started")}
        </Text>
        {(() => { const operation = operationState(); return operation.kind === "succeeded" ? <Text numberOfLines={1} class="max-w-96 text-[11px] text-success">{t(operation.message)}</Text> : null; })()}
      </View>
      {importDialog()}
      {setupClone() !== null ? <RepositorySetupDialog clone={setupClone()!} onClose={() => setupClone.set(null)}
        onCreated={(path) => addSource("repository", path)} /> : null}
      {settingsOpen() ? (
        <SettingsDialog
          error={settingsError()}
          section={settingsSection()}
          onSaved={() => settingsError.set(null)}
          installing={updateInstallRequested()}
          onInstallUpdate={installPendingUpdate}
          onClose={() => { settingsOpen.set(false); settingsSection.set(null); }}
        />
      ) : null}
    </View>
  );
}

function Root() {
  return <ErrorBoundary fallback={(error, reset) => <FailurePane error={error} reset={reset} />}><App /></ErrorBoundary>;
}

mount(Root);

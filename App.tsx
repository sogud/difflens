import { ReviewFileRibbon, type ReviewFileEntry } from "./components/ReviewFileRibbon";
import { GitOperationBanner } from "./components/GitOperationBanner";
import { IconButton } from "./components/IconButton";
import { Icon } from "./components/Icon";
import { preferences, updatePreferences } from "./preferences";
import { accentClasses, applyAppearance } from "./appearance";
import { createPanelLayout, panelGripClass, panelHandleClass, PANEL_LIMITS } from "./panel-layout";
import { restoreLanguage, t, type Message } from "./i18n";
import { cleanup, computed, effect, ErrorBoundary, mount, signal, Storage, Text, View, setAccessibilityFocus, type YNode } from "nsh";
import { loadDiagnostics } from "./diagnostics";
import { FailurePane } from "./components/FailurePane";
import { FilePreviewPane } from "./components/FilePreviewPane";
import { Menu as DesktopMenu, titleBar, Window } from "nsh/desktop";
import { Button, Input, Tab, Tabs, ResizablePanel, ResizablePanelGroup } from "nsh/base";
import {
  Workspace,
  type RepositoryDetails,
  type RepositoryNode,
  type WorkspaceScan,
  type ScanProgress,
  type GitContext, type GitOperationRequest, type GitOperationPlan, type GitOperationOutcome,
} from "difflens/native";
import { RepositorySetupDialog } from "./components/RepositorySetupDialog";
import { WorkflowDialog } from "./components/WorkflowDialog";
import { RepositoryToolsDialog } from "./components/RepositoryToolsDialog";
import { RetainedPane } from "./components/RetainedPane";
import { CommitReviewPane } from "./components/CommitReviewPane";
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

type Auxiliary = "none" | "repositories" | "files";
type ReviewPresentation =
  | { kind: "review"; auxiliary: Auxiliary; composer: boolean }
  | { kind: "focus"; restore: { auxiliary: Auxiliary; composer: boolean } };

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
      return "Commit created.";
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
  cleanup(() => {
    disposed = true;
    if (activeScan !== null) Workspace.stopScan(activeScan);
  });
  const loading = computed(() => sourceLoad().kind !== "idle");
  const picking = signal(false);
  const sourceError = signal<string | null>(null);
  const storageError = signal<string | null>(null);
  const importForm = signal<ImportForm | null>(null);
  const settingsOpen = signal(false);
  const toolsRoot = signal<string | null>(null);
  const setupClone = signal<boolean | null>(null);
  const workflowForm = signal<{ root: string; request: GitOperationRequest } | null>(null);
  const gitContextState = signal<{ root: string; value: GitContext } | null>(null);
  let contextRequest = 0;
  cleanup(() => { contextRequest += 1; });
  const settingsError = signal<string | null>(null);
  const scanState = signal<ScanState>({ kind: "idle" });
  const detailState = signal<DetailState>({ kind: "idle" });
  const diffState = signal<DiffState>({ kind: "idle" });
  const reviewView = signal<ReviewView>({ kind: "diff" });
  const previewCache = signal<{ repositoryPath: string; state: FilePreviewState } | null>(null);
  const repositoryRevision = signal(0);
  const repositoryTab = signal<RepositoryTab>("changes");
  const canvasSize = signal({ width: 1200, height: 700 });
  const presentation = signal<ReviewPresentation>({ kind: "review", auxiliary: "none", composer: false });
  const repositoryNavigationVisible = computed(() => { const state = presentation(); return state.kind === "review" && state.auxiliary === "repositories"; });
  const fileNavigationVisible = computed(() => { const state = presentation(); return state.kind === "review" && state.auxiliary === "files"; });
  const composerVisible = computed(() => { const state = presentation(); return state.kind === "review" && state.composer; });
  let repositoryOpener: YNode | undefined;
  let fileOpener: YNode | undefined;
  let composerOpener: YNode | undefined;
  let composerInput: YNode | undefined;
  let focusOpener: YNode | undefined;
  function toggleNavigation(auxiliary: Exclude<Auxiliary, "none">) {
    const state = presentation();
    const closing = state.kind === "review" && state.auxiliary === auxiliary;
    presentation.set({ kind: "review", auxiliary: closing ? "none" : auxiliary,
      composer: state.kind === "review" ? state.composer : state.restore.composer });
    if (closing) { const opener = auxiliary === "repositories" ? repositoryOpener : fileOpener; if (opener) setAccessibilityFocus(opener); }
  }
  function toggleFocus() {
    const state = presentation();
    presentation.set(state.kind === "focus" ? { kind: "review", ...state.restore }
      : { kind: "focus", restore: { auxiliary: state.auxiliary, composer: state.composer } });
    if (focusOpener) setAccessibilityFocus(focusOpener);
  }
  function toggleComposer() {
    const state = presentation();
    presentation.set(state.kind === "review" ? { ...state, composer: !state.composer }
      : { kind: "review", auxiliary: "none", composer: true });
    if (state.kind === "review" && state.composer) {
      if (composerOpener) setAccessibilityFocus(composerOpener);
    } else composerInput?.focus();
  }
  function openTask(tab: RepositoryTab) {
    const sameTask = repositoryTab() === tab;
    const state = presentation();
    changeRepositoryTab(tab);
    presentation.set({
      kind: "review",
      auxiliary: sameTask && state.kind === "review" && state.auxiliary === "files" ? "none" : "files",
      composer: state.kind === "review" ? state.composer : state.restore.composer,
    });
  }
  const workingSelection = signal<WorkingSelection | null>(null);
  const lastPreviewPath = signal<string | null>(null);
  const selectedHistoryCommit = signal<string | null>(null);
  const selectedHistoryFile = signal<string | null>(null);
  const historyRestore = signal<HistoryNavigation>(freshHistory());
  const sessionError = signal<string | null>(null);
  let repositorySessions: RepositorySessions = {};
  let sessionPersistenceEnabled = true;
  let sessionWrites: Promise<void> = Promise.resolve();
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
  const isOperating = computed(() => operationState().kind === "running");
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
  const currentDetails = computed(() => {
    const state = detailState();
    return state.kind === "ready" && state.details.path === selectedPath() ? state.details : null;
  });
  const ribbonEntries = computed<ReviewFileEntry[]>(() => {
    const files = currentDetails()?.changes ?? [];
    return [false, true].flatMap(staged => files.filter(file => staged ? file.staged : file.unstaged || file.untracked)
      .map(file => ({ key: (staged ? "staged:" : "unstaged:") + file.path, path: file.path,
        oldPath: file.oldPath ?? null, staged, statusLabel: file.statusLabel, conflicted: file.conflicted })));
  });
  const ribbonSelection = computed<WorkingSelection | null>(() => {
    const diff = diffState();
    return currentDetails() && diff.kind !== "idle" ? { path: diff.filePath, staged: diff.staged } : null;
  });
  const stagedFileCount = computed(() => currentDetails()?.changes.filter(file => file.staged).length ?? 0);
  const canCommit = computed(() => !isScanning() && !isOperating() && stagedFileCount() > 0 && commitMessage().trim().length > 0);
  function commit() {
    const root = selectedPath();
    if (root && canCommit()) void performRepositoryAction({ kind: "commit", message: commitMessage().trim() }, root);
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

  function rememberCurrentSession(history?: HistoryNavigation) {
    const path = selectedPath();
    if (!path || !libraryReady()) return;
    const previous = repositorySessions[path] ?? freshSession();
    rememberSession(repositorySessions, path, {
      ...previous, tab: repositoryTab(), commitMessage: commitMessage(), branchName: branchName(),
      workingFile: workingSelection(), previewPath: lastPreviewPath(),
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
    workingSelection.set(saved.workingFile);
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

  function saveLibrary() {
    if (!libraryReady()) return;
    const snapshot = JSON.stringify({
      sources: sources(),
      activeKey: activeKey(),
      mode: displayMode(),
    });
    void Storage.setItem(LIBRARY_STORAGE_KEY, snapshot).then(
      () => storageError.set(null),
      (error: unknown) =>
        storageError.set(
          t("Could not save your library: {error}", {
            error: getErrorMessage(error),
          }),
        ),
    );
  }

  async function loadRepositoryDetails(repositoryPath: string) {
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
      const firstFile =
        selectedFile ??
        details.changes.find((file) => file.unstaged || file.untracked) ??
        details.changes[0];
      if (firstFile) {
        await selectFileDiff(
          firstFile.path,
          selectedFile && previousSelection
            ? previousSelection.staged
            : !(firstFile.unstaged || firstFile.untracked),
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
    if (source && !isScanning() && !isOperating()) void loadSource(source);
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
      const source = saved.sources.find(
        (entry) => sourceKey(entry) === saved.activeKey,
      );
      if (source) await loadSource(source);
    } catch (error) {
      sourceError.set(getErrorMessage(error));
    } finally {
      libraryReady.set(true);
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
        const file = current.details.changes.find((file) => file.path === previous?.path) ??
          current.details.changes.find((file) => file.unstaged || file.untracked) ?? current.details.changes[0];
        if (file) void selectFileDiff(file.path, previous?.path === file.path && previous.staged ? file.staged : !(file.unstaged || file.untracked));
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
    reviewView.set({ kind: "file", state: { kind: "loading", path } });
    previewCache.set({ repositoryPath: repository, state: { kind: "loading", path } });
    rememberCurrentSession();
    try {
      const file = await Workspace.readFile(repository, path);
      if (request !== fileRequest || selectedPath() !== repository) return;
      reviewView.set({ kind: "file", state: { kind: "ready", file } });
      previewCache.set({ repositoryPath: repository, state: { kind: "ready", file } });
    } catch (error) {
      if (request !== fileRequest || selectedPath() !== repository) return;
      reviewView.set({ kind: "file", state: { kind: "failed", path, message: getErrorMessage(error) } });
      previewCache.set({ repositoryPath: repository, state: { kind: "failed", path, message: getErrorMessage(error) } });
    }
  }

  async function openWorktree(path: string) {
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

    reviewView.set({ kind: "diff" });
    const request = diffRequest() + 1;
    diffRequest.set(request);
    diffState.set({ kind: "loading", filePath, staged });
    workingSelection.set({ path: filePath, staged });
    rememberCurrentSession();
    try {
      const patch = await Workspace.diffFile(repositoryPath, filePath, staged);
      if (diffRequest() !== request || selectedPath() !== repositoryPath) {
        return;
      }
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
    const request = operationRequest() + 1;
    operationRequest.set(request);
    detailRequest.set(detailRequest() + 1);
    diffRequest.set(diffRequest() + 1);
    diffState.set({ kind: "idle" });
    fileRequest += 1;
    previewCache.set(null);
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
        case "push":
          details = await Workspace.push(repositoryPath);
          break;
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
      operationState.set({ kind: "succeeded", message: actionSuccess(action) });
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
      if (operationRequest() === request) {
        operationState.set({ kind: "failed", message: getErrorMessage(error) });
      }
    }
  }

  async function refreshGitContext(root: string | null) {
    const request = ++contextRequest;
    if (!root) { gitContextState.set(null); return; }
    try {
      const context = await Workspace.gitContext(root);
      if (request === contextRequest && selectedPath() === root) gitContextState.set({ root, value: context });
    } catch (cause) {
      if (request === contextRequest && selectedPath() === root) sourceError.set(getErrorMessage(cause));
    }
  }

  function requestWorkflow(request: GitOperationRequest, root: string) {
    if (isOperating() || isScanning() || selectedPath() !== root) return;
    toolsRoot.set(null);
    workflowForm.set({ root, request });
  }

  async function showTools(root: string) {
    if (isOperating() || isScanning()) return;
    if (selectedPath() !== root) await selectRepository(root);
    if (selectedPath() === root) toolsRoot.set(root);
  }

  function openEditor(path: string, root: string) {
    if (selectedPath() !== root || isOperating()) return;
    void Workspace.openWorkingFile(root, path).catch((cause: unknown) => sourceError.set(getErrorMessage(cause)));
  }

  async function executeWorkflow(plan: GitOperationPlan): Promise<GitOperationOutcome> {
    const root = selectedPath();
    if (!root || root !== plan.repositoryPath || isOperating()) throw new Error(t("Repository selection changed. Review the operation again."));
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
  const onBranchNameChange = (value: string) => { branchName.set(value); rememberCurrentSession(); };

  effect(() => {
    const disabled =
      isScanning() || isOperating() || importForm() !== null || settingsOpen() || workflowForm() !== null || toolsRoot() !== null || setupClone() !== null;
    const active = activeSource();
    Window.setTitle(
      active ? folderName(active.path) + " — DiffLens" : "DiffLens",
    );
    DesktopMenu.setApplicationMenu([
      {
        label: "DiffLens",
        submenu: [
          { role: "about", label: t("About DiffLens") },
          {
            label: t("Settings…"),
            shortcut: "mod+,",
            disabled: importForm() !== null,
            onSelect: () => settingsOpen.set(true),
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
          { role: "close", label: t("Close Window") },
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
          { label: t("Commit composer"), shortcut: "mod+shift+c", when: "notEditing", disabled,
            checked: composerVisible(), onSelect: toggleComposer },
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
        loadingMessage={loadingMessage()}
      />
    ) : null;
  });
  const hasRepositories = computed(() => (counts()?.total ?? 0) > 0);

  return (
    <View class="min-h-0 flex-1 flex-col bg-chrome text-foreground">
      <View class="bg-chrome">
        <View
          testID="window-toolbar"
          desktop={{ windowDrag: true }}
          style={{
            height: Math.max(36, titleBar().height),
            paddingLeft: titleBar().left + 12,
            paddingRight: titleBar().right + 12,
          }}
          class="flex-row items-center gap-1.5"
        >
          <Icon name="lens" size={13} />
          <Text class="text-[12px] font-semibold text-foreground">DiffLens</Text>
          <Button ref={node => { repositoryOpener = node; }} testID="toggle-repository-drawer" accessibilityLabel={t("Repository navigation")}
            onPress={() => toggleNavigation("repositories")} class="h-7 min-w-0 shrink flex-row items-center gap-1.5 pl-3 pr-2 hover:bg-muted/40">
            <Text numberOfLines={1} class="max-w-44 text-[12px] font-medium text-foreground">{currentDetails() ? folderName(currentDetails()!.path) : t("Repositories")}</Text>
            {currentDetails() ? <>
              <Icon name="worktree" size={12} muted />
              <Text numberOfLines={1} class="max-w-48 font-mono text-[11px] text-muted-foreground">{currentDetails()!.branchName ?? currentDetails()!.headLabel}</Text>
            </> : null}
          </Button>
          <View class="min-w-0 flex-1" />
          {currentDetails() ? <Text class="pr-2 text-[10px] text-muted-foreground">{t("{count} files", { count: currentDetails()!.changes.length })}</Text> : null}
          <IconButton icon="pull" label={t("Pull")} compact disabled={isScanning() || isOperating() || !currentDetails()?.hasUpstream}
            onPress={() => { const root = selectedPath(); if (root) void performRepositoryAction({ kind: "pull" }, root); }} />
          <IconButton icon="push" label={t("Push")} compact disabled={isScanning() || isOperating() || !currentDetails()?.remoteNames.length}
            onPress={() => { const root = selectedPath(); if (root) void performRepositoryAction({ kind: "push" }, root); }} />
          <IconButton icon="more" label={t("Git actions")} compact disabled={!currentDetails() || isScanning() || isOperating()}
            onPress={() => { const root = selectedPath(); if (root) void showTools(root); }} />
        </View>
        {isScanning() && !picking() ? (
          <View class="px-3 pb-2"><LoadingStatus
            testID="source-loading"
            label={loadingMessage()}
            path={loadingPath()}
            hint={
              sourceLoad().kind === "scanning"
                ? t("Large directories may take a moment.")
                : undefined
            }
          /></View>
        ) : null}
        {(() => {
          const scan = backgroundScan();
          if (scan.kind !== "running") return null;
          return <View testID="background-scan" class="flex-row items-center gap-2 px-3 pb-2">
            <View class="min-w-0 flex-1"><LoadingStatus label={t(scan.discovering ? "Scanning in background · {count} repositories" : "Refreshing cached repositories · {count} repositories", { count: scan.found })} /></View>
            <IconButton icon="stop" testID="stop-scan" label={t("Stop scanning")} compact onPress={stopBackgroundScan} />
          </View>;
        })()}
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

      <View class="min-h-0 flex-1 flex-row border-t border-border">
        <View testID="review-navigation-rail" class={presentation().kind === "focus" ? "hidden" : "w-[42px] shrink-0 items-center gap-1 border-r border-border bg-chrome py-1"}>
          <IconButton ref={node => { fileOpener = node; }} icon="nested" testID="changes-tab" label={t("Changes")}
            selected={repositoryTab() === "changes"} disabled={!hasRepositories()} onPress={() => openTask("changes")} />
          <IconButton icon="file" testID="files-tab" label={t("Files")}
            selected={repositoryTab() === "files"} disabled={!hasRepositories()} onPress={() => openTask("files")} />
          <IconButton icon="history" testID="history-tab" label={t("History")}
            selected={repositoryTab() === "history"} disabled={!hasRepositories()} onPress={() => openTask("history")} />
          <View class="my-1 h-px w-5 bg-border" />
          <IconButton icon="worktree" testID="open-git-tools" label={t("Git actions")} disabled={!currentDetails() || isScanning() || isOperating()}
            onPress={() => { const root = selectedPath(); if (root) void showTools(root); }} />
          <View class="min-h-0 flex-1" />
          <IconButton icon="settings" testID="open-settings" label={t("Settings")} hint={t("Settings (⌘,)")} onPress={() => settingsOpen.set(true)} />
        </View>
        <View class="min-h-0 min-w-0 flex-1">
          {(() => {
            const operation = operationState();
            return operation.kind === "running" ? <View testID="review-operation" class="px-3 py-1"><LoadingStatus label={t(operation.label) + "…"} /></View>
              : operation.kind === "failed" ? <Text testID="review-operation-error" class="px-3 py-1 text-[11px] text-destructive">{operation.message}</Text>
              : null;
          })()}
          {detailState().kind === "loading" && !fileNavigationVisible() ? <View class="px-3 py-1"><LoadingStatus label={t("Reading repository")} /></View> : null}
          {detailState().kind === "failed" ? <Text testID="review-detail-error" class="px-3 py-1 text-[11px] text-destructive">{(detailState() as Extract<DetailState, { kind: "failed" }>).message}</Text> : null}
          <GitOperationBanner context={gitContext()} disabled={isScanning() || isOperating()}
            onRequest={request => { const root = selectedPath(); if (root) requestWorkflow(request, root); }} />
          <View onLayout={bounds => canvasSize.set({ width: bounds.size.width, height: bounds.size.height })} style={{ flexDirection: "row-reverse" }} class="relative min-h-0 min-w-0 flex-1 bg-background">
            <View testID="review-canvas" class="relative min-h-0 min-w-0 flex-1">
              <ReviewFileRibbon entries={ribbonEntries()} selection={ribbonSelection()}
                visible={presentation().kind === "review" && repositoryTab() === "changes" && hasRepositories()}
                disabled={isScanning() || isOperating() || !currentDetails()} navigationOpen={fileNavigationVisible()}
                onToggleNavigation={() => toggleNavigation("files")} onSelect={(path, staged) => { void selectFileDiff(path, staged); }} />
              <View class="relative min-h-0 min-w-0 flex-1">
              <View class="absolute right-2 top-0 z-10 h-[34px] w-32 items-end justify-center">
                <Button ref={node => { focusOpener = node; }} testID="toggle-review-focus" accessibilityLabel={t(presentation().kind === "focus" ? "Restore navigation" : "Focus review")}
                  selected={presentation().kind === "focus"} onPress={toggleFocus} class="h-6 max-w-32 flex-row items-center gap-1 px-1.5 hover:bg-muted/50 selected:bg-muted/50">
                  <Icon name="focus" size={14} muted />
                  <Text numberOfLines={1} class="min-w-0 text-[10px] text-muted-foreground">{t(presentation().kind === "focus" ? "Exit focus" : "Focus")}</Text>
                </Button>
              </View>
              {hasRepositories() ? (
                <>
                  <RetainedPane active={repositoryTab() === "changes"}><DiffPane diff={diffState()} /></RetainedPane>
                  <RetainedPane active={repositoryTab() === "files"}><FilePreviewPane state={previewState()} /></RetainedPane>
                  <RetainedPane active={repositoryTab() === "history"}>
                    {(() => {
                      const root = selectedPath();
                      const id = selectedHistoryCommit();
                      return root && id ? <CommitReviewPane onWorkflow={(request) => requestWorkflow(request, root)} panelSizes={panelLayout.sizes()} onPanelResize={panelLayout.resize}
                        disabled={isScanning() || isOperating()} repositoryPath={root} commitId={id}
                        initialFilePath={selectedHistoryFile()} onFileSelection={(path) => {
                          if (selectedPath() === root && selectedHistoryCommit() === id) {
                            selectedHistoryFile.set(path); rememberCurrentSession();
                          }
                        }} onBack={() => changeRepositoryTab("changes")} />
                        : <View class="flex-1 items-center justify-center p-4"><Text class="text-[12px] text-muted-foreground">{t("Select a commit to review its files and diff.")}</Text></View>;
                    })()}
                  </RetainedPane>
                </>
              ) : (
                <WelcomePane
                  busy={isScanning() || backgroundScan().kind === "running"}
                  loadingMessage={backgroundScan().kind === "running" ? t("Scanning nested repositories…") : loadingMessage()}
                  emptyDirectory={scanState().kind === "ready" && inventoryComplete() && backgroundScan().kind !== "running"}
                  onChoose={(kind) => {
                    void chooseSource(kind);
                  }}
                  onEnterPath={enterPath}
                />
              )}
              </View>
            </View>
            <View testID="repository-drawer" class={repositoryNavigationVisible() ? "relative min-h-0 shrink-0 overflow-hidden border-r border-border bg-chrome" : "hidden"}
              style={{ width: Math.min(panelLayout.sizes().sidebar, Math.max(PANEL_LIMITS.sidebar.min, canvasSize().width - 320)) + 8 }}>
              <View class="h-8 flex-row items-center justify-between border-b border-border px-2"><Text class="text-[11px] text-muted-foreground">{t("Repositories")}</Text>
                <IconButton icon="stop" compact label={t("Close navigation")} testID="close-repository-drawer" onPress={() => toggleNavigation("repositories")} /></View>
              <ResizablePanelGroup axis="horizontal" class="min-h-0 flex-1" style={{ width: Math.min(PANEL_LIMITS.sidebar.max + 8, canvasSize().width * .9) }} handleClass={panelHandleClass()} handleThumbClass={panelGripClass()} handleAccessibilityLabel={t("Resize sidebar")}>
                <ResizablePanel fixed visible={repositoryNavigationVisible()} size={Math.min(panelLayout.sizes().sidebar, Math.max(PANEL_LIMITS.sidebar.min, canvasSize().width - 320))} minSize={PANEL_LIMITS.sidebar.min} maxSize={Math.max(PANEL_LIMITS.sidebar.min, Math.min(PANEL_LIMITS.sidebar.max, canvasSize().width - 320))}
                  onResize={size => panelLayout.resize("sidebar", size)} class="min-h-0">
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
                <ResizablePanel minSize={8} class="min-h-0" />
              </ResizablePanelGroup>
            </View>
            <View testID="file-drawer" class={fileNavigationVisible() && hasRepositories() ? "relative min-h-0 shrink-0 overflow-hidden border-r border-border bg-background" : "hidden"}
              style={{ width: Math.min(panelLayout.sizes().navigation, Math.max(PANEL_LIMITS.navigation.min, canvasSize().width - 320)) + 8 }}>
              <View class="h-8 flex-row items-center border-b border-border bg-surface-muted px-2">
                <Tabs class="min-w-0 flex-1 flex-row items-center gap-3">
                  <Tab selected={repositoryTab() === "changes"} onPress={() => changeRepositoryTab("changes")} class={"group h-8 justify-center border-b border-transparent " + accentClasses().tab}>
                    <Text class="text-[11px] text-muted-foreground group-selected:text-foreground">{t("Changes")}</Text></Tab>
                  <Tab selected={repositoryTab() === "files"} onPress={() => changeRepositoryTab("files")} class={"group h-8 justify-center border-b border-transparent " + accentClasses().tab}>
                    <Text class="text-[11px] text-muted-foreground group-selected:text-foreground">{t("Files")}</Text></Tab>
                  <Tab selected={repositoryTab() === "history"} onPress={() => changeRepositoryTab("history")} class={"group h-8 justify-center border-b border-transparent " + accentClasses().tab}>
                    <Text class="text-[11px] text-muted-foreground group-selected:text-foreground">{t("History")}</Text></Tab>
                </Tabs>
                {repositoryTab() === "changes" ? <IconButton icon={preferences().changeView === "tree" ? "flat" : "nested"} compact testID="toggle-changed-file-view"
                  label={t(preferences().changeView === "tree" ? "View changes as list" : "View changes as tree")}
                  onPress={() => {
                    sourceError.set(null);
                    void updatePreferences({ changeView: preferences().changeView === "tree" ? "list" : "tree" })
                      .catch(cause => sourceError.set(t("Could not save settings: {error}", { error: getErrorMessage(cause) })));
                  }} /> : null}
                <IconButton icon="stop" compact label={t("Close navigation")} testID="close-file-drawer" onPress={() => toggleNavigation("files")} />
              </View>
              <ResizablePanelGroup axis="horizontal" class="min-h-0 flex-1" style={{ width: Math.min(PANEL_LIMITS.navigation.max + 8, canvasSize().width * .9) }} handleClass={panelHandleClass()} handleThumbClass={panelGripClass()} handleAccessibilityLabel={t("Resize review panes")}>
                <ResizablePanel fixed visible={fileNavigationVisible()} size={Math.min(panelLayout.sizes().navigation, Math.max(PANEL_LIMITS.navigation.min, canvasSize().width - 320))} minSize={PANEL_LIMITS.navigation.min} maxSize={Math.max(PANEL_LIMITS.navigation.min, Math.min(PANEL_LIMITS.navigation.max, canvasSize().width - 320))}
                  onResize={size => panelLayout.resize("navigation", size)} class="min-h-0">
                  <ChangesPane onWorkflow={requestWorkflow} onOpenEditor={openEditor} revision={repositoryRevision()}
                    panelSizes={panelLayout.sizes()} onPanelResize={panelLayout.resize}
                    disabled={isScanning()}
                    details={detailState()}
                    operation={operationState()}
                    diff={diffState()}
                    branchName={branchName()}
                    onBranchNameChange={onBranchNameChange}
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
                </ResizablePanel>
                <ResizablePanel minSize={8} class="min-h-0" />
              </ResizablePanelGroup>
            </View>
            <View testID="commit-composer" class={composerVisible() && hasRepositories() ? "absolute left-0 right-0 bottom-0 z-30 overflow-hidden border-t border-border bg-surface-muted" : "hidden"}
              style={{ left: repositoryNavigationVisible()
                ? Math.min(panelLayout.sizes().sidebar, Math.max(PANEL_LIMITS.sidebar.min, canvasSize().width - 320)) + 8
                : fileNavigationVisible() ? Math.min(panelLayout.sizes().navigation, Math.max(PANEL_LIMITS.navigation.min, canvasSize().width - 320)) + 8 : 0,
                height: Math.min(panelLayout.sizes().composer + 40, canvasSize().height) }}>
              <ResizablePanelGroup axis="vertical" class="absolute left-0 right-0 bottom-0" style={{ height: Math.min(PANEL_LIMITS.composer.max + 40, canvasSize().height) }}
                handleClass={panelHandleClass()} handleThumbClass={panelGripClass()} handleAccessibilityLabel={t("Resize commit composer")}>
                <ResizablePanel minSize={8} />
                <ResizablePanel fixed size={Math.min(panelLayout.sizes().composer + 32, canvasSize().height - 8)} minSize={PANEL_LIMITS.composer.min + 32} maxSize={PANEL_LIMITS.composer.max + 32}
                  onResize={size => panelLayout.resize("composer", size - 32)} class="min-h-0 bg-surface-muted">
                  <View class="h-7 flex-row items-center justify-between px-3"><Text class="text-[11px] text-muted-foreground">{t("Commit composer")}</Text>
                    <IconButton icon="stop" compact testID="close-commit-composer" label={t("Close composer")} onPress={toggleComposer} /></View>
                  <View class="min-h-0 flex-1 gap-1.5 px-3 pb-2">
                    <Input ref={node => { composerInput = node; }} testID="commit-message" value={commitMessage()} onChange={onCommitMessageChange} multiline submitBehavior="newline"
                      disabled={isScanning() || isOperating()} placeholder={t("Commit message")} accessibilityLabel={t("Commit message")} onSubmit={commit}
                      class={"min-h-0 flex-1 rounded bg-subtle-input px-2 py-1 text-[12px] text-foreground focus:bg-background " + accentClasses().focus} />
                    <View class="flex-row items-center justify-between gap-2">
                      <Text class="text-[11px] text-muted-foreground">{t(stagedFileCount() === 1 ? "{count} staged file" : "{count} staged files", { count: stagedFileCount() })}</Text>
                      <Button testID="commit-staged" disabled={!canCommit()} onPress={commit} class={"h-7 justify-center rounded px-3 disabled:opacity-35 " + accentClasses().fill}>
                        <Text class={"text-[11px] " + accentClasses().foreground}>{t("Commit staged")}</Text></Button>
                    </View>
                  </View>
                </ResizablePanel>
              </ResizablePanelGroup>
            </View>
          </View>
        </View>
      </View>

      <View class="h-6 flex-row items-center gap-2 border-t border-border bg-chrome px-2">
        <Text
          numberOfLines={1}
          class="min-w-0 flex-1 text-[11px] text-muted-foreground"
        >
          {currentDetails()
            ? t("Unstaged") + " " + currentDetails()!.changes.filter(file => file.unstaged || file.untracked).length + "  ·  " + t("Staged") + " " + stagedFileCount()
            : activeSource()?.path ?? t("Add a repository or workspace directory to get started")}
        </Text>
        {(() => { const operation = operationState(); return operation.kind === "succeeded" ? <Text numberOfLines={1} class="max-w-72 text-[10px] text-success">{t(operation.message)}</Text> : null; })()}
        <Button ref={node => { composerOpener = node; }} testID="toggle-commit-composer" accessibilityLabel={t("Commit composer")}
          disabled={!hasRepositories()} onPress={toggleComposer} class="h-6 shrink-0 justify-center px-1 hover:bg-muted/40">
          <Text class="text-[10px] text-muted-foreground">{t("Commit message")}</Text>
        </Button>
        <Text class="shrink-0 text-[10px] text-muted-foreground">⌘⇧F</Text>
      </View>
      {importDialog()}
      {setupClone() !== null ? <RepositorySetupDialog clone={setupClone()!} onClose={() => setupClone.set(null)}
        onCreated={(path) => addSource("repository", path)} /> : null}
      {toolsRoot() ? <RepositoryToolsDialog repositoryPath={toolsRoot()!} onClose={() => toolsRoot.set(null)}
        onRequest={(request) => requestWorkflow(request, toolsRoot()!)} onSwitch={(branch) => {
          const root = toolsRoot(); toolsRoot.set(null); if (root) void performRepositoryAction({ kind: "switchBranch", branchName: branch }, root);
        }} /> : null}
      {workflowForm() ? <WorkflowDialog repositoryPath={workflowForm()!.root} request={workflowForm()!.request}
        onCancel={() => workflowForm.set(null)} onExecute={executeWorkflow} /> : null}
      {settingsOpen() ? (
        <SettingsDialog
          error={settingsError()}
          onSaved={() => settingsError.set(null)}
          onClose={() => settingsOpen.set(false)}
        />
      ) : null}
    </View>
  );
}

function Root() {
  return <ErrorBoundary fallback={(error, reset) => <FailurePane error={error} reset={reset} />}><App /></ErrorBoundary>;
}

mount(Root);

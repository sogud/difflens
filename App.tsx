import { restoreLanguage, t, type Message } from "./i18n";
import { cleanup, computed, effect, ErrorBoundary, mount, signal, Text, View } from "nsh";
import { loadDiagnostics } from "./diagnostics";
import { FailurePane } from "./components/FailurePane";
import { Icon } from "./components/Icon";
import { FilePreviewPane } from "./components/FilePreviewPane";
import { Menu as DesktopMenu, titleBar, Window } from "nsh/desktop";
import { Storage } from "nsh/storage";
import { Button, ResizablePanel, ResizablePanelGroup } from "nsh/base";
import {
  Workspace,
  type RepositoryDetails,
  type RepositoryNode,
  type WorkspaceScan,
  type ScanProgress,
} from "difflens/native";
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
import type {
  DetailState,
  DiffState,
  DisplayMode,
  OperationState,
  ReviewView,
  RepositoryTab,
  RepositoryAction,
} from "./ui-types";

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
  const settingsError = signal<string | null>(null);
  const scanState = signal<ScanState>({ kind: "idle" });
  const detailState = signal<DetailState>({ kind: "idle" });
  const diffState = signal<DiffState>({ kind: "idle" });
  const reviewView = signal<ReviewView>({ kind: "diff" });
  const repositoryTab = signal<RepositoryTab>("changes");
  let fileRequest = 0;
  const previewedFile = computed(() => {
    const view = reviewView();
    return view.kind === "file" ? (view.state.kind === "ready" ? view.state.file.path : view.state.path) : null;
  });
  const associatedWorktrees = computed(() => {
    const state = detailState();
    return state.kind === "ready" ? state.details.worktrees : [];
  });
  const operationState = signal<OperationState>({ kind: "idle" });
  const displayMode = signal<DisplayMode>("nested");
  const commitMessage = signal("");
  const branchName = signal("");
  const repositoryPanelSize = signal(240);
  const changesPanelSize = signal(340);
  const scanRequest = signal(0);
  const detailRequest = signal(0);
  const diffRequest = signal(0);
  const operationRequest = signal(0);

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
    const existingPreview = previewedFile();
    const request = detailRequest() + 1;
    detailRequest.set(request);
    detailState.set({ kind: "loading" });
    try {
      const details = await Workspace.inspectRepository(repositoryPath);
      if (detailRequest() !== request || selectedPath() !== repositoryPath) {
        return;
      }
      detailState.set({ kind: "ready", details });
      if (existingPreview) {
        await previewFile(existingPreview);
        return;
      }
      const previousDiff = diffState();
      const selectedFile =
        previousDiff.kind === "idle"
          ? undefined
          : details.changes.find(
              (file) =>
                file.path === previousDiff.filePath &&
                (previousDiff.staged
                  ? file.staged
                  : file.unstaged || file.untracked),
            );
      const firstFile =
        selectedFile ??
        details.changes.find((file) => file.unstaged || file.untracked) ??
        details.changes[0];
      if (firstFile) {
        await selectFileDiff(
          firstFile.path,
          selectedFile && previousDiff.kind !== "idle"
            ? previousDiff.staged
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
            scanState.set({ kind: "ready", result: { ...progress.scan, repositories }, selectedPath: path });
            if (path !== current.selectedPath) {
              fileRequest += 1;
              reviewView.set({ kind: "diff" });
              diffState.set({ kind: "idle" });
              commitMessage.set("");
              branchName.set("");
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
      if (!sameSelection) {
        fileRequest += 1;
        reviewView.set({ kind: "diff" });
        diffState.set({ kind: "idle" });
        commitMessage.set("");
        branchName.set("");
      }
      sources.set(
        sources().some((entry) => sourceKey(entry) === key)
          ? sources().map((entry) =>
              sourceKey(entry) === key ? nextSource : entry,
            )
          : [...sources(), nextSource],
      );
      activeKey.set(key);
      scanState.set({ kind: "ready", result, selectedPath: nextPath });
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

    fileRequest += 1;
    reviewView.set({ kind: "diff" });
    diffRequest.set(diffRequest() + 1);
    diffState.set({ kind: "idle" });
    operationState.set({ kind: "idle" });
    commitMessage.set("");
    branchName.set("");
    scanState.set({ ...current, selectedPath: repositoryPath });
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

  async function previewFile(path: string) {
    const repository = selectedPath();
    if (!repository || isOperating()) return;
    const request = ++fileRequest;
    reviewView.set({ kind: "file", state: { kind: "loading", path } });
    try {
      const file = await Workspace.readFile(repository, path);
      if (request !== fileRequest || selectedPath() !== repository) return;
      reviewView.set({ kind: "file", state: { kind: "ready", file } });
    } catch (error) {
      if (request !== fileRequest || selectedPath() !== repository) return;
      reviewView.set({ kind: "file", state: { kind: "failed", path, message: getErrorMessage(error) } });
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

    fileRequest += 1;
    reviewView.set({ kind: "diff" });
    const request = diffRequest() + 1;
    diffRequest.set(request);
    diffState.set({ kind: "loading", filePath, staged });
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

  async function performRepositoryAction(action: RepositoryAction) {
    const currentScan = scanState();
    if (
      currentScan.kind !== "ready" ||
      !currentScan.selectedPath ||
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
      operationState.set({ kind: "succeeded", message: actionSuccess(action) });
      if (action.kind === "commit") {
        commitMessage.set("");
      }
      if (action.kind === "createBranch") {
        branchName.set("");
      }
      const openFile = previewedFile();
      if (openFile) await previewFile(openFile);
    } catch (error) {
      if (operationRequest() === request) {
        operationState.set({ kind: "failed", message: getErrorMessage(error) });
      }
    }
  }

  const onDisplayModeChange = (mode: DisplayMode) => {
    displayMode.set(mode);
    saveLibrary();
  };
  const onCommitMessageChange = (value: string) => commitMessage.set(value);
  const onBranchNameChange = (value: string) => branchName.set(value);

  effect(() => {
    const disabled =
      isScanning() || isOperating() || importForm() !== null || settingsOpen();
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
  const summary = computed(() => {
    const count = counts();
    return count
      ? t("{total} repositories · {changed} changed", {
          total: count.total,
          changed: count.changed,
        })
      : t("Local repositories");
  });
  const hasRepositories = computed(() => (counts()?.total ?? 0) > 0);

  return (
    <View class="min-h-0 flex-1 flex-col bg-background text-foreground">
      <View class="border-b border-border">
        <View
          testID="window-toolbar"
          desktop={{ windowDrag: true }}
          style={{
            height: Math.max(40, titleBar().height),
            paddingLeft: titleBar().left + 12,
            paddingRight: titleBar().right + 12,
          }}
          class="flex-row items-center gap-1.5"
        >
          <Text class="text-[13px] font-semibold text-foreground">
            DiffLens
          </Text>
          <Text class="min-w-0 flex-1 pl-2 text-[11px] text-muted-foreground">
            {summary()}
          </Text>
          <Button
            disabled={isScanning() || isOperating()}
            onPress={() => {
              void chooseSource("repository");
            }}
            accessibilityLabel={t("Add existing repository")}
            tooltip={t("Add repository (⌘O)")}
            class="size-7 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-40"
          >
            <Icon name="addRepository" />
          </Button>
          <Button
            disabled={isScanning() || isOperating()}
            onPress={() => {
              void chooseSource("directory");
            }}
            accessibilityLabel={t("Add workspace directory")}
            tooltip={t("Add directory (⇧⌘O)")}
            class="size-7 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-40"
          >
            <Icon name="addDirectory" />
          </Button>
          <Button
            disabled={isScanning() || isOperating() || !activeSource()}
            onPress={refreshSource}
            accessibilityLabel={t("Refresh current source")}
            tooltip={t("Refresh (⌘R)")}
            class="size-7 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-40"
          >
            <Icon name="refresh" spinning={loading() || backgroundScan().kind === "running"} />
          </Button>
          {activeSource()?.kind === "directory" ? <Button
            testID="rescan-source"
            accessibilityLabel={t("Rescan repositories")}
            tooltip={t("Rescan repositories (⇧⌘R)")}
            disabled={isScanning() || isOperating()}
            onPress={rescanSource}
            class="size-7 items-center justify-center rounded hover:bg-muted disabled:opacity-40"
          ><Icon name="rescan" /></Button> : null}
          <Button
            testID="open-settings"
            accessibilityLabel={t("Settings")}
            tooltip={t("Settings (⌘,)")}
            onPress={() => settingsOpen.set(true)}
            class="size-7 items-center justify-center rounded hover:bg-muted active:bg-muted"
          >
            <Icon name="settings" />
          </Button>
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
            <Button testID="stop-scan" accessibilityLabel={t("Stop scanning")} tooltip={t("Stop scanning")} onPress={stopBackgroundScan}
              class="size-6 items-center justify-center rounded hover:bg-muted"><Icon name="stop" size={13} /></Button>
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
      </View>

      <ResizablePanelGroup
        axis="horizontal"
        handleClass="w-[3px] bg-border group-hover:bg-muted-foreground group-active:bg-primary"
        handleAccessibilityLabel={t("Resize adjacent panels")}
        class="min-h-0 flex-1"
      >
        <ResizablePanel
          size={repositoryPanelSize()}
          minSize={200}
          maxSize={360}
          onResize={(size) => repositoryPanelSize.set(size)}
          class="min-h-0"
        >
          <RepositoryPane
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
            onSelect={(path) => {
              void selectRepository(path);
            }}
          />
        </ResizablePanel>
        {hasRepositories() ? (
          <ResizablePanel
            size={changesPanelSize()}
            minSize={300}
            maxSize={520}
            onResize={(size) => changesPanelSize.set(size)}
            class="min-h-0"
          >
            <ChangesPane
              disabled={isScanning()}
              details={detailState()}
              operation={operationState()}
              diff={diffState()}
              commitMessage={commitMessage()}
              branchName={branchName()}
              onCommitMessageChange={onCommitMessageChange}
              onBranchNameChange={onBranchNameChange}
              tab={repositoryTab()}
              onTabChange={(tab) => repositoryTab.set(tab)}
              previewedFile={previewedFile()}
              onPreviewFile={(path) => { void previewFile(path); }}
              onSelectFile={(path, staged) => {
                void selectFileDiff(path, staged);
              }}
              onAction={(action) => {
                void performRepositoryAction(action);
              }}
            />
          </ResizablePanel>
        ) : null}
        <ResizablePanel minSize={240} class="min-h-0 min-w-0">
          {hasRepositories() ? (
            (() => { const view = reviewView(); return view.kind === "file" ? <FilePreviewPane state={view.state} /> : <DiffPane diff={diffState()} />; })()
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
        </ResizablePanel>
      </ResizablePanelGroup>

      <View class="h-6 flex-row items-center justify-between border-t border-border px-2">
        <Text
          numberOfLines={1}
          class="min-w-0 flex-1 text-[11px] text-muted-foreground"
        >
          {selectedPath() ??
            activeSource()?.path ??
            t("Add a repository or workspace directory to get started")}
        </Text>
        <Text class="pl-3 text-[11px] text-muted-foreground">
          {isScanning() ? loadingMessage() : t("Ready")}
        </Text>
      </View>
      {importDialog()}
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

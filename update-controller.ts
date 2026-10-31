import { signal } from "nsh";
import { Updater, type UpdateStatus } from "difflens/native";
import { preferences } from "./preferences";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DOWNLOAD_POLL_MS = 300;

const initialStatus: UpdateStatus = {
  phase: "idle",
  supported: false,
  currentVersion: "",
  currentBuild: 0,
  channel: "beta",
  version: null,
  build: null,
  releaseUrl: null,
  receivedBytes: 0,
  totalBytes: 0,
  error: null,
};

export const updateStatus = signal<UpdateStatus>(initialStatus);

let started = false;
let stopped = false;
let healthyMarked = false;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let activeCheck: Promise<void> | null = null;
let activeDownload: Promise<void> | null = null;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Reads the native snapshot without starting a job. */
export function refreshUpdateStatus(): void {
  try {
    updateStatus.set(Updater.state());
  } catch {
    // The snapshot is best effort; a failed read leaves the last known status.
  }
}

function fail(cause: unknown): void {
  try {
    const snapshot = Updater.state();
    if (snapshot.phase === "failed" && snapshot.error) {
      updateStatus.set(snapshot);
      return;
    }
  } catch {
    // Fall through to the local failure snapshot.
  }
  updateStatus.set({ ...updateStatus(), phase: "failed", error: errorMessage(cause) });
}

function stopPolling(): void {
  if (pollTimer !== undefined) clearTimeout(pollTimer);
  pollTimer = undefined;
}

function schedulePoll(): void {
  pollTimer = setTimeout(() => {
    pollTimer = undefined;
    if (stopped) return;
    refreshUpdateStatus();
    if (updateStatus().phase === "downloading") schedulePoll();
  }, DOWNLOAD_POLL_MS);
}

function scheduleNextCheck(): void {
  if (checkTimer !== undefined) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkTimer = undefined;
    if (stopped) return;
    refreshUpdateStatus();
    if (preferences().automaticUpdates && updateStatus().phase !== "recovered") void checkForUpdates();
    scheduleNextCheck();
  }, CHECK_INTERVAL_MS);
}

/** Starts the background schedule once preferences have been restored. */
export function startUpdateController(): void {
  if (started) return;
  started = true;
  stopped = false;
  refreshUpdateStatus();
  if (preferences().automaticUpdates && updateStatus().phase !== "recovered") void checkForUpdates();
  scheduleNextCheck();
}

export function stopUpdateController(): void {
  started = false;
  stopped = true;
  if (checkTimer !== undefined) clearTimeout(checkTimer);
  checkTimer = undefined;
  stopPolling();
}

export async function checkForUpdates(): Promise<void> {
  if (!started || stopped || activeCheck !== null) return;
  const current = updateStatus();
  if (!current.supported) return;
  if (current.phase === "downloading" || current.phase === "installing" || current.phase === "ready") return;

  updateStatus.set({ ...current, phase: "checking", error: null });
  const run = (async () => {
    try {
      const next = await Updater.check();
      if (!stopped) updateStatus.set(next);
    } catch (cause) {
      if (!stopped) fail(cause);
    }
  })();
  activeCheck = run;
  try {
    await run;
  } finally {
    if (activeCheck === run) activeCheck = null;
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!started || stopped || activeDownload !== null || activeCheck !== null) return;
  if (updateStatus().phase !== "available") return;

  updateStatus.set({ ...updateStatus(), phase: "downloading", error: null, receivedBytes: 0 });
  schedulePoll();
  const run = (async () => {
    try {
      const next = await Updater.download();
      if (!stopped) updateStatus.set(next);
    } catch (cause) {
      if (!stopped) fail(cause);
    } finally {
      stopPolling();
    }
  })();
  activeDownload = run;
  try {
    await run;
  } finally {
    if (activeDownload === run) activeDownload = null;
  }
}

export async function installUpdate(): Promise<void> {
  if (!started || stopped) throw new Error("Updates are not available.");
  if (updateStatus().phase !== "ready") throw new Error("The update is not ready to install.");
  updateStatus.set({ ...updateStatus(), phase: "installing", error: null });
  try {
    await Updater.install();
    if (!stopped) refreshUpdateStatus();
  } catch (cause) {
    if (!stopped) fail(cause);
    throw cause;
  }
}

/** Startup receipt; native ignores it when no install ticket is pending. */
export function markUpdateHealthy(): void {
  if (healthyMarked) return;
  healthyMarked = true;
  void Updater.markHealthy().catch(() => undefined);
}

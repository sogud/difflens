import { cleanup, effect, signal, untracked } from "nsh";

type ActivityKind = "operation" | "source" | "diff" | "preview" | "commit" | "repository" | "history" | "files" | "scan";
export interface UiActivity {
  kind: ActivityKind;
  label: string;
  detail?: string;
  cancel?: () => void;
}
const priority: Record<ActivityKind, number> = {
  operation: 100, source: 90, diff: 80, preview: 75, commit: 70,
  repository: 60, history: 50, files: 40, scan: 10,
};
const activities = signal<ReadonlyMap<number, { value: UiActivity; sequence: number }>>(new Map());
let nextOwner = 0;
let nextSequence = 0;

const SHOW_DELAY = 130;
const MIN_VISIBLE = 220;

type SelectedActivity = { owner: number; value: UiActivity; sequence: number };
type ActivityPresentation =
  | { kind: "hidden" }
  | { kind: "pending"; owner: number; sequence: number; activity: UiActivity }
  | { kind: "visible"; owner: number; sequence: number; activity: UiActivity; since: number };

const presentation = signal<ActivityPresentation>({ kind: "hidden" });
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function clearShowTimer() {
  if (showTimer !== undefined) clearTimeout(showTimer);
  showTimer = undefined;
}

function clearHideTimer() {
  if (hideTimer !== undefined) clearTimeout(hideTimer);
  hideTimer = undefined;
}

function selectedActivity(): SelectedActivity | null {
  let selected: SelectedActivity | null = null;
  for (const [owner, entry] of activities()) {
    if (!selected || priority[entry.value.kind] > priority[selected.value.kind] ||
        (priority[entry.value.kind] === priority[selected.value.kind] && entry.sequence > selected.sequence)) {
      selected = { owner, value: entry.value, sequence: entry.sequence };
    }
  }
  return selected;
}

function ownerIsActive(owner: number) {
  return activities().has(owner);
}

function withoutCancel(activity: UiActivity): UiActivity {
  return activity.cancel ? { ...activity, cancel: undefined } : activity;
}

/** Show or hide through a short delay; the underlying activity itself is never delayed. */
function reconcile(selected: SelectedActivity | null) {
  const now = Date.now();
  const state = presentation();
  if (!selected) {
    clearShowTimer();
    if (state.kind === "pending") {
      presentation.set({ kind: "hidden" });
      return;
    }
    if (state.kind !== "visible") return;
    clearHideTimer();
    const quiet = withoutCancel(state.activity);
    const remaining = MIN_VISIBLE - (now - state.since);
    if (remaining > 0) {
      presentation.set({ ...state, activity: quiet });
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        if (presentation().kind === "visible") presentation.set({ kind: "hidden" });
      }, remaining);
    } else {
      presentation.set({ kind: "hidden" });
    }
    return;
  }

  clearHideTimer();
  if (state.kind === "visible") {
    if (state.owner === selected.owner) {
      presentation.set({ ...state, activity: selected.value, sequence: selected.sequence });
      return;
    }
    if (!ownerIsActive(state.owner) ||
        priority[selected.value.kind] > priority[state.activity.kind] ||
        (priority[selected.value.kind] === priority[state.activity.kind] && selected.sequence > state.sequence)) {
      presentation.set({
        kind: "visible", owner: selected.owner, sequence: selected.sequence,
        activity: selected.value, since: now,
      });
    }
    return;
  }

  if (state.kind === "pending" && state.owner === selected.owner) {
    presentation.set({ ...state, activity: selected.value, sequence: selected.sequence });
    return;
  }

  clearShowTimer();
  presentation.set({
    kind: "pending", owner: selected.owner, sequence: selected.sequence, activity: selected.value,
  });
  showTimer = setTimeout(() => {
    showTimer = undefined;
    const top = selectedActivity();
    if (!top) {
      presentation.set({ kind: "hidden" });
      return;
    }
    if (top.owner !== selected.owner) {
      reconcile(top);
      return;
    }
    presentation.set({
      kind: "visible", owner: top.owner, sequence: top.sequence,
      activity: top.value, since: Date.now(),
    });
  }, SHOW_DELAY);
}

/** Register the single title-bar presentation model while the app is mounted. */
export function watchUiPresentation(): void {
  effect(() => {
    const selected = selectedActivity();
    untracked(() => reconcile(selected));
  });
  cleanup(() => {
    clearShowTimer();
    clearHideTimer();
    presentation.set({ kind: "hidden" });
  });
}

export function watchUiActivity(read: () => UiActivity | null): void {
  const owner = ++nextOwner;
  effect(() => {
    const value = read();
    untracked(() => activities.update(current => {
      const previous = current.get(owner)?.value;
      if (!value && !previous) return current;
      if (value && previous && value.kind === previous.kind && value.label === previous.label && value.detail === previous.detail && value.cancel === previous.cancel) return current;
      const next = new Map(current);
      if (value) next.set(owner, { value, sequence: ++nextSequence }); else next.delete(owner);
      return next;
    }));
  });
  cleanup(() => activities.update(current => {
    if (!current.has(owner)) return current;
    const next = new Map(current);
    next.delete(owner);
    return next;
  }));
}

export function currentUiActivity(): UiActivity | null {
  const state = presentation();
  return state.kind === "visible" ? state.activity : null;
}

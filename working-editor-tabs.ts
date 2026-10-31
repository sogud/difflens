import type { WorkingSelection } from "./repository-session";

export type OpenWorkingEditors =
  | { kind: "fresh" }
  | { kind: "ready"; files: readonly WorkingSelection[] };

export type CloseWorkingEditors = "one" | "others" | "left" | "right" | "all";

export function workingFileKey(file: WorkingSelection): string {
  return (file.staged ? "staged:" : "unstaged:") + file.path;
}

export function openWorkingEditor(state: OpenWorkingEditors, file: WorkingSelection): OpenWorkingEditors {
  const files = state.kind === "ready" ? state.files : [];
  if (files.some(open => workingFileKey(open) === workingFileKey(file))) return state;
  return { kind: "ready", files: [...files, file] };
}

export function closeWorkingEditors(
  files: readonly WorkingSelection[],
  target: WorkingSelection,
  mode: CloseWorkingEditors,
  active: WorkingSelection | null,
): { files: WorkingSelection[]; selection: WorkingSelection | null; changed: boolean } {
  const index = files.findIndex(file => workingFileKey(file) === workingFileKey(target));
  if (index < 0) return { files: [...files], selection: active, changed: false };
  const remaining = files.filter((_, position) => {
    switch (mode) {
      case "one": return position !== index;
      case "others": return position === index;
      case "left": return position >= index;
      case "right": return position <= index;
      case "all": return false;
    }
  });
  if (active && remaining.some(file => workingFileKey(file) === workingFileKey(active))) {
    return { files: remaining, selection: active, changed: remaining.length !== files.length };
  }
  const selection = mode === "one"
    ? remaining[Math.min(index, remaining.length - 1)] ?? null
    : remaining.find(file => workingFileKey(file) === workingFileKey(target)) ?? remaining[0] ?? null;
  return { files: remaining, selection, changed: remaining.length !== files.length };
}

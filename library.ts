import { t } from "./i18n";
import type { DisplayMode } from "./ui-types";

export type SourceKind = "repository" | "directory";

export interface LibrarySource {
  kind: SourceKind;
  path: string;
  selectedPath: string | null;
}

export interface LibrarySnapshot {
  sources: LibrarySource[];
  activeKey: string | null;
  mode: DisplayMode;
}

export const LIBRARY_STORAGE_KEY = "difflens.library.v1";

export function sourceKey(
  source: Pick<LibrarySource, "kind" | "path">,
): string {
  return source.kind + ":" + source.path;
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function isLibrarySource(value: unknown): value is LibrarySource {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "repository" || value.kind === "directory") &&
    "path" in value &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    "selectedPath" in value &&
    (value.selectedPath === null || typeof value.selectedPath === "string")
  );
}

export function readLibrary(serialized: string | null): LibrarySnapshot {
  if (serialized === null) {
    return { sources: [], activeKey: null, mode: "nested" };
  }
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== "object" ||
    value === null ||
    !("sources" in value) ||
    !Array.isArray(value.sources) ||
    !value.sources.every(isLibrarySource) ||
    !("activeKey" in value) ||
    !(value.activeKey === null || typeof value.activeKey === "string") ||
    !("mode" in value) ||
    !(value.mode === "nested" || value.mode === "flat")
  ) {
    throw new Error(
      t(
        "The saved repository library could not be read. Add your folders again to start a new library.",
      ),
    );
  }
  const sources: LibrarySource[] = [];
  const keys = new Set<string>();
  for (const source of value.sources) {
    const key = sourceKey(source);
    if (!keys.has(key)) {
      keys.add(key);
      sources.push(source);
    }
  }
  return { sources, activeKey: value.activeKey, mode: value.mode };
}

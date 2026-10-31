import { signal, Storage } from "nsh";
import { errorMessage } from "./diagnostics";
import { t } from "./i18n";
import { accentClasses } from "./appearance";

export const LAYOUT_STORAGE_KEY = "difflens.layout.v1";
export const PANEL_LIMITS = {
  sidebar: { size: 240, min: 180, max: 600 },
  changes: { size: 340, min: 240, max: 900 },
  navigation: { size: 230, min: 180, max: 900 },
  git: { size: 300, min: 230, max: 800 },
  library: { size: 140, min: 72, max: 500 },
  worktrees: { size: 148, min: 64, max: 600 },
  staged: { size: 128, min: 64, max: 1200 },
  composer: { size: 124, min: 88, max: 600 },
  commitFiles: { size: 160, min: 64, max: 1200 },
};
export type PanelName = keyof typeof PANEL_LIMITS;
export type PanelSizes = Record<PanelName, number>;
export type ResizePanel = (panel: PanelName, size: number) => void;
export function panelHandleClass() {
  const accent = accentClasses();
  return "bg-border " + accent.hover + " " + accent.pressed;
}
export function panelGripClass() {
  return "bg-transparent";
}

function defaults(): PanelSizes {
  const sizes = {} as PanelSizes;
  for (const name of Object.keys(PANEL_LIMITS) as PanelName[]) sizes[name] = PANEL_LIMITS[name].size;
  return sizes;
}

export function createPanelLayout(onError: (message: string | null) => void) {
  const sizes = signal<PanelSizes>(defaults());
  let canSave = false;
  let writes: Promise<void> = Promise.resolve();

  async function restore() {
    try {
      const serialized = await Storage.getItem(LAYOUT_STORAGE_KEY);
      const next = defaults();
      if (serialized !== null) {
        const saved: unknown = JSON.parse(serialized);
        if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 ||
            !("sizes" in saved) || !saved.sizes || typeof saved.sizes !== "object" || Array.isArray(saved.sizes)) {
          throw new Error(t("The saved panel layout is invalid."));
        }
        for (const name of Object.keys(PANEL_LIMITS) as PanelName[]) {
          const value = (saved.sizes as Record<string, unknown>)[name];
          if (value === undefined) continue;
          if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(t("The saved panel layout is invalid."));
          const limit = PANEL_LIMITS[name];
          next[name] = Math.round(Math.max(limit.min, Math.min(limit.max, value)));
        }
      }
      sizes.set(next);
      canSave = true;
    } catch (cause) {
      onError(t("Could not restore panel sizes: {error}", { error: errorMessage(cause) }));
    }
  }

  // NSH reports at the end of a drag; serialize writes so an earlier drag cannot win.
  const resize: ResizePanel = (name, value) => {
    if (!Number.isFinite(value)) return;
    const limit = PANEL_LIMITS[name];
    const size = Math.round(Math.max(limit.min, Math.min(limit.max, value)));
    if (sizes()[name] === size) return;
    const next = { ...sizes(), [name]: size };
    sizes.set(next);
    if (!canSave) return;
    const serialized = JSON.stringify({ version: 1, sizes: next });
    writes = writes.then(() => Storage.setItem(LAYOUT_STORAGE_KEY, serialized)).then(
      () => onError(null),
      (cause: unknown) => onError(t("Could not save panel sizes: {error}", { error: errorMessage(cause) })),
    );
  };
  return { sizes, restore, resize };
}

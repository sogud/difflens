import { locale, signal, Storage } from "nsh";

export const PREFERENCES_STORAGE_KEY = "difflens.settings.v1";
export const LANGUAGE_NAMES = {
  zh: "简体中文", en: "English", ja: "日本語", ko: "한국어",
  fr: "Français", de: "Deutsch", es: "Español", pt: "Português",
} as const;
export type Language = keyof typeof LANGUAGE_NAMES;
export const LANGUAGES = Object.keys(LANGUAGE_NAMES) as Language[];
export const ACCENTS = ["blue", "teal", "green", "rose", "amber"] as const;
export type Accent = typeof ACCENTS[number];
export type Appearance = "system" | "light" | "dark";
export type ChangeView = "tree" | "list";
export type DiffLayout = "split" | "unified";
export type Preferences = {
  language: Language;
  appearance: Appearance;
  accent: Accent;
  changeView: ChangeView;
  diffLayout: DiffLayout;
  automaticUpdates: boolean;
};

export class InvalidPreferencesError extends Error {}

export function languageForLocale(value: string): Language {
  const code = value.toLowerCase().replace("_", "-").split("-")[0];
  return LANGUAGES.includes(code as Language) ? code as Language : "en";
}

const state = signal<Preferences>({
  language: languageForLocale(locale()),
  appearance: "system",
  accent: "blue",
  changeView: "tree",
  diffLayout: "split",
  automaticUpdates: true,
});
export const preferences = () => state();
export const language = () => state().language;
let writes: Promise<void> = Promise.resolve();

export async function restorePreferences(): Promise<void> {
  const serialized = await Storage.getItem(PREFERENCES_STORAGE_KEY);
  if (serialized === null) return;
  let saved: unknown;
  try { saved = JSON.parse(serialized); }
  catch { throw new InvalidPreferencesError(); }
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || !("language" in saved) ||
      typeof saved.language !== "string" || !LANGUAGES.includes(saved.language as Language)) {
    throw new InvalidPreferencesError();
  }
  const appearance = "appearance" in saved ? saved.appearance : "system";
  const accent = "accent" in saved ? saved.accent : "blue";
  const changeView = "changeView" in saved ? saved.changeView : "tree";
  const diffLayout = "diffLayout" in saved ? saved.diffLayout : "split";
  const automaticUpdates = "automaticUpdates" in saved ? saved.automaticUpdates : true;
  if (!(appearance === "system" || appearance === "light" || appearance === "dark") ||
      typeof accent !== "string" || !ACCENTS.includes(accent as Accent) ||
      !(changeView === "tree" || changeView === "list") ||
      !(diffLayout === "split" || diffLayout === "unified") ||
      typeof automaticUpdates !== "boolean") throw new InvalidPreferencesError();
  state.set({
    language: saved.language as Language,
    appearance,
    accent: accent as Accent,
    changeView,
    diffLayout,
    automaticUpdates,
  });
}

export function updatePreferences(update: Partial<Preferences>): Promise<void> {
  const next = { ...state(), ...update };
  state.set(next);
  const write = writes.then(() => Storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next)));
  // The caller receives the failure; later choices can still be saved.
  writes = write.catch(() => undefined);
  return write;
}

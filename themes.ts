import graphite from "./theme.json";
import slate from "./themes/slate.json";
import sand from "./themes/sand.json";
import forest from "./themes/forest.json";
import contrast from "./themes/contrast.json";

export type ColorTheme = "graphite" | "slate" | "sand" | "forest" | "contrast";
export const COLOR_THEMES = ["graphite", "slate", "sand", "forest", "contrast"] as const;

export const THEME_ACCENTS = ["blue", "teal", "green", "rose", "amber"] as const;
type ThemeAccent = typeof THEME_ACCENTS[number];
type ThemeColors = { cssVars: { light: Record<string, string>; dark: Record<string, string> } };

const DEFINITIONS: Record<ColorTheme, ThemeColors> = { graphite, slate, sand, forest, contrast };

export function themeDefinition(theme: ColorTheme, accent: string): ThemeColors {
  const definition = DEFINITIONS[theme];
  const accentName = THEME_ACCENTS.includes(accent as ThemeAccent) ? accent as ThemeAccent : "blue";
  const withAccent = (colors: Record<string, string>) => ({
    ...colors,
    "primary": colors["theme-" + accentName],
    "primary-foreground": colors["theme-" + accentName + "-foreground"],
    "ring": colors["theme-" + accentName],
  });
  return {
    cssVars: {
      light: withAccent(definition.cssVars.light),
      dark: withAccent(definition.cssVars.dark),
    },
  };
}

export function themePreview(theme: ColorTheme, mode: "light" | "dark"): {
  background: string;
  surface: string;
  selection: string;
  foreground: string;
} {
  const colors = DEFINITIONS[theme].cssVars[mode];
  return {
    background: colors["background"],
    surface: colors["surface-muted"],
    selection: colors["accent"],
    foreground: colors["foreground"],
  };
}

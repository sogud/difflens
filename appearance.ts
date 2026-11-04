import { computed, effect, setColorScheme } from "nsh";
import { preferences } from "./preferences";
import { themeDefinition } from "./themes";

const uiTheme = computed(() => JSON.stringify(
  themeDefinition(preferences().colorTheme, preferences().accent),
));

export function applyAppearance() {
  effect(() => setColorScheme(preferences().appearance));
}

export function appearanceThemeProps(): { uiTheme: string } {
  // NSH follows spread-property getters; keep the signal read inside that effect.
  return { get uiTheme() { return uiTheme(); } };
}

/** Accent roles share semantic palette tokens; Git status colors stay separate. */
export function accentClasses() {
  const name = "theme-" + preferences().accent;
  return {
    fill: "bg-" + name,
    foreground: "text-" + name + "-foreground",
    text: "text-" + name,
    tab: "selected:border-" + name,
    border: "border-" + name,
    focus: "focus:border-" + name,
    hover: "group-hover:bg-" + name + "/60",
    pressed: "group-active:bg-" + name,
    spinner: "border-t-" + name,
  };
}

import { effect, setColorScheme } from "nsh";
import { preferences } from "./preferences";

export function applyAppearance() {
  effect(() => setColorScheme(preferences().appearance));
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

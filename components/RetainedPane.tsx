import { effect, signal, View, type ViewProps } from "nsh";

/** Mount on first use; hiding a tab keeps its native list/editor and reading position. */
export function RetainedPane(props: { active: boolean; children?: ViewProps["children"] }) {
  const visited = signal(false);
  effect(() => { if (props.active) visited.set(true); });
  return <View class={props.active ? "min-h-0 min-w-0 flex-1" : "hidden"}>
    {visited() ? props.children : null}
  </View>;
}

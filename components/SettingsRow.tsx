import { Text, View, type ViewProps } from "nsh";

/** Shared label edge and control column for the compact settings form. */
export function SettingsRow(props: { label: string; children?: ViewProps["children"] }) {
  return <View class="min-h-7 flex-row items-center gap-2">
    <Text class="w-20 shrink-0 text-[11px] text-muted-foreground">{props.label}</Text>
    <View class="min-w-0 flex-1">{props.children}</View>
  </View>;
}

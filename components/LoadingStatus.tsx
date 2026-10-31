import { Text, View } from "nsh";
import { Progress } from "nsh/base";
import { accentClasses } from "../appearance";

export function LoadingStatus(props: { testID?: string; label: string }) {
  return <View testID={props.testID} class="min-w-0 flex-row items-center gap-2">
    <Progress testID="loading-spinner" indeterminate accessibilityLabel={props.label}
      class="size-3 shrink-0" trackClass="size-3"
      indicatorClass={"size-3 rounded-full border-2 border-muted-foreground/30 animate-spin motion-reduce:animate-none " + accentClasses().spinner} />
    <Text numberOfLines={1} class="min-w-0 flex-1 text-[11px] text-muted-foreground">{props.label}</Text>
  </View>;
}

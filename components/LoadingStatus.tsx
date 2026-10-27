import { Text, View } from "nsh";
import { Progress } from "nsh/base";

export function LoadingStatus(props: {
  testID?: string;
  label: string;
  path?: string;
  hint?: string;
}) {
  return (
    <View testID={props.testID} class="gap-1.5">
      <View class="flex-row items-center gap-2">
        <Progress
          testID="loading-spinner"
          indeterminate
          accessibilityLabel={props.label}
          class="size-3"
          trackClass="size-3"
          indicatorClass="size-3 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin motion-reduce:animate-none"
        />
        <Text class="text-[11px] text-muted-foreground">{props.label}</Text>
      </View>
      {props.path ? (
        <Text
          numberOfLines={1}
          class="font-mono text-[11px] text-muted-foreground"
        >
          {props.path}
        </Text>
      ) : null}
      {props.hint ? (
        <Text class="text-[11px] text-muted-foreground">{props.hint}</Text>
      ) : null}
    </View>
  );
}

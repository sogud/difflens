import type { YNode } from "nsh";
import { Button } from "nsh/base";
import { HintTarget } from "./Hint";
import { Icon, type IconName } from "./Icon";

export function IconButton(props: {
  ref?: (node: YNode) => void;
  icon: IconName;
  label: string;
  hint?: string;
  testID?: string;
  disabled?: boolean;
  selected?: boolean;
  compact?: boolean;
  spinning?: boolean;
  onPress: () => void;
}) {
  // NSH 0.3's native Button drops tooltip host props; a View owns the hint.
  return <HintTarget class={props.compact ? "size-6 shrink-0" : "size-7 shrink-0"} text={props.hint ?? props.label}>
    <Button ref={props.ref} testID={props.testID} accessibilityLabel={props.label} disabled={props.disabled}
      selected={props.selected} onPress={props.onPress}
      class={(props.compact ? "size-6 " : "size-7 ") + "items-center justify-center rounded hover:bg-accent active:bg-accent/70 selected:bg-accent disabled:opacity-35"}>
      <Icon name={props.icon} size={props.compact ? 13 : 15} muted={!props.selected} spinning={props.spinning} />
    </Button>
  </HintTarget>;
}

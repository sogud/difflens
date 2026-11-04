import { cleanup, Text, View, type ViewProps, type YNode } from "nsh";
import { Button } from "nsh/base";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { Hint } from "./Hint";

export interface ReviewFocus {
  active: () => boolean;
  toggle: () => void;
  register: (node: YNode) => () => void;
}

export function ReviewHeader(props: {
  label?: string;
  children?: ViewProps["children"];
  actions?: ViewProps["children"];
  focus?: ReviewFocus;
}) {
  let release: (() => void) | undefined;
  cleanup(() => release?.());
  return <View accessibilityLabel={props.label} class="h-8 shrink-0 flex-row items-center gap-2 bg-background px-2">
    <View class="min-w-0 flex-1 flex-row gap-2" style={{ alignItems: "baseline" }}>{props.children}</View>
    <View class="shrink-0 flex-row items-center gap-1">
      {props.actions}
      {props.focus ? <View tooltip={<Hint text={t(props.focus.active() ? "Restore navigation" : "Focus review") + " (⇧⌘F)"} />}>
        <Button testID="toggle-review-focus" ref={node => { release?.(); release = props.focus?.register(node); }}
          accessibilityLabel={t(props.focus.active() ? "Restore navigation" : "Focus review")} selected={props.focus.active()}
          onPress={() => props.focus?.toggle()} class="h-6 flex-row items-center gap-1 px-1.5 hover:bg-muted/50 selected:bg-muted/50">
          <Icon name="focus" size={14} muted />
          <Text class="text-[10px] text-muted-foreground">{t(props.focus.active() ? "Exit focus" : "Focus")}</Text>
        </Button>
      </View> : null}
    </View>
  </View>;
}

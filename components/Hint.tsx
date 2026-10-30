import { cleanup, signal, split, Text, View, type ViewProps } from "nsh";
import { Tooltip } from "nsh/base";

export function Hint(props: { text: string; open?: boolean }) {
  return <Tooltip open={props.open} delay={350} class="max-w-80 rounded border border-border bg-popover px-2 py-1 shadow-sm">
    <Text numberOfLines={3} class="text-[11px] text-popover-foreground">{props.text}</Text>
  </Tooltip>;
}

/** Own the delay and dismiss on reflow so hints stay with the hovered control. */
export function HintTarget(props: Omit<ViewProps, "tooltip" | "onHoverIn" | "onHoverOut" | "onTouchStart" | "onLayout"> & { text: string }) {
  const [local, view] = split(props, ["text"]);
  const open = signal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function hide() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    open.set(false);
  }
  function enter() {
    hide();
    timer = setTimeout(() => { timer = undefined; open.set(true); }, 350);
  }
  cleanup(hide);
  return <View {...view} tooltip={<Hint text={local.text} open={open()} />}
    onLayout={hide} onHoverIn={enter} onHoverOut={hide} onTouchStart={hide}>{props.children}</View>;
}

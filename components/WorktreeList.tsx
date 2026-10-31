import { Hint } from "./Hint";
import { Menu } from "nsh/desktop";
import { copyText } from "../context-menu";
import { List, Text, View } from "nsh";
import { Button } from "nsh/base";
import type { WorktreeInfo } from "difflens/native";
import { t } from "../i18n";
import { DENSITY } from "../ui-density";
import { Icon } from "./Icon";

export function WorktreeList(props: {
  worktrees: WorktreeInfo[]; disabled: boolean; onOpen: (path: string) => void;
  expanded: boolean; onExpandedChange: (expanded: boolean) => void;
}) {
  return <View testID="worktree-list" class="min-h-0 flex-1">
    <Button accessibilityLabel={t("Associated worktrees")} onPress={() => props.onExpandedChange(!props.expanded)} class="h-8 flex-row items-center gap-1.5 px-2 text-left hover:bg-muted/60">
      <Icon name={props.expanded ? "chevronDown" : "chevronRight"} size={12} muted />
      <Text class="min-w-0 flex-1 text-[11px] font-semibold text-muted-foreground">{t("Associated worktrees")}</Text>
      <Text class="text-[11px] text-muted-foreground">{props.worktrees.length}</Text>
    </Button>
    <View class={props.expanded ? "min-h-0 flex-1" : "hidden"}>
      <List each={props.worktrees} keyExtractor={worktree => worktree.path} estimatedItemSize={DENSITY.detailedRowSize} class="min-h-0 flex-1" contentClass="px-1 pb-1"
        initialScrollIndex={Math.max(0, props.worktrees.findIndex(worktree => worktree.isCurrent))}>
        {item => <View onContextMenu={event => {
          const worktree = item();
          void Menu.popup([
            { label: t("Open worktree {path}", { path: worktree.path }), disabled: props.disabled || worktree.isCurrent || !worktree.available, onSelect: () => props.onOpen(worktree.path) },
            { label: t("Copy path"), onSelect: () => copyText(worktree.path) },
          ], event.pagePosition);
        }}><View tooltip={<Hint text={item().path} />}><Button selected={item().isCurrent}
          disabled={props.disabled || item().isCurrent || !item().available} accessibilityLabel={t("Open worktree {path}", { path: item().path })}
          onPress={() => props.onOpen(item().path)} class={DENSITY.detailedRow + " justify-center gap-0.5 px-2 text-left hover:bg-muted selected:bg-accent disabled:opacity-70"}>
          <View class="flex-row items-center gap-1.5">
            <Icon name="worktree" size={13} muted />
            <Text numberOfLines={1} class="min-w-0 flex-1 text-[11px] font-medium text-foreground">{item().headLabel}</Text>
            {item().isBare ? <Text class="text-[10px] text-muted-foreground">{t("Bare repository")}</Text> : item().isMain ? <Text class="text-[10px] text-muted-foreground">{t("Main worktree")}</Text> : null}
            {item().isCurrent ? <Text class="text-[10px] text-muted-foreground">{t("Current")}</Text> : null}
            {item().locked ? <Text class="text-[10px] text-muted-foreground">{t("Locked")}</Text> : null}
            {!item().available ? <Text class="text-[10px] text-muted-foreground">{t("Unavailable")}</Text> : null}
          </View>
          <Text numberOfLines={1} class="text-[10px] text-muted-foreground">{item().path}</Text>
        </Button></View></View>}
      </List>
    </View>
  </View>;
}

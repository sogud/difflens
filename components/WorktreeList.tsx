import { Scroll, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import type { WorktreeInfo } from "difflens/native";
import { t } from "../i18n";
import { Icon } from "./Icon";

export function WorktreeList(props: { worktrees: WorktreeInfo[]; disabled: boolean; onOpen: (path: string) => void }) {
  const expanded = signal(true);
  return <View testID="worktree-list" class="border-t border-border">
    <Button accessibilityLabel={t("Associated worktrees")} onPress={() => expanded.set(!expanded())} class="flex-row items-center gap-1.5 px-2 py-2 text-left">
      <Icon name={expanded() ? "chevronDown" : "chevronRight"} size={12} muted />
      <Text class="min-w-0 flex-1 text-[11px] font-semibold text-muted-foreground">{t("Associated worktrees")}</Text>
      <Text class="text-[11px] text-muted-foreground">{String(props.worktrees.length)}</Text>
    </Button>
    {expanded() ? <Scroll style={{ maxHeight: 176 }}>
      <View class="gap-0.5 px-1 pb-1">
        {props.worktrees.map((worktree) => <Button
          selected={worktree.isCurrent}
          disabled={props.disabled || worktree.isCurrent || !worktree.available}
          accessibilityLabel={t("Open worktree {path}", { path: worktree.path })}
          tooltip={worktree.path}
          onPress={() => props.onOpen(worktree.path)}
          class="gap-0.5 rounded px-2 py-1 text-left hover:bg-muted selected:bg-accent disabled:opacity-70"
        >
          <View class="flex-row items-center gap-1.5">
            <Icon name="worktree" size={13} muted />
            <Text numberOfLines={1} class="min-w-0 flex-1 text-[11px] font-medium text-foreground">{worktree.headLabel}</Text>
            {worktree.isBare ? <Text class="text-[10px] text-muted-foreground">{t("Bare repository")}</Text> : worktree.isMain ? <Text class="text-[10px] text-muted-foreground">{t("Main worktree")}</Text> : null}
            {worktree.isCurrent ? <Text class="text-[10px] text-muted-foreground">{t("Current")}</Text> : null}
            {worktree.locked ? <Text class="text-[10px] text-muted-foreground">{t("Locked")}</Text> : null}
            {!worktree.available ? <Text class="text-[10px] text-muted-foreground">{t("Unavailable")}</Text> : null}
          </View>
          <Text numberOfLines={1} class="text-[10px] text-muted-foreground">{worktree.path}</Text>
        </Button>)}
      </View>
    </Scroll> : null}
  </View>;
}

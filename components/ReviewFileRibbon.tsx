import { computed, effect, List, Text, View, type YNode } from "nsh";
import { Button } from "nsh/base";
import { t } from "../i18n";
import { accentClasses } from "../appearance";
import { Hint } from "./Hint";
import { IconButton } from "./IconButton";
import type { WorkingSelection } from "../repository-session";

export interface ReviewFileEntry {
  key: string;
  path: string;
  oldPath: string | null;
  staged: boolean;
  statusLabel: string;
  conflicted: boolean;
}

function fileName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function tabWidth(entry: ReviewFileEntry) {
  let width = entry.staged ? 48 : 36;
  for (const character of fileName(entry.path)) {
    width += (character.codePointAt(0) ?? 0) > 0x2e80 ? 11 : 6;
  }
  return Math.max(86, Math.min(220, width));
}

export function ReviewFileRibbon(props: {
  entries: readonly ReviewFileEntry[];
  selection: WorkingSelection | null;
  visible: boolean;
  disabled: boolean;
  navigationOpen: boolean;
  onToggleNavigation: () => void;
  onSelect: (path: string, staged: boolean) => void;
}) {
  let list: YNode | undefined;
  const viewport = { offset: 0, width: 0, revealed: null as { key: string; index: number } | null };
  const selectedIndex = computed(() => props.entries.findIndex(entry =>
    entry.path === props.selection?.path && entry.staged === props.selection.staged));
  const contentWidth = computed(() => props.entries.reduce((width, entry) => width + tabWidth(entry), 0));
  function reveal(force = false) {
    const index = selectedIndex();
    const entry = props.entries[index];
    if (!props.visible) { viewport.revealed = null; return; }
    if (!list || !entry) return;
    if (!force && viewport.revealed?.key === entry.key && viewport.revealed.index === index) return;
    list.scrollToIndex({ index, animated: false });
    viewport.revealed = { key: entry.key, index };
  }
  function scrollFiles(direction: -1 | 1) {
    const maximum = Math.max(0, contentWidth() - viewport.width);
    viewport.offset = Math.max(0, Math.min(maximum, viewport.offset + direction * Math.max(144, viewport.width * .8)));
    list?.scrollToOffset({ offset: viewport.offset, animated: false });
  }
  effect(() => reveal());
  return <View class={props.visible ? "h-8 shrink-0 flex-row items-center border-b border-border bg-surface-muted px-1" : "hidden"}>
    <IconButton icon="nested" compact testID="toggle-file-drawer" label={t("File navigation")}
      selected={props.navigationOpen} onPress={props.onToggleNavigation} />
    <Text class="shrink-0 px-1.5 text-[10px] text-muted-foreground">{t("Changes")}</Text>
    <View class="relative h-8 min-w-0 flex-1 overflow-hidden">
    {/* NSH 0.3 forces horizontal indicators on; their reserved edge sits below the clipped tab row. */}
    <List testID="review-file-ribbon" ref={node => { list = node; reveal(true); }} horizontal scrollbar={false}
      each={props.entries} keyExtractor={entry => entry.key} estimatedItemSize={112}
      onScroll={event => { viewport.offset = event.offset.x; }}
      onLayout={bounds => { if (bounds.size.width !== viewport.width) { viewport.width = bounds.size.width; reveal(true); } }}
      class="absolute left-0 right-0 top-0" style={{ height: 42 }}
      empty={<Text class="px-2 py-1.5 text-[10px] text-muted-foreground">{t("No files")}</Text>}>
      {(item) => {
        const label = () => t("Show diff for {path}", { path: item().oldPath ? item().oldPath + " → " + item().path : item().path }) + " · " + t(item().staged ? "Staged" : "Unstaged");
        return <View class="h-8 shrink-0" style={{ width: tabWidth(item()) }} tooltip={<Hint text={label()} />}>
          <Button testID={"ribbon:" + item().key} accessibilityLabel={label()} disabled={props.disabled}
            selected={item().path === props.selection?.path && item().staged === props.selection.staged}
            onPress={() => { const entry = item(); props.onSelect(entry.path, entry.staged); }}
            class={"group h-8 w-full flex-row items-center gap-1.5 border-b border-transparent px-2.5 hover:bg-muted/50 " + accentClasses().tab}>
            <Text class={"text-[9px] font-mono " + (item().conflicted ? "text-destructive" : item().staged ? "text-success" : "text-status-modified")}>{item().statusLabel.trim()}</Text>
            <Text numberOfLines={1} class="min-w-0 flex-1 text-[10px] text-muted-foreground group-selected:text-foreground">{fileName(item().path)}</Text>
            {item().staged ? <Text class="text-[9px] text-muted-foreground">✓</Text> : null}
          </Button>
        </View>;
      }}
    </List>
    </View>
    <View tooltip={<Hint text={t("Scroll files left")} />}>
      <Button accessibilityLabel={t("Scroll files left")} disabled={props.entries.length === 0} onPress={() => scrollFiles(-1)} class="h-6 w-5 items-center justify-center hover:bg-muted/50 disabled:opacity-35">
        <Text class="text-[15px] text-muted-foreground">‹</Text>
      </Button>
    </View>
    <View tooltip={<Hint text={t("Scroll files right")} />}>
      <Button accessibilityLabel={t("Scroll files right")} disabled={props.entries.length === 0} onPress={() => scrollFiles(1)} class="h-6 w-5 items-center justify-center hover:bg-muted/50 disabled:opacity-35">
        <Text class="text-[15px] text-muted-foreground">›</Text>
      </Button>
    </View>
    <Text class="shrink-0 px-1.5 text-[10px] text-muted-foreground">{(selectedIndex() < 0 ? "-" : selectedIndex() + 1) + " / " + props.entries.length}</Text>
  </View>;
}

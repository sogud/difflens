import { computed, effect, List, signal, Text, View, type YNode } from "nsh";
import { Button } from "nsh/base";
import { Menu as DesktopMenu } from "nsh/desktop";
import type { CloseWorkingEditors } from "../working-editor-tabs";
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

const TAB_NAV_WIDTH = 48;

function fileName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function tabWidth(entry: ReviewFileEntry) {
  let width = entry.staged ? 72 : 60;
  for (const character of fileName(entry.path)) {
    width += (character.codePointAt(0) ?? 0) > 0x2e80 ? 12 : 7;
  }
  return Math.max(110, Math.min(244, width));
}

export function ReviewFileRibbon(props: {
  entries: readonly ReviewFileEntry[];
  repositoryPath: string | null;
  onClose: (file: WorkingSelection, mode: CloseWorkingEditors, repositoryPath: string) => void;
  selection: WorkingSelection | null;
  visible: boolean;
  disabled: boolean;
  navigationOpen: boolean;
  onToggleNavigation: () => void;
  onSelect: (path: string, staged: boolean) => void;
}) {
  let list: YNode | undefined;
  const viewport = { offset: 0, revealed: null as { key: string; index: number } | null };
  const stripWidth = signal(0);
  const selectedIndex = computed(() => props.entries.findIndex(entry =>
    entry.path === props.selection?.path && entry.staged === props.selection.staged));
  const contentWidth = computed(() => props.entries.reduce((width, entry) => width + tabWidth(entry), 0));
  const hasOverflow = computed(() => stripWidth() > 0 && contentWidth() > stripWidth() + 1);
  const viewportWidth = computed(() => Math.max(0, stripWidth() - (hasOverflow() ? TAB_NAV_WIDTH : 0)));
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
    const maximum = Math.max(0, contentWidth() - viewportWidth());
    viewport.offset = Math.max(0, Math.min(maximum, viewport.offset + direction * Math.max(144, viewportWidth() * .8)));
    list?.scrollToOffset({ offset: viewport.offset, animated: false });
  }
  effect(() => reveal());
  effect(() => {
    if (hasOverflow() || viewport.offset === 0) return;
    viewport.offset = 0;
    list?.scrollToOffset({ offset: 0, animated: false });
  });
  return <View class={props.visible ? "h-8 shrink-0 flex-row items-center border-b border-border bg-surface-muted px-1" : "hidden"}>
    <IconButton icon="nested" compact testID="toggle-file-drawer" label={t("File navigation")}
      selected={props.navigationOpen} onPress={props.onToggleNavigation} />
    <View class="relative h-8 min-w-0 flex-1 overflow-hidden" onLayout={bounds => stripWidth.set(bounds.size.width)}>
    {/* NSH 0.3 forces horizontal indicators on; their reserved edge sits below the clipped tab row. */}
    <List testID="review-file-ribbon" ref={node => { list = node; reveal(true); }} horizontal scrollbar={false}
      each={props.entries} keyExtractor={entry => entry.key} estimatedItemSize={112}
      onScroll={event => { viewport.offset = event.offset.x; }}
      onLayout={() => reveal(true)}
      class="absolute left-0 top-0" style={{ height: 42, right: hasOverflow() ? TAB_NAV_WIDTH : 0 }}
      empty={<Text class="px-2 py-1.5 text-[10px] text-muted-foreground">{t("No open files")}</Text>}>
      {(item) => {
        const label = () => t("Show diff for {path}", { path: item().oldPath ? item().oldPath + " → " + item().path : item().path }) + " · " + t(item().staged ? "Staged" : "Unstaged");
        const selected = () => item().path === props.selection?.path && item().staged === props.selection.staged;
        return <View class={"group h-8 shrink-0 flex-row items-center border-b " + (selected() ? accentClasses().border : "border-transparent")}
          style={{ width: tabWidth(item()) }} tooltip={<Hint text={label()} />}
          onContextMenu={event => {
            const entry = item();
            const root = props.repositoryPath;
            if (!root) return;
            const index = props.entries.findIndex(file => file.key === entry.key);
            const close = (mode: CloseWorkingEditors) => props.onClose({ path: entry.path, staged: entry.staged }, mode, root);
            void DesktopMenu.popup([
              { label: t("Close tab"), disabled: props.disabled, onSelect: () => close("one") },
              { label: t("Close other tabs"), disabled: props.disabled || props.entries.length < 2, onSelect: () => close("others") },
              { label: t("Close tabs to the left"), disabled: props.disabled || index <= 0, onSelect: () => close("left") },
              { label: t("Close tabs to the right"), disabled: props.disabled || index < 0 || index === props.entries.length - 1, onSelect: () => close("right") },
              { type: "separator" },
              { label: t("Close all tabs"), disabled: props.disabled, onSelect: () => close("all") },
            ], event.pagePosition);
          }}>
          <Button testID={"ribbon:" + item().key} accessibilityLabel={label()} disabled={props.disabled}
            selected={selected()} onPress={() => { const entry = item(); props.onSelect(entry.path, entry.staged); }}
            class="group h-7 min-w-0 flex-1 flex-row items-center gap-1.5 pl-2.5 pr-1 hover:bg-muted/50">
            <Text class={"text-[9px] font-mono " + (item().conflicted ? "text-destructive" : item().staged ? "text-success" : "text-status-modified")}>{item().statusLabel.trim()}</Text>
            <Text numberOfLines={1} class="min-w-0 flex-1 text-[11px] text-foreground">{fileName(item().path)}</Text>
            {item().staged ? <Text class="text-[9px] text-muted-foreground">✓</Text> : null}
          </Button>
          <View class={"shrink-0 " + (selected() ? "" : "opacity-40 group-hover:opacity-100 group-focus-within:opacity-100")}>
            <IconButton icon="stop" compact label={t("Close tab") + " · " + item().path + " · " + t(item().staged ? "Staged" : "Unstaged")}
              disabled={props.disabled} onPress={() => {
                const root = props.repositoryPath;
                const entry = item();
                if (root) props.onClose({ path: entry.path, staged: entry.staged }, "one", root);
              }} />
          </View>
        </View>;
      }}
    </List>
    {hasOverflow() ? <View class="absolute right-0 top-1 h-6 shrink-0 flex-row items-center" style={{ width: TAB_NAV_WIDTH }}>
      <View tooltip={<Hint text={t("Scroll files left")} />}>
        <Button accessibilityLabel={t("Scroll files left")} onPress={() => scrollFiles(-1)} class="size-6 items-center justify-center hover:bg-muted/50">
          <Text class="text-[15px] text-muted-foreground">‹</Text>
        </Button>
      </View>
      <View tooltip={<Hint text={t("Scroll files right")} />}>
        <Button accessibilityLabel={t("Scroll files right")} onPress={() => scrollFiles(1)} class="size-6 items-center justify-center hover:bg-muted/50">
          <Text class="text-[15px] text-muted-foreground">›</Text>
        </Button>
      </View>
    </View> : null}
    </View>
  </View>;
}

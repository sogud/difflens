import { cleanup, computed, effect, keymap, List, signal, Text, untracked, View, type YNode } from "nsh";
import { Button, Input, Popover } from "nsh/base";
import { t } from "../i18n";
import { DENSITY } from "../ui-density";
import { Icon, type IconName } from "./Icon";
import { Hint } from "./Hint";

export interface SwitcherItem {
  key: string;
  label: string;
  detail?: string;
  current?: boolean;
  recent?: boolean;
  parent?: string;
  worktree?: string;
}

export function QuickSwitcher(props: {
  label: string;
  value: string;
  icon: IconName;
  placeholder: string;
  scope: string | null;
  disabled: boolean;
  items: () => SwitcherItem[];
  onSelect: (key: string, scope: string | null) => void;
  actions: { label: string; onSelect: (scope: string | null) => void }[];
  onOpenChange: (open: boolean) => void;
  onTriggerRef?: (node: YNode) => void;
}) {
  const open = signal(false);
  const query = signal("");
  const composing = signal(false);
  const revision = signal(0);
  const highlightedKey = signal<string | null>(null);
  const revealRequest = signal<string | null>(null);
  let openedScope: string | null = null;
  let list: YNode | undefined;
  let disposeKeys: (() => void) | undefined;
  const items = computed(() => { void revision(); return props.items(); });
  const expanded = signal<ReadonlySet<string>>(new Set());
  const filtered = computed(() => {
    const value = query().trim().toLowerCase();
    return items().filter(item => !value || (item.label + " " + (item.detail ?? "") + " " + (item.worktree ?? "")).toLowerCase().includes(value));
  });
  const rows = computed(() => {
    const values = items();
    const byKey = new Map(values.map(value => [value.key, value]));
    const children = new Map<string, SwitcherItem[]>();
    const roots: SwitcherItem[] = [];
    const ranks = new Map(values.map((value, index) => [value.key, index]));
    for (const value of values) {
      if (value.parent && value.parent !== value.key && byKey.has(value.parent)) {
        const siblings = children.get(value.parent) ?? [];
        siblings.push(value); children.set(value.parent, siblings);
      } else roots.push(value);
    }
    const matched = new Set(filtered().map(value => value.key));
    const included = new Set(matched);
    for (const value of filtered()) {
      let parent = value.parent;
      const seen = new Set([value.key]);
      while (parent && !seen.has(parent)) { seen.add(parent); included.add(parent); parent = byKey.get(parent)?.parent; }
    }
    const rank = (value: SwitcherItem) => Math.min(ranks.get(value.key) ?? values.length, ...(children.get(value.key) ?? []).map(child => ranks.get(child.key) ?? values.length));
    roots.sort((left, right) => rank(left) - rank(right));
    const result: { value: SwitcherItem; depth: number; count: number; expanded: boolean }[] = [];
    const visited = new Set<string>();
    function append(value: SwitcherItem, depth: number) {
      if (visited.has(value.key) || !included.has(value.key)) return;
      visited.add(value.key);
      const nested = children.get(value.key) ?? [];
      const shown = expanded().has(value.key) || (!!query().trim() && nested.some(child => included.has(child.key)));
      result.push({ value, depth, count: nested.length, expanded: shown });
      if (shown) for (const child of nested) append(child, depth + 1);
    }
    for (const value of roots) append(value, 0);
    return result;
  });
  function rowHeight(item: SwitcherItem) {
    return item.detail ? DENSITY.detailedRowSize : DENSITY.compactRowSize;
  }
  const listHeight = computed(() => Math.min(264, Math.max(DENSITY.compactRowSize,
    rows().reduce((height, row) => height + rowHeight(row.value), 0))));
  function toggleGroup(key: string) {
    const next = new Set(expanded());
    if (next.has(key)) next.delete(key); else next.add(key);
    expanded.set(next);
  }
  function close() {
    disposeBindings();
    open.set(false);
    composing.set(false);
    props.onOpenChange(false);
  }
  function choose(key: string) {
    if (props.disabled) return;
    const scope = openedScope;
    close();
    props.onSelect(key, scope);
  }
  function revealKey(key: string) {
    const index = rows().findIndex(row => row.value.key === key);
    if (index < 0 || !list) return;
    revealRequest.set(null);
    list.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
  }
  function setHighlight(key: string | null, reveal = false) {
    highlightedKey.set(key);
    if (key && reveal) revealRequest.set(key);
  }
  function keepHighlightVisible() {
    const visible = rows();
    if (!visible.length) { highlightedKey.set(null); return; }
    if (visible.some(row => row.value.key === highlightedKey())) return;
    setHighlight(visible[0].value.key, true);
  }
  effect(() => {
    const active = open();
    void rows();
    untracked(() => { if (active) keepHighlightVisible(); });
  });
  function moveHighlight(direction: -1 | 1) {
    const visible = rows();
    if (!visible.length) return;
    const current = visible.findIndex(row => row.value.key === highlightedKey());
    const next = current < 0
      ? (direction > 0 ? 0 : visible.length - 1)
      : Math.max(0, Math.min(visible.length - 1, current + direction));
    setHighlight(visible[next].value.key, true);
  }
  function moveToEdge(edge: "start" | "end") {
    const visible = rows();
    if (!visible.length) return;
    setHighlight(visible[edge === "start" ? 0 : visible.length - 1].value.key, true);
  }
  function chooseHighlighted() {
    const row = rows().find(value => value.value.key === highlightedKey());
    if (row) choose(row.value.key);
  }
  effect(() => {
    const key = revealRequest();
    if (!key) return;
    void rows();
    untracked(() => revealKey(key));
  });
  function disposeBindings() {
    disposeKeys?.();
    disposeKeys = undefined;
  }
  function bindKeys() {
    disposeBindings();
    disposeKeys = keymap.bind({
      up: () => moveHighlight(-1),
      down: () => moveHighlight(1),
      home: () => moveToEdge("start"),
      end: () => moveToEdge("end"),
      enter: () => chooseHighlighted(),
      escape: () => close(),
    }, { when: "always" });
  }
  function setComposing(value: boolean) {
    composing.set(value);
    if (value) disposeBindings();
    else if (open()) bindKeys();
  }
  effect(() => {
    const active = open();
    untracked(() => {
      disposeBindings();
      if (active && !composing()) bindKeys();
    });
  });
  cleanup(() => { disposeBindings(); });
  return <Popover open={open()} align="start" placement="bottom" offset={3} margin={6}
    onOpenChange={value => {
      open.set(value);
      props.onOpenChange(value);
      if (value) {
        openedScope = props.scope; query.set(""); composing.set(false); revision.set(revision() + 1);
        const all = items(); const byKey = new Map(all.map(item => [item.key, item])); const defaults = new Set<string>();
        for (const item of all) if (item.current) {
          let parent = item.parent;
          while (parent && !defaults.has(parent)) { defaults.add(parent); parent = byKey.get(parent)?.parent; }
        }
        expanded.set(defaults);
        const visible = rows();
        const current = visible.find(row => row.value.current) ?? visible[0];
        highlightedKey.set(current?.value.key ?? null);
        if (current) revealRequest.set(current.value.key);
      } else {
        disposeBindings();
        composing.set(false);
        highlightedKey.set(null);
        revealRequest.set(null);
      }
    }}
    popupClass="w-[360px] max-w-full overflow-hidden rounded border border-border/60 bg-popover shadow-sm"
    trigger={<View ref={props.onTriggerRef} role="button" focusable disabled={props.disabled} accessibilityLabel={props.label + " · " + props.value}
      tooltip={<Hint text={props.label + " · " + props.value} />}
      class="h-7 min-w-0 flex-row items-center gap-1 rounded px-1.5 hover:bg-muted/60 disabled:opacity-35">
      <Icon name={props.icon} size={13} muted />
      <Text class="text-[10px] text-muted-foreground">{props.label}</Text>
      <Text numberOfLines={1} class="max-w-40 min-w-0 text-[11px] font-medium text-foreground">{props.value}</Text>
      <Icon name="chevronDown" size={11} muted />
    </View>}>
    <View class="gap-0.5 p-1">
      <Input autoFocus value={query()} onChange={value => query.set(value)} placeholder={props.placeholder} accessibilityLabel={props.placeholder}
        onCompositionChange={event => setComposing(event.composing)}
        class="h-7 rounded bg-subtle-input px-1.5 text-[12px] text-foreground" />
      <List scrollbar={false} ref={node => { list = node; const key = revealRequest(); if (key) untracked(() => revealKey(key)); }}
        each={rows()} keyExtractor={row => row.value.key} estimatedItemSize={DENSITY.compactRowSize} class="min-h-0" style={{ height: listHeight() }}
        empty={<Text class="px-1.5 py-2 text-[11px] text-muted-foreground">{t("No matching items")}</Text>}>
        {item => <View class={"flex-row items-center rounded" + (item().value.key === highlightedKey() ? " bg-muted/70" : "")}
          style={{ height: rowHeight(item().value), paddingLeft: item().depth * 12 }} onHoverIn={() => highlightedKey.set(item().value.key)}>
          {item().count > 0 ? <Button accessibilityLabel={t(item().expanded ? "Collapse {name}" : "Expand {name}", { name: item().value.label })}
            onPress={() => { highlightedKey.set(item().value.key); toggleGroup(item().value.key); }} class="h-8 w-5 items-center justify-center hover:bg-muted">
            <Icon name={item().expanded ? "chevronDown" : "chevronRight"} size={11} muted />
          </Button> : item().depth > 0 ? <View class="w-5" /> : null}
          <Button selected={item().value.current} disabled={props.disabled}
            onPress={() => { highlightedKey.set(item().value.key); choose(item().value.key); }}
            class="min-w-0 flex-1 justify-center gap-0.5 px-1.5 hover:bg-muted selected:bg-accent/60" style={{ height: rowHeight(item().value) }}>
            <View class="flex-row items-center gap-2">
              <Text numberOfLines={1} class="min-w-0 flex-1 text-[12px] text-foreground">{item().value.worktree ?? item().value.label}</Text>
              {item().count > 0 ? <Text class="text-[10px] text-muted-foreground">{t("{count} worktrees", { count: item().count })}</Text> : null}
              {item().value.current ? <Text class="text-[11px] text-muted-foreground">✓</Text> : item().value.recent ? <Text class="text-[10px] text-muted-foreground">{t("Recent")}</Text> : null}
            </View>
            {item().value.detail ? <Text numberOfLines={1} class="text-[10px] text-muted-foreground">{item().value.detail}</Text> : null}
          </Button>
        </View>}
      </List>
      <View class="pt-0.5">{props.actions.map(action => <Button disabled={props.disabled}
        onPress={() => { const scope = openedScope; close(); action.onSelect(scope); }} class="h-7 justify-center px-1.5 hover:bg-muted">
        <Text class="text-[11px] text-foreground">{action.label}</Text>
      </Button>)}</View>
    </View>
  </Popover>;
}

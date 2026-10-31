import { Hint, HintTarget } from "./Hint";
import { Menu as DesktopMenu } from "nsh/desktop";
import { copyText } from "../context-menu";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { accentClasses } from "../appearance";
import { DENSITY } from "../ui-density";
import { panelGripClass, panelHandleClass, PANEL_LIMITS, type PanelSizes, type ResizePanel } from "../panel-layout";
import { WorktreeList } from "./WorktreeList";
import { computed, effect, List, Scroll, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { Button, Menu, MenuItem, MenuSeparator, ResizablePanel, ResizablePanelGroup, Tab, Tabs } from "nsh/base";
import type { RepositoryNode, WorktreeInfo } from "difflens/native";
import {
  folderName,
  sourceKey,
  type LibrarySource,
  type SourceKind,
} from "../library";
import type { RepositoryTreeProps } from "../ui-types";

function ViewModeTab(props: { mode: "nested" | "flat"; selected: boolean; onPress: () => void }) {
  const label = () => props.mode === "nested" ? t("Nested") : t("Flat");
  return <HintTarget class="h-6 w-7" text={label()}>
    <Tab testID={"view-" + props.mode} selected={props.selected} accessibilityLabel={label()} onPress={props.onPress}
      class="h-6 w-7 items-center justify-center rounded selected:bg-background active:opacity-70">
      <Icon name={props.mode} muted={!props.selected} />
    </Tab>
  </HintTarget>;
}

function flattenRepositories(repositories: RepositoryNode[]): RepositoryNode[] {
  const result: RepositoryNode[] = [];
  for (const repository of repositories) {
    result.push(repository);
    result.push(...flattenRepositories(repository.children));
  }
  return result;
}

function filterRepositoryTree(
  repositories: RepositoryNode[],
  query: string,
): RepositoryNode[] {
  if (!query) return repositories;
  const filtered: RepositoryNode[] = [];
  for (const repository of repositories) {
    const children = filterRepositoryTree(repository.children, query);
    if (
      repository.name.toLowerCase().includes(query) ||
      repository.path.toLowerCase().includes(query) ||
      children.length > 0
    ) {
      filtered.push({ ...repository, children });
    }
  }
  return filtered;
}

function RepositoryRow(props: {
  repository: RepositoryNode;
  depth: number;
  nested: boolean;
  virtual?: boolean;
  collapsed: string[];
  searching: boolean;
  selectedPath: string | null;
  disabled: boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onReveal: (path: string) => void;
  onTools: (path: string) => void;
}) {
  const collapsed = computed(
    () => !props.searching && props.collapsed.includes(props.repository.path),
  );
  const hasChildren = computed(
    () => props.nested && props.repository.children.length > 0,
  );
  const status = computed(() =>
    props.repository.cached
      ? t("Pending refresh")
      : props.repository.error
      ? t("Error")
      : props.repository.changedFiles > 0
        ? t("{count} changed", { count: props.repository.changedFiles })
        : t("Clean"),
  );
  return (
    <View>
      <View
        class="flex-row items-center"
        style={{ paddingLeft: props.depth * 12 }}
        onContextMenu={(event) => { void DesktopMenu.popup([
          { label: t("Open repository {path}", { path: props.repository.name }), disabled: props.disabled, onSelect: () => props.onSelect(props.repository.path) },
          { label: t("Git actions"), disabled: props.disabled, onSelect: () => props.onTools(props.repository.path) },
          { label: t("Open in file manager"), onSelect: () => props.onReveal(props.repository.path) },
          { label: t("Copy path"), onSelect: () => copyText(props.repository.path) },
          ...(hasChildren() ? [{ label: t(collapsed() ? "Expand {name}" : "Collapse {name}", { name: props.repository.name }), disabled: props.disabled, onSelect: () => props.onToggle(props.repository.path) }] : []),
        ], event.pagePosition); }}
      >
        {hasChildren() ? (
          <IconButton icon={collapsed() ? "chevronRight" : "chevronDown"} compact disabled={props.disabled}
            label={t(collapsed() ? "Expand {name}" : "Collapse {name}", { name: props.repository.name })}
            onPress={() => props.onToggle(props.repository.path)} />
        ) : (
          <View class="w-6" />
        )}
        <View class="min-w-0 flex-1" tooltip={<Hint text={props.repository.path} />}>
        <Button
          selected={props.selectedPath === props.repository.path}
          disabled={props.disabled}
          accessibilityLabel={t("Select repository {name}", {
            name: props.repository.name,
          })}
          onPress={() => props.onSelect(props.repository.path)}
          class={DENSITY.detailedRow + " min-w-0 justify-center rounded px-2 text-left hover:bg-muted/70 active:bg-muted selected:bg-accent"}
        >
          <View class="flex-row items-center gap-1.5">
            <View class="min-w-0 flex-1 gap-0.5">
              <Text
                numberOfLines={1}
                class="text-[12px] font-medium text-foreground"
              >
                {props.repository.name}
              </Text>
              <Text numberOfLines={1} class="text-[11px] text-muted-foreground">
                {props.repository.headLabel +
                  (props.repository.relativePath !== "."
                    ? " · " + props.repository.relativePath
                    : "")}
              </Text>
            </View>
            <Text
              class={
                "text-[11px] " +
                (props.repository.error && !props.repository.cached
                  ? "text-destructive"
                  : "text-muted-foreground")
              }
            >
              {status()}
            </Text>
          </View>
        </Button>
        </View>
      </View>
      {!props.virtual && hasChildren() && !collapsed()
        ? props.repository.children.map((repository) => (
            <RepositoryRow
              {...props}
              repository={repository}
              depth={props.depth + 1}
            />
          ))
        : null}
    </View>
  );
}

export function RepositoryPane(
  props: RepositoryTreeProps & {
    panelSizes: PanelSizes;
    onPanelResize: ResizePanel;
    worktrees: WorktreeInfo[];
    onOpenWorktree: (path: string) => void;
    onTools: (path: string) => void;
    onSetup: (clone: boolean) => void;
    sources: LibrarySource[];
    activeKey: string | null;
    activeSource: LibrarySource | undefined;
    onOpenSource: (source: LibrarySource) => void;
    onRemoveSource: (key: string) => void;
    onRevealSource: (path: string) => void;
    onChooseSource: (kind: SourceKind) => void;
    onEnterPath: () => void;
  },
) {
  const search = signal("");
  const collapsed = signal<string[]>([]);
  const worktreesExpanded = signal(true);
  let previousSource = props.activeKey;
  effect(() => {
    const currentSource = props.activeKey;
    if (currentSource !== previousSource) {
      previousSource = currentSource;
      search.set("");
    }
  });
  const visibleRepositories = computed(() => {
    const query = search().trim().toLowerCase();
    if (props.mode === "nested")
      return filterRepositoryTree(props.repositories, query);
    return flattenRepositories(props.repositories).filter(
      (repository) =>
        !query ||
        repository.name.toLowerCase().includes(query) ||
        repository.path.toLowerCase().includes(query),
    );
  });
  const repositoryRows = computed(() => {
    const rows: { repository: RepositoryNode; depth: number }[] = [];
    const searching = search().trim().length > 0;
    const hidden = new Set(collapsed());
    function append(nodes: RepositoryNode[], depth: number) {
      for (const repository of nodes) {
        rows.push({ repository, depth });
        if (props.mode === "nested" && (searching || !hidden.has(repository.path))) append(repository.children, depth + 1);
      }
    }
    append(visibleRepositories(), 0);
    return rows;
  });
  const repositoryCount = computed(
    () => flattenRepositories(props.repositories).length,
  );
  function toggle(path: string) {
    collapsed.set(
      collapsed().includes(path)
        ? collapsed().filter((item) => item !== path)
        : [...collapsed(), path],
    );
  }

  return (
    <View class="min-h-0 flex-1 flex-col bg-chrome">
      <ResizablePanelGroup axis="vertical" class="min-h-0 flex-1" handleClass={panelHandleClass()} handleThumbClass={panelGripClass()}
        handleAccessibilityLabel={t("Resize library section")}>
      <ResizablePanel fixed size={props.panelSizes.library} minSize={PANEL_LIMITS.library.min} maxSize={PANEL_LIMITS.library.max}
        onResize={(size) => props.onPanelResize("library", size)} class="min-h-0">
      <View class="flex-row items-center justify-between px-2 pt-2 pb-2">
        <Text class="text-[11px] font-semibold text-muted-foreground">
          {t("LIBRARY")}
        </Text>
        <Menu
          popupClass="min-w-52 rounded-md border border-border bg-popover p-1"
          offset={4}
          trigger={
            <HintTarget
              text={t("Add to library")}
              disabled={props.disabled}
              role="button"
              focusable
              accessibilityLabel={t("Add to library")}
              class="size-6 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-40"
            >
              <Icon name="plus" />
            </HintTarget>
          }
        >
          <MenuItem
            class="rounded px-2 py-1 active:bg-accent"
            disabled={props.disabled}
            onSelect={() => props.onChooseSource("repository")}
          >
            <Text class="text-[12px] text-foreground">
              {t("Existing repository…")}
            </Text>
          </MenuItem>
          <MenuItem
            class="rounded px-2 py-1 active:bg-accent"
            disabled={props.disabled}
            onSelect={() => props.onChooseSource("directory")}
          >
            <Text class="text-[12px] text-foreground">
              {t("Workspace directory…")}
            </Text>
          </MenuItem>
          <MenuItem disabled={props.disabled} onSelect={() => props.onSetup(true)} class="h-7 justify-center rounded px-2 hover:bg-accent"><Text class="text-[12px] text-foreground">{t("Clone repository…")}</Text></MenuItem>
          <MenuItem disabled={props.disabled} onSelect={() => props.onSetup(false)} class="h-7 justify-center rounded px-2 hover:bg-accent"><Text class="text-[12px] text-foreground">{t("Create repository…")}</Text></MenuItem>
          <MenuSeparator class="my-1 h-px bg-border" />
          <MenuItem
            class="rounded px-2 py-1 active:bg-accent"
            disabled={props.disabled}
            onSelect={props.onEnterPath}
          >
            <Text class="text-[12px] text-foreground">
              {t("Enter a path…")}
            </Text>
          </MenuItem>
        </Menu>
      </View>
      <Scroll class="min-h-0 flex-1">
        <View class="gap-1 px-2 pb-2">
          {props.sources.length === 0 ? (
            <Text class="px-2 py-1.5 text-[11px] text-muted-foreground">
              {t("Your saved repositories and directories appear here.")}
            </Text>
          ) : (
            props.sources.map((source) => (
              <View class="flex-row items-center gap-1" onContextMenu={(event) => { void DesktopMenu.popup([
                { label: t("Open / Refresh"), disabled: props.disabled, onSelect: () => props.onOpenSource(source) },
                { label: t("Open in file manager"), onSelect: () => props.onRevealSource(source.path) },
                { label: t("Copy path"), onSelect: () => copyText(source.path) },
                { type: "separator" },
                { label: t("Remove from library"), disabled: props.disabled, onSelect: () => props.onRemoveSource(sourceKey(source)) },
              ], event.pagePosition); }}>
                <View class="min-w-0 flex-1" tooltip={<Hint text={source.path} />}>
                <Button
                  selected={props.activeKey === sourceKey(source)}
                  disabled={props.disabled}
                  accessibilityLabel={t(
                    source.kind === "directory"
                      ? "Open directory {path}"
                      : "Open repository {path}",
                    { path: source.path },
                  )}
                  onPress={() => props.onOpenSource(source)}
                  class={DENSITY.detailedRow + " min-w-0 justify-center gap-0.5 rounded px-2 text-left hover:bg-muted/70 active:bg-muted selected:bg-accent"}
                >
                  <Text
                    numberOfLines={1}
                    class="text-[12px] font-medium text-foreground"
                  >
                    {folderName(source.path)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    class="text-[11px] text-muted-foreground"
                  >
                    {source.kind === "directory"
                      ? t("Directory") + " · "
                      : t("Repository") + " · "}
                    {source.path}
                  </Text>
                </Button>
                </View>
                <Menu
                  popupClass="min-w-48 rounded-md border border-border bg-popover p-1"
                  offset={4}
                  trigger={
                    <HintTarget
                      text={t("Manage {path}", { path: source.path })}
                      disabled={props.disabled}
                      role="button"
                      focusable
                      accessibilityLabel={t("Manage {path}", {
                        path: source.path,
                      })}
                      class="size-6 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-35"
                    >
                      <Icon name="more" muted />
                    </HintTarget>
                  }
                >
                  <MenuItem
                    class="rounded px-2 py-1 active:bg-accent"
                    disabled={props.disabled}
                    onSelect={() => props.onOpenSource(source)}
                  >
                    <Text class="text-[12px] text-foreground">
                      {t("Open / Refresh")}
                    </Text>
                  </MenuItem>
                  <MenuItem
                    class="rounded px-2 py-1 active:bg-accent"
                    disabled={props.disabled}
                    onSelect={() => props.onRevealSource(source.path)}
                  >
                    <Text class="text-[12px] text-foreground">
                      {t("Open in file manager")}
                    </Text>
                  </MenuItem>
                  <MenuSeparator class="my-1 h-px bg-border" />
                  <MenuItem
                    class="rounded px-2 py-1 active:bg-accent"
                    disabled={props.disabled}
                    onSelect={() => props.onRemoveSource(sourceKey(source))}
                  >
                    <Text class="text-[12px] text-foreground">
                      {t("Remove from library")}
                    </Text>
                  </MenuItem>
                </Menu>
              </View>
            ))
          )}
        </View>
      </Scroll>
      </ResizablePanel>
      <ResizablePanel minSize={180} class="min-h-0">
      <ResizablePanelGroup axis="vertical" class="min-h-0 flex-1" handleClass={panelHandleClass()} handleThumbClass={panelGripClass()}
        handleAccessibilityLabel={t("Resize worktree section")}>
      <ResizablePanel minSize={100} class="min-h-0">
      <View class="gap-2 p-2">
        <View class="flex-row items-center gap-1.5">
          <Text
            numberOfLines={1}
            class="min-w-0 flex-1 text-[12px] font-semibold text-foreground"
          >
            {props.activeSource
              ? folderName(props.activeSource.path)
              : t("Repositories")}
          </Text>
          <Text class="text-[11px] text-muted-foreground">
            {t("{count} total", { count: repositoryCount() })}
          </Text>
        </View>
        <View class="flex-row items-center gap-2">
          <Input
            testID="repository-filter"
            value={search()}
            onChange={(value) => search.set(value)}
            disabled={props.disabled}
            placeholder={t("Filter…")}
            accessibilityLabel={t("Filter repositories")}
            class={"h-7 min-w-0 flex-1 rounded border border-transparent bg-subtle-input px-2 text-[12px] text-foreground focus:bg-background " + accentClasses().focus}
          />
          <Tabs class="flex-row gap-0.5 rounded bg-muted p-0.5">
            <ViewModeTab mode="nested" selected={props.mode === "nested"} onPress={() => props.onModeChange("nested")} />
            <ViewModeTab mode="flat" selected={props.mode === "flat"} onPress={() => props.onModeChange("flat")} />
          </Tabs>
        </View>
      </View>
      <List each={repositoryRows()} keyExtractor={row => row.repository.path} estimatedItemSize={DENSITY.detailedRowSize} class="min-h-0 flex-1" contentClass="px-1 py-1"
        initialScrollIndex={Math.max(0, repositoryRows().findIndex(row => row.repository.path === props.selectedPath))}
        empty={<Text class="px-2 py-2 text-[12px] text-muted-foreground">{t(props.repositories.length === 0 ? "No repositories in this view." : "No repositories match this filter.")}</Text>}>
        {item => <RepositoryRow repository={item().repository} depth={item().depth} virtual
          nested={props.mode === "nested"} collapsed={collapsed()} searching={search().trim().length > 0}
          selectedPath={props.selectedPath} disabled={props.disabled} onSelect={props.onSelect}
          onToggle={toggle} onReveal={props.onRevealSource} onTools={props.onTools} />}
      </List>
      </ResizablePanel>
      <ResizablePanel visible={props.worktrees.length > 0} fixed
        size={worktreesExpanded() ? props.panelSizes.worktrees : 32}
        minSize={worktreesExpanded() ? PANEL_LIMITS.worktrees.min : 32}
        maxSize={worktreesExpanded() ? PANEL_LIMITS.worktrees.max : 32}
        onResize={(size) => { if (worktreesExpanded()) props.onPanelResize("worktrees", size); }} class="min-h-0">
        <WorktreeList worktrees={props.worktrees} disabled={props.disabled} onOpen={props.onOpenWorktree}
          expanded={worktreesExpanded()} onExpandedChange={(value) => worktreesExpanded.set(value)} />
      </ResizablePanel>
      </ResizablePanelGroup>
      </ResizablePanel>
      </ResizablePanelGroup>
      {props.warnings > 0 ? (
        <View class="border-t border-border px-2 py-1">
          <Text class="text-[11px] text-warning">
            {t("{count} folders could not be read", { count: props.warnings })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

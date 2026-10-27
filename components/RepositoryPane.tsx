import { t } from "../i18n";
import { Icon } from "./Icon";
import { WorktreeList } from "./WorktreeList";
import { computed, effect, Input, Scroll, signal, Text, View } from "nsh";
import { Button, Menu, MenuItem, MenuSeparator, Tab, Tabs } from "nsh/base";
import type { RepositoryNode, WorktreeInfo } from "difflens/native";
import {
  folderName,
  sourceKey,
  type LibrarySource,
  type SourceKind,
} from "../library";
import type { RepositoryTreeProps } from "../ui-types";

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
  collapsed: string[];
  searching: boolean;
  selectedPath: string | null;
  disabled: boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
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
      >
        {hasChildren() ? (
          <Button
            disabled={props.disabled}
            accessibilityLabel={t(
              collapsed() ? "Expand {name}" : "Collapse {name}",
              { name: props.repository.name },
            )}
            onPress={() => props.onToggle(props.repository.path)}
            class="w-5 items-center justify-center rounded py-1.5 active:bg-muted"
          >
            <Icon name={collapsed() ? "chevronRight" : "chevronDown"} size={13} muted />
          </Button>
        ) : (
          <View class="w-5" />
        )}
        <Button
          selected={props.selectedPath === props.repository.path}
          disabled={props.disabled}
          accessibilityLabel={t("Select repository {name}", {
            name: props.repository.name,
          })}
          tooltip={props.repository.path}
          onPress={() => props.onSelect(props.repository.path)}
          class="min-w-0 flex-1 rounded px-2 py-1 text-left active:bg-muted selected:bg-accent"
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
      {hasChildren() && !collapsed()
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
    worktrees: WorktreeInfo[];
    onOpenWorktree: (path: string) => void;
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
    <View class="min-h-0 flex-1 flex-col border-r border-border">
      <View class="flex-row items-center justify-between px-2 pt-2 pb-2">
        <Text class="text-[11px] font-semibold text-muted-foreground">
          {t("LIBRARY")}
        </Text>
        <Menu
          popupClass="min-w-52 rounded-md border border-border bg-popover p-1"
          offset={4}
          trigger={
            <View
              disabled={props.disabled}
              role="button"
              focusable
              accessibilityLabel={t("Add to library")}
              tooltip={t("Add to library")}
              class="size-6 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-40"
            >
              <Icon name="plus" />
            </View>
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
      <Scroll style={{ maxHeight: 156 }}>
        <View class="gap-1 px-2 pb-2">
          {props.sources.length === 0 ? (
            <Text class="px-2 py-1.5 text-[11px] text-muted-foreground">
              {t("Your saved repositories and directories appear here.")}
            </Text>
          ) : (
            props.sources.map((source) => (
              <View class="flex-row items-center gap-1">
                <Button
                  selected={props.activeKey === sourceKey(source)}
                  disabled={props.disabled}
                  accessibilityLabel={t(
                    source.kind === "directory"
                      ? "Open directory {path}"
                      : "Open repository {path}",
                    { path: source.path },
                  )}
                  tooltip={source.path}
                  onPress={() => props.onOpenSource(source)}
                  class="min-w-0 flex-1 gap-0.5 rounded px-2 py-1 text-left active:bg-muted selected:bg-accent"
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
                <Menu
                  popupClass="min-w-48 rounded-md border border-border bg-popover p-1"
                  offset={4}
                  trigger={
                    <View
                      disabled={props.disabled}
                      role="button"
                      focusable
                      accessibilityLabel={t("Manage {path}", {
                        path: source.path,
                      })}
                      class="rounded px-2 py-1.5 active:bg-muted disabled:opacity-40"
                    >
                      <Icon name="more" muted />
                    </View>
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
      <View class="gap-2 border-y border-border p-2">
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
            class="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[12px] text-foreground"
          />
          <Tabs class="flex-row gap-0.5 rounded bg-muted p-0.5">
            {(["nested", "flat"] satisfies ("nested" | "flat")[]).map((mode) => (
              <Tab
                testID={"view-" + mode}
                selected={props.mode === mode}
                accessibilityLabel={mode === "nested" ? t("Nested") : t("Flat")}
                tooltip={mode === "nested" ? t("Nested") : t("Flat")}
                onPress={() => props.onModeChange(mode)}
                class="h-6 w-7 items-center justify-center rounded selected:bg-background active:opacity-70"
              >
                <Icon name={mode} muted={props.mode !== mode} />
              </Tab>
            ))}
          </Tabs>
        </View>
      </View>
      <Scroll style={{ flex: 1 }}>
        <View class="gap-0.5 px-1 py-1">
          {visibleRepositories().length === 0 ? (
            <Text class="px-2 py-2 text-[12px] text-muted-foreground">
              {props.repositories.length === 0
                ? t("No repositories in this view.")
                : t("No repositories match this filter.")}
            </Text>
          ) : (
            visibleRepositories().map((repository) => (
              <RepositoryRow
                repository={repository}
                depth={0}
                nested={props.mode === "nested"}
                collapsed={collapsed()}
                searching={search().trim().length > 0}
                selectedPath={props.selectedPath}
                disabled={props.disabled}
                onSelect={props.onSelect}
                onToggle={toggle}
              />
            ))
          )}
        </View>
      </Scroll>
      {props.worktrees.length > 0 ? <WorktreeList worktrees={props.worktrees} disabled={props.disabled} onOpen={props.onOpenWorktree} /> : null}
      {props.warnings > 0 ? (
        <View class="border-t border-border px-2 py-1">
          <Text class="text-[11px] text-amber-700 dark:text-amber-400">
            {t("{count} folders could not be read", { count: props.warnings })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

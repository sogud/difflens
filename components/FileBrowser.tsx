import { Hint } from "./Hint";
import { cleanup, computed, effect, List, signal, Text, untracked, View } from "nsh";
import { Menu } from "nsh/desktop";
import { copyText } from "../context-menu";
import { Button } from "nsh/base";
import { Workspace, type FileEntry, type RepositoryDetails } from "difflens/native";
import { t } from "../i18n";
import { errorMessage } from "../diagnostics";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { LoadingStatus } from "./LoadingStatus";

type Folder =
  | { kind: "loading" }
  | { kind: "ready"; entries: FileEntry[] }
  | { kind: "failed"; error: string };
type Row =
  | { kind: "entry"; entry: FileEntry; depth: number }
  | { kind: "loading"; path: string; depth: number }
  | { kind: "failed"; path: string; depth: number; error: string };

export function FileBrowser(props: {
  revision: number;
  repository: RepositoryDetails;
  selectedPath: string | null;
  disabled: boolean;
  onPreview: (path: string) => void;
  onOpenEditor: (path: string) => void;
}) {
  const folders = signal<Record<string, Folder>>({});
  const expanded = signal<string[]>([""]);
  let generation = 0;
  cleanup(() => { generation += 1; });

  async function load(path: string, root: string, request: number) {
    folders.update((current) => ({ ...current, [path]: { kind: "loading" } }));
    try {
      const entries = await Workspace.readDirectory(root, path);
      if (generation !== request) return;
      folders.update((current) => ({ ...current, [path]: { kind: "ready", entries } }));
    } catch (cause) {
      if (generation !== request) return;
      folders.update((current) => ({ ...current, [path]: { kind: "failed", error: errorMessage(cause) } }));
    }
  }

  effect(() => {
    const root = props.repository.path;
    // Refresh explicit repository snapshots, without tying reads to the active tab.
    void props.revision;
    untracked(() => {
      generation += 1;
      folders.set({});
      expanded.set([""]);
      void load("", root, generation);
    });
  });

  const rows = computed(() => {
    const output: Row[] = [];
    const loaded = folders();
    const open = expanded();
    function append(path: string, depth: number) {
      const folder = loaded[path];
      if (!folder || folder.kind === "loading") { output.push({ kind: "loading", path, depth }); return; }
      if (folder.kind === "failed") { output.push({ kind: "failed", path, depth, error: folder.error }); return; }
      for (const entry of folder.entries) {
        output.push({ kind: "entry", entry, depth });
        if (entry.isDirectory && open.includes(entry.path)) append(entry.path, depth + 1);
      }
    }
    append("", 0);
    return output;
  });

  function refresh() {
    const root = props.repository.path;
    const selected = props.selectedPath;
    const request = ++generation;
    folders.set({});
    expanded.set([""]);
    void load("", root, request).then(() => {
      if (generation === request && props.repository.path === root && selected) props.onPreview(selected);
    });
  }

  function choose(entry: FileEntry) {
    if (props.disabled) return;
    if (!entry.isDirectory) { props.onPreview(entry.path); return; }
    if (expanded().includes(entry.path)) {
      expanded.set(expanded().filter((path) => path !== entry.path));
    } else {
      expanded.set([...expanded(), entry.path]);
      if (!folders()[entry.path]) void load(entry.path, props.repository.path, generation);
    }
  }

  return <View testID="file-browser" class="min-h-0 flex-1">
    <View class="flex-row items-center gap-2 px-2 py-1">
      <Text class="min-w-0 flex-1 text-[11px] text-muted-foreground">{t("All files · read-only preview")}</Text>
      <IconButton testID="refresh-files" icon="refresh" compact label={t("Refresh files")}
        disabled={props.disabled || folders()[""]?.kind === "loading"} onPress={refresh} />
    </View>
    <List
      each={rows()}
      keyExtractor={(row) => row.kind + ":" + (row.kind === "entry" ? row.entry.path : row.path)}
      class="min-h-0 flex-1"
      contentClass="pb-2"
      empty={<Text class="px-2 py-2 text-[11px] text-muted-foreground">{t("This folder is empty.")}</Text>}
    >{(item) => {
      const row = computed(item);
      return <View style={{ paddingLeft: row().depth * 12 }}>
        {row().kind === "loading" ? <View class="px-2 py-2"><LoadingStatus label={t("Reading files…")} /></View> :
          row().kind === "failed" ? <Text class="px-2 py-2 text-[11px] text-destructive">{(() => { const current = row(); return current.kind === "failed" ? current.error : ""; })()}</Text> :
          (() => {
            const current = row();
            if (current.kind !== "entry") return null;
            const entry = current.entry;
            return <View tooltip={<Hint text={entry.path} />} onContextMenu={(event) => { void Menu.popup([
                { label: t(entry.isDirectory ? "Toggle folder {path}" : "Preview file {path}", { path: entry.path }), disabled: props.disabled, onSelect: () => choose(entry) },
                { label: t("Copy file path"), onSelect: () => copyText(entry.path) },
                { label: t("Open in editor"), disabled: props.disabled || entry.isDirectory, onSelect: () => props.onOpenEditor(entry.path) },
              ], event.pagePosition); }}><Button
              selected={props.selectedPath === entry.path}
              disabled={props.disabled}
              accessibilityLabel={t(entry.isDirectory ? "Toggle folder {path}" : "Preview file {path}", { path: entry.path })}
              onPress={() => choose(entry)}
              class="h-7 flex-row items-center gap-1.5 px-2 text-left hover:bg-muted selected:bg-accent disabled:opacity-40"
            >
              {entry.isDirectory ? <Icon name={expanded().includes(entry.path) ? "chevronDown" : "chevronRight"} size={11} muted /> : <View class="w-[11px]" />}
              <Icon name={entry.isDirectory ? "folder" : "file"} size={14} muted />
              <Text numberOfLines={1} class="min-w-0 flex-1 text-[12px] text-foreground">{entry.name}</Text>
            </Button></View>;
          })()}
      </View>;
    }}</List>
  </View>;
}

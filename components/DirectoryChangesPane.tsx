import { cleanup, computed, effect, List, signal, Text, untracked, View } from "nsh";
import { Button, Input } from "nsh/base";
import { Workspace, type RepositoryChangeSnapshot, type RepositoryDetails, type RepositoryNode, type ChangedFile } from "difflens/native";
import { changedFileRows, type ChangedFileTreeRow } from "../changed-file-tree";
import { folderName } from "../library";
import { branchSyncLabel } from "../git-sync";
import { t } from "../i18n";
import { preferences } from "../preferences";
import { DENSITY } from "../ui-density";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Hint } from "./Hint";

type Entry = { snapshot: RepositoryChangeSnapshot; bytes: number } | { error: string; bytes: number };
type Row =
  | { kind: "repository"; key: string; repository: RepositoryNode; expanded: boolean }
  | { kind: "section"; key: string; label: string }
  | { kind: "notice"; key: string; root: string; text: string; open: boolean }
  | { kind: "entry"; key: string; root: string; staged: boolean; entry: ChangedFileTreeRow };

function flatten(nodes: RepositoryNode[]): RepositoryNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}

/** One virtual list; expanded repositories share a bounded metadata cache and two readers. */
export function DirectoryChangesPane(props: {
  active: boolean;
  directory: string;
  repositories: RepositoryNode[];
  complete: boolean;
  scanning: boolean;
  warnings: number;
  disabled: boolean;
  refreshEpoch: number;
  selectedRoot: string | null;
  selectedFile: { path: string; staged: boolean } | null;
  latestDetails: RepositoryDetails | null;
  onFile: (root: string, path: string, staged: boolean) => void;
  onRepository: (root: string) => void;
}) {
  const query = signal("");
  const expanded = signal<ReadonlySet<string>>(new Set());
  const states = signal<ReadonlyMap<string, Entry>>(new Map());
  const folders = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  const nodes = computed(() => flatten(props.repositories));
  let generation = 0;
  let disposed = false;
  let initialized = false;
  let refreshEpoch = props.refreshEpoch;
  let readers = 0;
  let queue: { root: string; directory: string; generation: number; epoch: number }[] = [];
  const epochs = new Map<string, number>();
  const pending = new Set<string>();
  const MAX_ENTRIES = 12;
  const MAX_BYTES = 8 * 1024 * 1024;
  cleanup(() => { disposed = true; generation += 1; queue = []; pending.clear(); });

  function put(root: string, entry: Entry) {
    const next = new Map(states());
    next.delete(root); next.set(root, entry);
    const open = new Set(expanded());
    const removed: string[] = [];
    let bytes = [...next.values()].reduce((total, value) => total + value.bytes, 0);
    while (next.size > MAX_ENTRIES || bytes > MAX_BYTES) {
      const victim = [...next.keys()].find(path => path !== root && !open.has(path)) ?? [...next.keys()].find(path => path !== root);
      if (!victim) break;
      bytes -= next.get(victim)!.bytes; next.delete(victim); open.delete(victim); removed.push(victim);
    }
    states.set(next);
    if (removed.length) {
      const nextFolders = new Map(folders());
      for (const path of removed) for (const staged of [true, false]) nextFolders.delete(JSON.stringify([path, staged]));
      folders.set(nextFolders);
    }
    if ([...expanded()].some(path => !open.has(path))) expanded.set(open);
  }
  function store(snapshot: RepositoryChangeSnapshot) {
    put(snapshot.path, { snapshot, bytes: JSON.stringify(snapshot).length * 2 });
  }
  function enqueue(root: string) {
    if (states().has(root) || pending.has(root)) return;
    pending.add(root);
    queue.push({ root, directory: props.directory, generation, epoch: epochs.get(root) ?? 0 });
    drain();
  }
  function drain() {
    while (!disposed && props.active && !props.disabled && readers < 2 && queue.length) {
      const job = queue.shift()!;
      if (job.generation !== generation || !expanded().has(job.root)) { pending.delete(job.root); continue; }
      readers += 1;
      void Workspace.repositoryChanges(job.directory, job.root).then(snapshot => {
        if (snapshot.path !== job.root) throw new Error("The repository path changed. Refresh the directory.");
        if (!disposed && generation === job.generation && expanded().has(job.root) && (epochs.get(job.root) ?? 0) === job.epoch) store(snapshot);
      }).catch((error: unknown) => {
        if (!disposed && generation === job.generation && expanded().has(job.root) && (epochs.get(job.root) ?? 0) === job.epoch) {
          const message = error instanceof Error ? error.message : String(error);
          put(job.root, { error: message, bytes: message.length * 2 });
        }
      }).finally(() => {
        readers -= 1;
        if (job.generation === generation) {
          pending.delete(job.root);
          if (!disposed && expanded().has(job.root) && !states().has(job.root) && (epochs.get(job.root) ?? 0) !== job.epoch) enqueue(job.root);
        }
        drain();
      });
    }
  }
  function refresh() {
    generation += 1; queue = []; pending.clear(); states.set(new Map());
    for (const root of expanded()) enqueue(root);
  }
  function toggle(root: string) {
    const next = new Set(expanded());
    if (next.has(root)) next.delete(root); else { next.add(root); }
    expanded.set(next);
    if (next.has(root)) enqueue(root);
  }
  function toggleFolder(root: string, staged: boolean, path: string) {
    const key = JSON.stringify([root, staged]);
    const next = new Map(folders()); const values = new Set(next.get(key) ?? []);
    if (values.has(path)) values.delete(path); else values.add(path);
    next.set(key, values); folders.set(next);
  }
  effect(() => {
    void props.directory;
    untracked(() => {
      generation += 1; queue = []; pending.clear(); epochs.clear(); initialized = false;
      query.set(""); expanded.set(new Set()); states.set(new Map()); folders.set(new Map());
    });
  });
  effect(() => {
    const all = nodes();
    const active = props.active;
    const disabled = props.disabled;
    untracked(() => {
      if (!active || disabled) return;
      if (!initialized && all.length) {
        initialized = true;
        const initial = all.filter(node => node.changedFiles > 0).slice(0, 3).map(node => node.path);
        if (!initial.length) { const current = all.find(node => node.path === props.selectedRoot) ?? all[0]; if (current) initial.push(current.path); }
        expanded.set(new Set(initial));
      }
      const known = new Set(all.map(node => node.path));
      for (const root of expanded()) if (known.has(root)) enqueue(root);
      drain();
    });
  });
  effect(() => {
    const directory = props.directory;
    const details = props.latestDetails;
    untracked(() => {
      if (!details || !directory || !nodes().some(node => node.path === details.path)) return;
      const { path, headLabel, branchName, hasCommits, hasUpstream, upstream, ahead, behind, syncKnown, remoteNames } = details;
      epochs.set(path, (epochs.get(path) ?? 0) + 1);
      const changes: ChangedFile[] = [];
      let bytes = 0;
      for (const file of details.changes.slice(0, 5000)) {
        bytes += (file.path.length + (file.oldPath?.length ?? 0)) * 2 + 256;
        if (bytes > 2 * 1024 * 1024) break;
        changes.push(file);
      }
      store({ path, headLabel, branchName, hasCommits, hasUpstream, upstream, ahead, behind, syncKnown, remoteNames,
        changes, totalFiles: details.changes.length });
    });
  });
  effect(() => {
    const next = props.refreshEpoch;
    if (next !== refreshEpoch) { refreshEpoch = next; untracked(refresh); }
  });
  const rows = computed<Row[]>(() => {
    const result: Row[] = [];
    const filter = query().trim().toLowerCase();
    for (const repository of nodes()) {
      if (filter && !(repository.name + " " + repository.relativePath + " " + repository.path).toLowerCase().includes(filter)) continue;
      const root = repository.path;
      const isOpen = expanded().has(root);
      result.push({ kind: "repository", key: "repository:" + root, repository, expanded: isOpen });
      if (!isOpen) continue;
      const value = states().get(root);
      if (!value) { result.push({ kind: "notice", key: "reading:" + root, root, text: t("Reading repository"), open: false }); continue; }
      if ("error" in value) { result.push({ kind: "notice", key: "error:" + root, root, text: value.error, open: false }); continue; }
      const snapshot = value.snapshot;
      for (const staged of [true, false]) {
        const files = snapshot.changes.filter(file => staged ? file.staged : file.unstaged || file.untracked);
        if (!files.length) continue;
        result.push({ kind: "section", key: JSON.stringify([root, staged]), label: t(staged ? "Staged" : "Unstaged") + " · " + files.length });
        for (const entry of changedFileRows(files, preferences().changeView, folders().get(JSON.stringify([root, staged])) ?? new Set())) {
          result.push({ kind: "entry", key: JSON.stringify([root, staged, entry.key]), root, staged, entry });
        }
      }
      if (!snapshot.totalFiles) result.push({ kind: "notice", key: "empty:" + root, root, text: t("No files"), open: false });
      if (snapshot.totalFiles > snapshot.changes.length) result.push({ kind: "notice", key: "limit:" + root, root,
        text: t("Showing {count} files. Open the repository to see all {total}.", { count: snapshot.changes.length, total: snapshot.totalFiles }), open: true });
    }
    return result;
  });
  const totalFiles = () => nodes().reduce((total, node) => {
    const value = states().get(node.path);
    return total + (value && "snapshot" in value ? value.snapshot.totalFiles : node.changedFiles);
  }, 0);
  const hasError = (node: RepositoryNode) => {
    const value = states().get(node.path);
    return value ? "error" in value : !!node.error;
  };
  const summary = (node: RepositoryNode) => {
    const value = states().get(node.path);
    if (value && "error" in value) return value.error;
    if (!value && node.error) return node.error;
    if (value && "snapshot" in value) return value.snapshot.headLabel + " · " + branchSyncLabel(value.snapshot);
    return node.headLabel + (node.ahead || node.behind ? " · ↑" + node.ahead + " ↓" + node.behind : "");
  };
  const pendingLabel = (node: RepositoryNode) => {
    const value = states().get(node.path);
    const snapshot = value && "snapshot" in value ? value.snapshot : node;
    return (snapshot.ahead ? "↑" + snapshot.ahead : "") + (snapshot.behind ? " ↓" + snapshot.behind : "");
  };
  return <View testID="directory-changes" class="min-h-0 flex-1 bg-surface-muted">
    <View class="shrink-0 gap-1.5 px-2 py-1.5">
      <View tooltip={<Hint text={props.directory} />}><Text numberOfLines={1} class="text-[11px] font-medium text-foreground">{folderName(props.directory)}</Text></View>
      <View class="flex-row items-center gap-1">
        <Text numberOfLines={1} class="min-w-0 flex-1 text-[10px] text-muted-foreground">{t("{repositories} repositories · {files} changed files", { repositories: nodes().length, files: totalFiles() })}</Text>
        <IconButton icon="refresh" compact disabled={props.disabled} label={t("Refresh expanded repositories")} onPress={refresh} />
      </View>
      <Input value={query()} onChange={value => query.set(value)} placeholder={t("Search repositories…")} accessibilityLabel={t("Search repositories…")}
        class="h-7 rounded bg-subtle-input px-2 text-[11px] text-foreground" />
      {!props.complete ? <Text numberOfLines={2} class="text-[10px] text-warning">{t(props.scanning ? "Repository discovery is still running." : "Cached list is partial. Use Rescan to find more repositories.")}</Text> : null}
      {nodes().some(hasError) ? <Text numberOfLines={2} class="text-[10px] text-warning">{t("Some repository statuses are unavailable; file totals are incomplete.")}</Text> : null}
      {props.warnings > 0 ? <Text class="text-[10px] text-warning">{t("{count} directories could not be fully scanned.", { count: props.warnings })}</Text> : null}
    </View>
    <List each={rows()} keyExtractor={row => row.key} estimatedItemSize={DENSITY.compactRowSize} class="min-h-0 flex-1"
      empty={<Text class="p-3 text-[11px] text-muted-foreground">{t(query() ? "No matching items" : "No repositories found.")}</Text>}>
      {item => {
        const repository = computed(() => { const row = item(); return row.kind === "repository" ? row : null; });
        const entry = computed(() => { const row = item(); return row.kind === "entry" ? row : null; });
        const folder = computed(() => { const row = entry(); return row?.entry.kind === "folder" ? { ...row, value: row.entry } : null; });
        const file = computed(() => { const row = entry(); return row?.entry.kind === "file" ? { ...row, value: row.entry } : null; });
        return <View class={DENSITY.compactRow}>
          {repository() ? <View class="h-8 flex-row items-center pl-1 pr-1">
            <Button disabled={props.disabled} onPress={() => { const row = repository(); if (row) toggle(row.repository.path); }}
              class="h-8 min-w-0 flex-1 flex-row items-center gap-1 px-1 hover:bg-muted/60 disabled:opacity-35">
              <Icon name={repository()!.expanded ? "chevronDown" : "chevronRight"} size={11} muted />
              <View class="min-w-0 flex-1" tooltip={<Hint text={repository()!.repository.path + "\n" + summary(repository()!.repository)} />}>
                <Text numberOfLines={1} class="text-[11px] font-medium text-foreground">{repository()!.repository.relativePath && repository()!.repository.relativePath !== "." ? repository()!.repository.relativePath : repository()!.repository.name}</Text>
              </View>
              {pendingLabel(repository()!.repository) ? <Text class="text-[10px] text-primary">{pendingLabel(repository()!.repository)}</Text> : null}
              <Text class={"text-[10px] " + (hasError(repository()!.repository) ? "text-warning" : "text-muted-foreground")}>{(() => { const node = repository()!.repository; const value = states().get(node.path); if (hasError(node)) return "!"; return value && "snapshot" in value ? value.snapshot.totalFiles : (node.cached ? "≈ " : "") + node.changedFiles; })()}</Text>
            </Button>
            <IconButton icon="worktree" compact disabled={props.disabled} label={t("Open repository for commit and push")}
              onPress={() => { const row = repository(); if (row) props.onRepository(row.repository.path); }} />
          </View> : folder() ? <Button disabled={props.disabled} onPress={() => { const row = folder(); if (row) toggleFolder(row.root, row.staged, row.value.path); }}
            style={{ paddingLeft: 16 + folder()!.value.depth * 12 }} class="h-8 flex-row items-center gap-1 pr-2 hover:bg-muted/50">
            <Icon name={folder()!.value.expanded ? "chevronDown" : "chevronRight"} size={11} muted /><Icon name="folder" size={13} muted />
            <Text numberOfLines={1} class="min-w-0 flex-1 text-[11px] text-foreground">{folder()!.value.label}</Text>
            <Text class="text-[10px] text-muted-foreground">{folder()!.value.count}</Text>
          </Button> : file() ? <View tooltip={<Hint text={file()!.root + "\n" + file()!.value.file.path} />}>
            <Button disabled={props.disabled} selected={props.selectedRoot === file()!.root && props.selectedFile?.path === file()!.value.file.path && props.selectedFile?.staged === file()!.staged}
              onPress={() => { const row = file(); if (row) props.onFile(row.root, row.value.file.path, row.staged); }}
              style={{ paddingLeft: 24 + file()!.value.depth * 12 }} class="h-8 min-w-0 flex-row items-center gap-1.5 pr-2 hover:bg-muted/50 selected:bg-accent disabled:opacity-35">
              <Icon name="file" size={13} muted />
              <Text numberOfLines={1} class={"min-w-0 flex-1 text-[11px] text-foreground" + (file()!.value.file.statusLabel.includes("D") ? " line-through" : "")}>{preferences().changeView === "tree" ? file()!.value.file.path.split("/").pop() : file()!.value.file.path}</Text>
              <Text class={"text-[10px] " + (file()!.value.file.conflicted || file()!.value.file.statusLabel.includes("D") ? "text-destructive" : file()!.value.file.untracked ? "text-success" : "text-status-modified")}>{file()!.value.file.statusLabel.trim()}</Text>
            </Button>
          </View> : (() => {
            const row = item();
            if (row.kind === "section") return <Text class="px-5 py-2 text-[10px] font-medium text-muted-foreground">{row.label}</Text>;
            if (row.kind === "notice") return row.open ? <Button disabled={props.disabled} onPress={() => props.onRepository(row.root)} class="h-8 justify-center px-4 hover:bg-muted"><Text numberOfLines={1} class="text-[10px] text-warning">{row.text}</Text></Button>
              : <View tooltip={<Hint text={row.text} />}><Text numberOfLines={1} class="px-5 py-2 text-[10px] text-muted-foreground">{row.text}</Text></View>;
            return null;
          })()}
        </View>;
      }}
    </List>
  </View>;
}

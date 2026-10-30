import type { ChangedFile } from "difflens/native";
import type { ChangeView } from "./preferences";

export type ChangedFileTreeRow =
  | { kind: "folder"; key: string; path: string; label: string; depth: number; count: number; expanded: boolean }
  | { kind: "file"; key: string; file: ChangedFile; depth: number };

type Folder = {
  path: string;
  name: string;
  folders: Map<string, Folder>;
  files: ChangedFile[];
  count: number;
};

function folder(path: string, name: string): Folder {
  return { path, name, folders: new Map(), files: [], count: 0 };
}

export function changedFileRows(files: readonly ChangedFile[], view: ChangeView, collapsed: ReadonlySet<string>): ChangedFileTreeRow[] {
  if (view === "list") {
    return [...files].sort((left, right) => left.path.localeCompare(right.path))
      .map(file => ({ kind: "file", key: "file:" + file.path, file, depth: 0 }));
  }
  const root = folder("", "");
  for (const file of files) {
    const parts = file.path.split("/");
    parts.pop();
    let parent = root;
    parent.count += 1;
    for (const part of parts) {
      let child = parent.folders.get(part);
      if (!child) {
        child = folder(parent.path ? parent.path + "/" + part : part, part);
        parent.folders.set(part, child);
      }
      child.count += 1;
      parent = child;
    }
    parent.files.push(file);
  }
  const rows: ChangedFileTreeRow[] = [];
  function append(parent: Folder, depth: number) {
    const children = [...parent.folders.values()].sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      let branch = child;
      let label = child.name;
      while (branch.files.length === 0 && branch.folders.size === 1) {
        branch = branch.folders.values().next().value!;
        label += "/" + branch.name;
      }
      const expanded = !collapsed.has(branch.path);
      rows.push({ kind: "folder", key: "folder:" + branch.path, path: branch.path, label, depth, count: branch.count, expanded });
      if (expanded) append(branch, depth + 1);
    }
    for (const file of [...parent.files].sort((left, right) => left.path.localeCompare(right.path))) {
      rows.push({ kind: "file", key: "file:" + file.path, file, depth });
    }
  }
  append(root, 0);
  return rows;
}

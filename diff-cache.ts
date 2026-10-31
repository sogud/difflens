export function createDiffCache() {
  const entries = new Map<string, { patch: string; bytes: number; expires: number }>();
  const maxEntries = 6;
  const maxBytes = 2 * 1024 * 1024;
  const maxEntryBytes = 512 * 1024;
  let bytes = 0;
  function remove(key: string) {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes; entries.delete(key); }
  }
  return {
    clear() { entries.clear(); bytes = 0; },
    get(key: string): string | null {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expires <= Date.now()) { remove(key); return null; }
      entries.delete(key);
      entries.set(key, entry);
      return entry.patch;
    },
    set(key: string, patch: string) {
      remove(key);
      const cost = patch.length * 2;
      if (cost > maxEntryBytes) return;
      entries.set(key, { patch, bytes: cost, expires: Date.now() + 3000 });
      bytes += cost;
      while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value!);
    },
  };
}

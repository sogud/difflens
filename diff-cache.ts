/** Bounded read snapshots; every re-open is verified natively before it becomes current. */
export function createReadCache<T>(sizeOf: (value: T) => number, maxEntries = 6) {
  const entries = new Map<string, { value: T; bytes: number }>();
  const maxBytes = 2 * 1024 * 1024;
  const maxEntryBytes = 512 * 1024;
  let bytes = 0;
  function remove(key: string) {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes; entries.delete(key); }
  }
  return {
    clear() { entries.clear(); bytes = 0; },
    get(key: string): T | null {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T) {
      remove(key);
      const cost = sizeOf(value);
      if (cost > maxEntryBytes) return;
      entries.set(key, { value, bytes: cost });
      bytes += cost;
      while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value!);
    },
  };
}

export function createDiffCache() {
  return createReadCache<string>(patch => patch.length * 2);
}

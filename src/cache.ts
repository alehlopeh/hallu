// In-memory page cache, keyed by path. Every page renders from the same DB, so
// any data mutation invalidates every entry except the page that was just patched.

export class PageCache {
  private store = new Map<string, string>();

  // `enabled = false` (cacheHtml: false) makes this a null cache: every get misses, so every
  // request re-renders through the model against live data.
  constructor(private enabled = true) {}

  get(path: string): string | undefined {
    return this.enabled ? this.store.get(path) : undefined;
  }
  put(path: string, html: string): void {
    if (this.enabled) this.store.set(path, html);
  }
  clearAll(): void {
    this.store.clear();
  }
  invalidateExcept(path: string): void {
    const keep = this.store.get(path);
    this.store.clear();
    if (keep !== undefined) this.store.set(path, keep);
  }
  // Drop only the entries the predicate selects; leave the rest cached.
  invalidateWhere(shouldDrop: (path: string) => boolean): void {
    for (const key of [...this.store.keys()]) if (shouldDrop(key)) this.store.delete(key);
  }
}

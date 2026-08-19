/**
 * A Map whose entries expire.
 *
 * The Plaid and Google OAuth flows both parked pending state in a plain Map
 * keyed by a random token, deleted only on a successful callback. Every
 * abandoned link attempt — user closes the browser, bank login fails — left an
 * entry behind for the lifetime of the process.
 */
export class ExpiringMap<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  set(key: K, value: V): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  /** Drop everything already expired. Call periodically. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }
}

/** OAuth round-trips are interactive; 15 minutes is generous. */
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

const registry = new Set<ExpiringMap<unknown, unknown>>();

/** Register a map for periodic sweeping (mirrors the pattern in usage-limit.ts). */
export function autoSweep<K, V>(map: ExpiringMap<K, V>): ExpiringMap<K, V> {
  registry.add(map as ExpiringMap<unknown, unknown>);
  return map;
}

setInterval(() => {
  for (const map of registry) map.sweep();
}, 60_000).unref();

/**
 * Lightweight per-key usage caps for OpenAI-backed endpoints. Guards spend, not
 * abuse (auth.ts's rate limiters cover brute-force). In-memory like the auth
 * limiters — acceptable for the current single-instance deployment; restarting
 * the process resets counters, which only errs in the user's favor.
 */

interface Window {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, Window>>();

/**
 * Count one use of `bucket` for `key`; returns false when over `max` per
 * `windowMs`. e.g. allowUsage("ai-chat", userId, 30, 5*60_000).
 */
export function allowUsage(bucket: string, key: string, max: number, windowMs: number): boolean {
  let store = stores.get(bucket);
  if (!store) {
    store = new Map();
    stores.set(bucket, store);
  }
  const now = Date.now();
  const win = store.get(key);
  if (!win || now > win.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (win.count >= max) return false;
  win.count++;
  return true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Short-window + daily cap in one call. */
export function allowUsageTiered(
  bucket: string,
  key: string,
  opts: { burstMax: number; burstWindowMs: number; dailyMax: number }
): boolean {
  return (
    allowUsage(`${bucket}:burst`, key, opts.burstMax, opts.burstWindowMs) &&
    allowUsage(`${bucket}:daily`, key, opts.dailyMax, DAY_MS)
  );
}

// Purge expired windows so long-lived processes don't leak.
setInterval(() => {
  const now = Date.now();
  for (const store of stores.values()) {
    for (const [key, win] of store) if (now > win.resetAt) store.delete(key);
  }
}, 60_000).unref();

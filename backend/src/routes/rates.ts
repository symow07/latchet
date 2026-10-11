import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { env } from "../env";
import { prisma } from "../prisma";
import { fetchWithTimeout } from "../lib/fetch-timeout";
import { cacheAdd, cacheDeleteIf, cacheGet, cacheSet } from "../lib/distributed/cache";
import type { Db } from "../lib/distributed/clock";

/**
 * Exchange rates, proxied and cached.
 *
 * The mobile app shipped a hardcoded rate table written around early 2024 —
 * its own comment said "in production, fetch from an API" — and convertCurrency
 * did real money arithmetic with it. Rates like TRY 32 and ARS 875 are wrong by
 * enough to make a converted balance meaningless.
 *
 * Proxied rather than called from the client so one upstream request per day
 * serves every user — on every instance — and so the provider can be swapped
 * (or given a key) without shipping a new app build.
 */

export interface RatesPayload {
  base: string;
  /** code → units of that currency per 1 unit of base. */
  rates: Record<string, number>;
  /** YYYY-MM-DD the upstream provider last updated. */
  asOf: string;
  source: string;
}

/** Rates are refetched once they are a day old. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8_000;
/** The last good rates are kept this long for when the provider is down. */
const LAST_GOOD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * How long one instance may hold the right to refresh the rates: the
 * upstream timeout plus room to store the answer. A holder that crashes
 * leaves a lock that simply expires.
 */
const FILL_LOCK_TTL_MS = UPSTREAM_TIMEOUT_MS + 4_000;
/** How often a request waiting on another instance's fetch looks again. */
const FILL_POLL_MS = 100;

/**
 * Where the rates live: in CacheEntry, shared by every instance, where this
 * module used to hold them in a variable. Each instance then fetched its own
 * copy on its first request of the day, and a deploy started over. Now one
 * fetch a day serves the whole fleet:
 *
 *   rates:latest     the current rates, for CACHE_TTL_MS (database clock)
 *   rates:last-good  the same rates, kept a month, served when the provider
 *                    fails — stale rates beat no rates, and the client labels
 *                    them with asOf either way
 *   rates:refresh    a lock (cacheAdd) naming the request that is fetching;
 *                    every other request, on any instance, waits for its
 *                    result instead of fetching too
 */
const LATEST_KEY = "rates:latest";
const LAST_GOOD_KEY = "rates:last-good";
const FILL_LOCK_KEY = "rates:refresh";

/** Shape returned by the default provider (open.er-api.com). */
interface UpstreamResponse {
  result?: string;
  base_code?: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
}

export function parseUpstream(json: UpstreamResponse, source: string): RatesPayload | null {
  if (!json?.rates || typeof json.rates !== "object") return null;

  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(json.rates)) {
    if (typeof value === "number" && isFinite(value) && value > 0) {
      rates[code.toUpperCase()] = value;
    }
  }
  if (Object.keys(rates).length === 0) return null;

  const updated = json.time_last_update_utc
    ? new Date(json.time_last_update_utc)
    : new Date();
  const asOf = (isNaN(updated.getTime()) ? new Date() : updated)
    .toISOString()
    .split("T")[0]!;

  return { base: (json.base_code ?? "USD").toUpperCase(), rates, asOf, source };
}

async function fetchUpstream(): Promise<RatesPayload> {
  const url = env.EXCHANGE_RATES_URL;
  const res = await fetchWithTimeout(url, { timeoutMs: UPSTREAM_TIMEOUT_MS });
  if (!res.ok) throw new Error(`rates provider HTTP ${res.status}`);
  const parsed = parseUpstream((await res.json()) as UpstreamResponse, new URL(url).host);
  if (!parsed) throw new Error("rates provider returned no usable rates");
  return parsed;
}

export interface RatesDeps {
  db: Db;
  fetchUpstream: () => Promise<RatesPayload>;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: RatesDeps = {
  db: prisma,
  fetchUpstream,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * The current rates: from the shared cache when fresh, otherwise fetched
 * once for every instance, otherwise the last good rates. Null when there is
 * nothing to serve at all.
 */
export async function getRates(deps: RatesDeps = defaultDeps): Promise<RatesPayload | null> {
  const { db } = deps;
  const fresh = await cacheGet<RatesPayload>(LATEST_KEY, db);
  if (fresh) return fresh;

  const holder = randomUUID();
  if (await cacheAdd(FILL_LOCK_KEY, holder, FILL_LOCK_TTL_MS, db)) {
    try {
      // Another holder may have stored fresh rates between the miss above and
      // taking the lock; fetching again would be the duplicate this prevents.
      const filled = await cacheGet<RatesPayload>(LATEST_KEY, db);
      if (filled) return filled;

      const payload = await deps.fetchUpstream();
      await cacheSet(LATEST_KEY, payload, CACHE_TTL_MS, db);
      await cacheSet(LAST_GOOD_KEY, payload, LAST_GOOD_TTL_MS, db);
      return payload;
    } catch (e) {
      console.warn("[rates] upstream failed:", e instanceof Error ? e.message : e);
      return cacheGet<RatesPayload>(LAST_GOOD_KEY, db);
    } finally {
      // Only our own lock: if it expired and someone else took it, theirs stays.
      await cacheDeleteIf(FILL_LOCK_KEY, holder, db).catch(() => {});
    }
  }

  // Another request, here or on another instance, is fetching. Wait for its
  // answer rather than asking the provider a second time.
  const deadline = Date.now() + FILL_LOCK_TTL_MS;
  while (Date.now() < deadline) {
    await deps.sleep(FILL_POLL_MS);
    const filled = await cacheGet<RatesPayload>(LATEST_KEY, db);
    if (filled) return filled;
    // The lock is gone with nothing stored: that fetch failed.
    if ((await cacheGet<string>(FILL_LOCK_KEY, db)) === null) break;
  }
  return cacheGet<RatesPayload>(LAST_GOOD_KEY, db);
}

export function createRatesRouter(deps: Partial<RatesDeps> = {}) {
  const resolved: RatesDeps = { ...defaultDeps, ...deps };
  const router = new Hono();

  router.get("/", async (c) => {
    const payload = await getRates(resolved);
    if (payload) return c.json(payload);
    return c.json({ error: "Exchange rates are unavailable right now." }, 503);
  });

  return router;
}

export const ratesRouter = createRatesRouter();

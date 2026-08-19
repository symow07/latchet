import { Hono } from "hono";
import { env } from "../env";
import { fetchWithTimeout } from "../lib/fetch-timeout";

/**
 * Exchange rates, proxied and cached.
 *
 * The mobile app shipped a hardcoded rate table written around early 2024 —
 * its own comment said "in production, fetch from an API" — and convertCurrency
 * did real money arithmetic with it. Rates like TRY 32 and ARS 875 are wrong by
 * enough to make a converted balance meaningless.
 *
 * Proxied rather than called from the client so one upstream request per day
 * serves every user, and so the provider can be swapped (or given a key)
 * without shipping a new app build.
 */

export interface RatesPayload {
  base: string;
  /** code → units of that currency per 1 unit of base. */
  rates: Record<string, number>;
  /** YYYY-MM-DD the upstream provider last updated. */
  asOf: string;
  source: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8_000;

let cached: { payload: RatesPayload; fetchedAt: number } | null = null;
let inFlight: Promise<RatesPayload> | null = null;

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

const router = new Hono();

router.get("/", async (c) => {
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (fresh) return c.json(cached!.payload);

  try {
    // Collapse concurrent misses into one upstream request.
    inFlight ??= fetchUpstream();
    const payload = await inFlight;
    cached = { payload, fetchedAt: Date.now() };
    return c.json(payload);
  } catch (e) {
    console.warn(
      "[rates] upstream failed:",
      e instanceof Error ? e.message : e
    );
    // Stale rates beat no rates — the client labels them with asOf either way.
    if (cached) return c.json(cached.payload);
    return c.json({ error: "Exchange rates are unavailable right now." }, 503);
  } finally {
    inFlight = null;
  }
});

export { router as ratesRouter };

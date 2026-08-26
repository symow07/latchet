/**
 * Exchange rates: fetch, cache, and fall back.
 *
 * Rates come from the backend (which proxies a provider and caches for a day),
 * are persisted locally so a cold start offline still has something recent, and
 * fall back to the snapshot bundled in currencies.ts as a last resort.
 *
 * Every path records the date the rates were published, so the UI can say which
 * day's rates a converted figure rests on rather than implying live data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api/api';
import { CURRENCIES, BUNDLED_RATES_AS_OF, setActiveRates } from './currencies';

const CACHE_KEY = '@exchange_rates_v1';
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

export interface RatesSnapshot {
  base: string;
  rates: Record<string, number>;
  /** YYYY-MM-DD the provider published these. */
  asOf: string;
  source: string;
}

interface CachedSnapshot {
  snapshot: RatesSnapshot;
  fetchedAt: number;
}

/** The table compiled into the app. Correct-ish, and openly dated. */
export function bundledSnapshot(): RatesSnapshot {
  const rates: Record<string, number> = {};
  // Most currencies now carry no bundled rate at all — they exist in the list
  // so they can be selected, and their rate comes from the live table. Only
  // the ones that shipped before the list was widened have an offline value.
  for (const c of CURRENCIES) if (c.rate !== undefined) rates[c.code] = c.rate;
  return { base: 'USD', rates, asOf: BUNDLED_RATES_AS_OF, source: 'bundled' };
}

async function readCache(): Promise<CachedSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSnapshot;
    if (!parsed?.snapshot?.rates) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(snapshot: RatesSnapshot): Promise<void> {
  await AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ snapshot, fetchedAt: Date.now() } satisfies CachedSnapshot)
  );
}

/**
 * Install the best rates available and return them.
 *
 * Applies the cached snapshot immediately so conversions are never blocked on
 * the network, then refreshes when it has aged out.
 */
export async function loadRates(): Promise<RatesSnapshot> {
  const cached = await readCache();
  if (cached) setActiveRates(cached.snapshot.rates, cached.snapshot.asOf);

  const stale = !cached || Date.now() - cached.fetchedAt > REFRESH_AFTER_MS;
  if (!stale) return cached!.snapshot;

  try {
    const fresh = await api.get<RatesSnapshot>('/api/rates');
    if (fresh?.rates && Object.keys(fresh.rates).length > 0) {
      setActiveRates(fresh.rates, fresh.asOf);
      await writeCache(fresh).catch(() => {});
      return fresh;
    }
  } catch (e) {
    console.warn(
      '[rates] refresh failed, keeping existing rates:',
      e instanceof Error ? e.message : e
    );
  }

  // Offline on a cold start: the bundled table is stale, but refusing to
  // convert is worse — and getRatesAsOf() says exactly how stale it is.
  return cached?.snapshot ?? bundledSnapshot();
}

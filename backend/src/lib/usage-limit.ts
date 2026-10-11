import { hitWindow } from "./distributed/counter";
import type { Db } from "./distributed/clock";

/**
 * Per-key usage caps for the OpenAI-backed endpoints. Guards spend, not abuse
 * (auth.ts's rate limiters cover brute force).
 *
 * Counted through lib/distributed/counter, in Postgres, so every instance
 * draws on one allowance. These were Maps in each process: with two instances
 * a free user's five advisor calls a day were ten, and a deploy reset them.
 */

/**
 * Count one use of `bucket` for `key`; resolves false when over `max` per
 * `windowMs`. e.g. allowUsage("ai-chat", userId, 30, 5*60_000).
 *
 * A refused use is not counted against the next window, and does not extend
 * the current one.
 */
export async function allowUsage(
  bucket: string,
  key: string,
  max: number,
  windowMs: number,
  db?: Db
): Promise<boolean> {
  return (await hitWindow(`usage:${bucket}:${key}`, max, windowMs, db)).allowed;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Short-window + daily cap in one call. The daily cap is only counted when
 * the burst cap allows the use, so a burst-limited caller does not also burn
 * through the day.
 */
export async function allowUsageTiered(
  bucket: string,
  key: string,
  opts: { burstMax: number; burstWindowMs: number; dailyMax: number },
  db?: Db
): Promise<boolean> {
  return (
    (await allowUsage(`${bucket}:burst`, key, opts.burstMax, opts.burstWindowMs, db)) &&
    (await allowUsage(`${bucket}:daily`, key, opts.dailyMax, DAY_MS, db))
  );
}

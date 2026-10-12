/**
 * The optional AI fallback, capped per user per day. The parser library calls
 * it only for billing-looking mail its rules could not read; a refused call
 * throws, which the library treats as "no AI answer" and keeps the rules'.
 */

import { hitWindow } from "../distributed/counter";
import type { Db } from "../distributed/clock";
import { openAiExtractor, type AiExtractor } from "../email-parse";
import { AI_DAILY_CAP_PER_USER } from "./limits";

const DAY_MS = 24 * 60 * 60 * 1000;

export class AiCapReachedError extends Error {
  constructor() {
    super("ai_cap_reached");
    this.name = "AiCapReachedError";
  }
}

/** `base` behind a per-user daily allowance; null when there is no key. */
export function cappedAi(
  userId: string,
  opts: { apiKey: string | null; base?: AiExtractor; cap?: number; db?: Db }
): AiExtractor | null {
  if (!opts.apiKey && !opts.base) return null;
  const base = opts.base ?? openAiExtractor(opts.apiKey!);
  const cap = opts.cap ?? AI_DAILY_CAP_PER_USER;
  return {
    async extract(input) {
      const hit = await hitWindow(`email-ai:${userId}`, cap, DAY_MS, opts.db);
      if (!hit.allowed) throw new AiCapReachedError();
      return base.extract(input);
    },
  };
}

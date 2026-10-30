/** Where OpenAI's API is. */
const OPENAI_BASE = "https://api.openai.com";

/**
 * An OpenAI API URL: `openaiUrl("/v1/chat/completions", env)`.
 *
 * Outside production, OPENAI_BASE_OVERRIDE points the calls at a stand-in
 * instead (the end-to-end suite's fake, which records what the app uploaded).
 * Production always calls OpenAI, whatever the variable says.
 */
export function openaiUrl(
  path: string,
  e: { NODE_ENV?: string; OPENAI_BASE_OVERRIDE?: string }
): string {
  const override = e.NODE_ENV !== "production" ? e.OPENAI_BASE_OVERRIDE?.trim() : undefined;
  return (override ? override.replace(/\/+$/, "") : OPENAI_BASE) + path;
}

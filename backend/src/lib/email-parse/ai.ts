/**
 * The optional AI extractor: OpenAI's chat completions in JSON mode. Used only
 * when OPENAI_API_KEY is set and the rules could not read a billing email.
 * It receives the sender's domain, the subject and a masked, truncated text —
 * never an address — and whatever it answers is validated like the rules'
 * output. Nothing here logs content, and errors carry only the HTTP status.
 */

import { fetchWithTimeout } from "../fetch-timeout";
import type { AiExtractor } from "./types";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 20_000;

export const AI_SYSTEM_PROMPT =
  "You read ONE email (sender domain, subject, text) and extract billing facts. Reply ONLY with a JSON object: " +
  '{"isBilling":boolean,"kind":"renewal"|"receipt"|"trial_ending"|"price_change"|"cancellation"|"other",' +
  '"merchant":string|null,"billedVia":"apple"|"google_play"|"paypal"|null,"amount":number|null,"currency":string|null,' +
  '"cadence":"weekly"|"biweekly"|"monthly"|"quarterly"|"semiannual"|"yearly"|"unknown",' +
  '"chargedDate":string|null,"nextChargeDate":string|null,"trialEndDate":string|null,"previousAmount":number|null}. ' +
  "isBilling is false for shipping notices, password or security mail, newsletters and marketing. " +
  "merchant is the brand that bills (for App Store, Google Play or PayPal receipts, the app or business paid, not Apple, Google or PayPal). " +
  "amount is the total actually charged or to be charged (not a tax, subtotal or discount line); for a price change it is the new price and previousAmount the old one. " +
  "currency is the ISO 4217 code shown or clearly implied by the email, otherwise null — never assume USD. " +
  "Dates are YYYY-MM-DD exactly as the email states them, otherwise null. Do not invent values; use null when unsure. No prose, no markdown.";

export function openAiExtractor(apiKey: string): AiExtractor {
  return {
    async extract(input) {
      const user = `Sender domain: ${input.senderDomain ?? "unknown"}\nSubject: ${input.subject}\n\n${input.text}`;
      const res = await fetchWithTimeout(OPENAI_URL, {
        method: "POST",
        timeoutMs: TIMEOUT_MS,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: AI_SYSTEM_PROMPT },
            { role: "user", content: user },
          ],
          temperature: 0,
          max_tokens: 400,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") return null;
      try {
        return JSON.parse(content) as unknown;
      } catch {
        return null;
      }
    },
  };
}

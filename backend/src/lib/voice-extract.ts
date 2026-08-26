/**
 * Normalising a model's extraction from spoken input.
 *
 * Same job as statement-extract and the same distrust of the model's output,
 * but speech differs from a bank statement in one way that matters: a missing
 * date is not a failure. "I spent twelve on lunch" means today, and dropping
 * that row — which is what normaliseStatementRows correctly does for a
 * statement — would silently swallow the thing the user just said out loud.
 *
 * What is NOT relaxed is the amount. Speech is the least reliable input the
 * app has: "fifteen" and "fifty" differ by one consonant, currency is often
 * implied, and background noise is normal. A row without a usable amount is
 * dropped, never guessed, and everything that survives is shown to the user
 * for review before it reaches the database.
 *
 * Dependency-free so the validation can be tested without calling OpenAI.
 */
import {
  coerceAmount,
  coerceCategory,
  coerceDate,
  coerceType,
} from "./statement-extract";

/**
 * Cap on rows from one recording. A two-minute monologue is a handful of
 * transactions; a hundred means the model has lost the plot.
 */
export const MAX_VOICE_ROWS = 40;

export interface VoiceRow {
  dateISO: string;
  amount: number;
  type: "Expense" | "Income";
  category: string;
  note: string;
}

/**
 * Turn whatever the model heard into rows safe to put in front of the user.
 *
 * `todayISO` is the speaker's local date, not the server's. A user in Shanghai
 * recording at 08:00 is on a different calendar day from the server, and
 * defaulting to the server's date would file the morning's coffee under
 * yesterday.
 */
export function normaliseVoiceRows(raw: unknown, todayISO: string): VoiceRow[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { transactions?: unknown })?.transactions)
      ? (raw as { transactions: unknown[] }).transactions
      : [];

  const rows: VoiceRow[] = [];
  for (const item of list) {
    if (rows.length >= MAX_VOICE_ROWS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    const amount = coerceAmount(r.amount);
    // No amount, no row. This is the one thing speech must never invent.
    if (amount === null || amount === 0) continue;

    // A date the model resolved wins; otherwise the utterance was about now.
    const dateISO = coerceDate(r.dateISO ?? r.date) ?? todayISO;

    const note = typeof r.note === "string" ? r.note.trim().slice(0, 200) : "";

    rows.push({
      dateISO,
      amount,
      type: coerceType(r.type, "Expense"),
      category: coerceCategory(r.category),
      note,
    });
  }
  return rows;
}

/**
 * The instruction given to the extraction model.
 *
 * Kept here beside the validator so the two stay in step: the prompt names the
 * exact categories coerceCategory will accept, and asks for absolute dates
 * because coerceDate rejects anything that is not YYYY-MM-DD. Relative dates
 * are resolved against the speaker's own day, which is why it has to be passed
 * in rather than assumed.
 */
export function voiceExtractionPrompt(todayISO: string, categories: readonly string[]): string {
  return [
    "You turn a spoken description of someone's spending into structured transactions.",
    `Today is ${todayISO} in the speaker's own timezone.`,
    "Reply ONLY with compact JSON: {\"transactions\": [{\"amount\": number, \"type\": \"Expense\"|\"Income\", " +
      `"category": one of ${JSON.stringify(categories)}, "note": string, "dateISO": "YYYY-MM-DD"}]}.`,
    "Rules:",
    "- amount is a positive number. Never invent one: if a figure was not stated, omit the transaction entirely.",
    `- Resolve relative dates ("yesterday", "last Friday") against ${todayISO} and output YYYY-MM-DD.`,
    "- If no date was mentioned, omit dateISO rather than guessing a past date.",
    "- note is a short human description, e.g. the merchant or what was bought.",
    "- Money received, earned, refunded or paid to the speaker is Income; everything else is Expense.",
    "- One utterance can contain several transactions. Return them all.",
    "- If the speaker mentioned no money at all, return an empty array.",
    "No prose, no markdown.",
  ].join("\n");
}

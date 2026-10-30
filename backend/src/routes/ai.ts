import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "../auth";
import { env } from "../env";
import { allowUsageTiered } from "../lib/usage-limit";
import { aiAllowance } from "../lib/entitlement";
import { userIsPro } from "../lib/user-entitlement";
import { fetchWithTimeout } from "../lib/fetch-timeout";
import { openaiUrl } from "../lib/openai-url";
import {
  normaliseStatementRows,
  STATEMENT_CATEGORIES,
} from "../lib/statement-extract";
import { normaliseVoiceRows, voiceExtractionPrompt } from "../lib/voice-extract";
import { buildChatMessages } from "../lib/advisor-safety";

/**
 * AI proxy routes. The mobile app used to call OpenAI directly with a public
 * env var, which leaked the key in the bundle and broke in production. These
 * endpoints keep the key server-side. If OPENAI_API_KEY is unset, every route
 * degrades to 503 instead of crashing the backend.
 */

const OPENAI_URL = openaiUrl("/v1/chat/completions", env);
const OPENAI_TRANSCRIBE_URL = openaiUrl("/v1/audio/transcriptions", env);
const CHAT_MODEL = "gpt-4o-mini";
const VISION_MODEL = "gpt-4o";
const TRANSCRIBE_MODEL = "whisper-1";

const CATEGORIES = ["Food", "Transport", "Shopping", "Gym", "Subscriptions", "Other"] as const;

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Auth guard, entitlement check, and per-user spend cap for all AI routes.
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!env.OPENAI_API_KEY) {
    return c.json({ error: "AI features are not configured on this server." }, 503);
  }

  // The tier is read from the database, never from the request. A client
  // claiming Pro gets exactly the free allowance.
  const pro = await userIsPro(user.id);
  const allowance = aiAllowance(pro);

  // Counted in Postgres (lib/usage-limit.ts), so the allowance is one per
  // user across every instance, not one per instance.
  if (!(await allowUsageTiered("ai", user.id, allowance))) {
    // 402 rather than 429 for a free user who has used their taste of the
    // advisor: this is a paywall, not congestion, and the client should offer
    // an upgrade rather than "try again later".
    if (!pro) {
      return c.json(
        {
          error: `You've used your ${allowance.dailyMax} free AI requests for today.`,
          code: "upgrade_required",
          tier: "free",
        },
        402
      );
    }
    return c.json({ error: "AI usage limit reached. Please try again later." }, 429);
  }
  await next();
});

/** Thin OpenAI chat-completions caller. Throws on non-2xx. */
async function openaiChat(body: Record<string, unknown>): Promise<any> {
  const res = await fetchWithTimeout(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const chatSchema = z
  .object({
    // Current shape: the app supplies persona and its own spending figures for
    // the system role, plus the conversation as real turns.
    system: z.string().max(20000).optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(20000),
        })
      )
      .max(40)
      .optional(),
    // Legacy shape: one pre-assembled string, everything in a single user
    // message. Still accepted because builds sit on devices for weeks, and
    // breaking the advisor for anyone who has not updated is worse than
    // carrying this. buildChatMessages gives them the system role regardless.
    prompt: z.string().min(1).max(20000).optional(),
  })
  .refine((v) => v.prompt || v.messages?.length, {
    message: "Provide either messages or prompt",
  });

router.post("/chat", zValidator("json", chatSchema), async (c) => {
  const input = c.req.valid("json");
  try {
    const data = await openaiChat({
      model: CHAT_MODEL,
      // The hard constraints are prepended here, server-side, so no client can
      // omit them — see lib/advisor-safety.ts.
      messages: buildChatMessages(input),
      temperature: 0.7,
      max_tokens: 600,
    });
    const response: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!response) return c.json({ error: "Empty AI response" }, 502);
    return c.json({ response });
  } catch (e) {
    console.error("[ai:chat]", e instanceof Error ? e.message : e);
    return c.json({ error: "AI request failed" }, 502);
  }
});

// ~10 MB of decoded image. Base64 inflates by 4/3, so cap the encoded string
// accordingly — unbounded, a single request could exhaust memory before the
// OpenAI call was ever made.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES * 1.37);

const receiptSchema = z.object({
  // Raw base64 (no data: prefix) as produced by expo-image-picker base64 option.
  image: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS),
});

router.post("/analyze-receipt", zValidator("json", receiptSchema), async (c) => {
  const { image } = c.req.valid("json");
  const dataUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
  try {
    const data = await openaiChat({
      model: VISION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You extract a single expense from a receipt photo. Reply ONLY with compact JSON " +
            `{"amount": number, "category": one of ${JSON.stringify(CATEGORIES)}, "note": string}. ` +
            "amount is the grand total as a number. note is the merchant name. No prose, no markdown.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the expense from this receipt." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const category = (CATEGORIES as readonly string[]).includes(parsed.category)
      ? parsed.category
      : "Other";
    return c.json({
      amount: Number(parsed.amount) || 0,
      category,
      note: typeof parsed.note === "string" ? parsed.note : "",
    });
  } catch (e) {
    console.error("[ai:analyze-receipt]", e instanceof Error ? e.message : e);
    return c.json({ error: "Receipt analysis failed" }, 502);
  }
});

// ~10 MB of PDF. Statements are text-heavy and small; anything larger is not a
// statement, and the vision model would reject it anyway.
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BASE64_CHARS = Math.ceil(MAX_PDF_BYTES * 1.37);

const statementSchema = z.object({
  /** Raw base64 PDF (no data: prefix), as produced by expo-file-system. */
  file: z.string().min(1).max(MAX_PDF_BASE64_CHARS),
  filename: z.string().max(200).optional(),
});

/**
 * Extract transactions from a PDF bank statement.
 *
 * Many banks — especially outside the US — offer only PDF. Since import is the
 * app's universal rail, a PDF-only bank must not mean no import at all.
 *
 * The model's output is treated as untrusted: normaliseStatementRows drops
 * anything without a real date and amount rather than guessing, because a
 * statement import that invents a date is worse than one that skips a line.
 */
router.post("/analyze-statement", zValidator("json", statementSchema), async (c) => {
  const { file, filename } = c.req.valid("json");
  const dataUrl = file.startsWith("data:") ? file : `data:application/pdf;base64,${file}`;

  try {
    const data = await openaiChat({
      model: VISION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You extract every transaction from a bank statement PDF. Reply ONLY with compact " +
            'JSON {"transactions": [{"dateISO": "YYYY-MM-DD", "amount": number, ' +
            `"type": "Expense"|"Income", "category": one of ${JSON.stringify(STATEMENT_CATEGORIES)}, ` +
            '"note": string}]}. ' +
            "dateISO must be the transaction date in YYYY-MM-DD, converted from whatever format " +
            "the statement uses — read the statement's own date convention from its header or " +
            "from days above 12. amount is always positive; direction goes in type. note is the " +
            "merchant or description. Skip opening/closing balances, running totals, subtotals " +
            "and interest summaries — transactions only. If you cannot read a row, omit it " +
            "rather than guessing. No prose, no markdown.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract every transaction from this statement." },
            {
              type: "file",
              file: { filename: filename ?? "statement.pdf", file_data: dataUrl },
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 8000,
      response_format: { type: "json_object" },
    });

    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    const transactions = normaliseStatementRows(JSON.parse(raw));

    if (transactions.length === 0) {
      return c.json(
        { error: "No transactions could be read from that statement.", transactions: [] },
        422
      );
    }
    return c.json({ transactions });
  } catch (e) {
    console.error("[ai:analyze-statement]", e instanceof Error ? e.message : e);
    return c.json({ error: "Statement analysis failed" }, 502);
  }
});

// ~8 MB of audio. At Whisper's bitrate that is several minutes of speech,
// which is far longer than anyone narrates a day's spending for.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES * 1.37);

const voiceSchema = z.object({
  /** Raw base64 audio (no data: prefix), as produced by expo-file-system. */
  audio: z.string().min(1).max(MAX_AUDIO_BASE64_CHARS),
  /** Container the client recorded, so Whisper gets a filename it accepts. */
  format: z.enum(["m4a", "mp3", "wav", "webm"]).default("m4a"),
  /**
   * The speaker's local date. Not derived server-side on purpose: a user in
   * Shanghai recording at 08:00 is a day ahead of a UTC server, and "today"
   * has to mean their today or the morning's coffee lands on yesterday.
   */
  todayISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** BCP-47 hint for Whisper. Optional; it auto-detects without one. */
  language: z.string().max(10).optional(),
});

/**
 * Turn a spoken description of a day's spending into reviewable transactions.
 *
 * Two calls: Whisper for the words, then the chat model for the structure.
 * Split rather than combined because they fail differently — a bad recording
 * fails at transcription and is worth telling the user about specifically,
 * where a clean transcript with no money in it is a legitimate empty result.
 *
 * Nothing here writes to the database. The rows come back for the user to
 * review and confirm, for the same reason receipt scanning does: speech is
 * the least reliable input the app has, and a misheard amount silently
 * entered is worse than one the user has to correct.
 */
router.post("/voice-transactions", zValidator("json", voiceSchema), async (c) => {
  const { audio, format, todayISO, language } = c.req.valid("json");

  let transcript: string;
  try {
    const bytes = Buffer.from(audio, "base64");
    const form = new FormData();
    form.append("file", new Blob([bytes]), `speech.${format}`);
    form.append("model", TRANSCRIBE_MODEL);
    if (language) form.append("language", language.slice(0, 2));

    const res = await fetchWithTimeout(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
    }
    transcript = String(((await res.json()) as { text?: string })?.text ?? "").trim();
  } catch (e) {
    console.error("[ai:voice-transcribe]", e instanceof Error ? e.message : e);
    return c.json({ error: "Could not transcribe that recording." }, 502);
  }

  if (!transcript) {
    return c.json({ transcript: "", transactions: [] });
  }

  try {
    const data = await openaiChat({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: voiceExtractionPrompt(todayISO, STATEMENT_CATEGORIES) },
        { role: "user", content: transcript },
      ],
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    });

    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    const transactions = normaliseVoiceRows(JSON.parse(raw), todayISO);
    // An empty list is a real answer, not an error: someone can talk for a
    // minute without naming a single figure. The transcript goes back either
    // way so the user can see what was heard.
    return c.json({ transcript, transactions });
  } catch (e) {
    console.error("[ai:voice-extract]", e instanceof Error ? e.message : e);
    return c.json({ error: "Could not read transactions from that recording.", transcript }, 502);
  }
});

export { router as aiRouter };

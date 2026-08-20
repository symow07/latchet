import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "../auth";
import { env } from "../env";
import { allowUsageTiered } from "../lib/usage-limit";
import { aiAllowance } from "../lib/entitlement";
import { userIsPro } from "../lib/user-entitlement";
import { fetchWithTimeout } from "../lib/fetch-timeout";
import {
  normaliseStatementRows,
  STATEMENT_CATEGORIES,
} from "../lib/statement-extract";

/**
 * AI proxy routes. The mobile app used to call OpenAI directly with a public
 * env var, which leaked the key in the bundle and broke in production. These
 * endpoints keep the key server-side. If OPENAI_API_KEY is unset, every route
 * degrades to 503 instead of crashing the backend.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CHAT_MODEL = "gpt-4o-mini";
const VISION_MODEL = "gpt-4o";

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

  if (!allowUsageTiered("ai", user.id, allowance)) {
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

const chatSchema = z.object({
  // The mobile side already assembles the full prompt via buildAIPrompt().
  prompt: z.string().min(1).max(20000),
});

router.post("/chat", zValidator("json", chatSchema), async (c) => {
  const { prompt } = c.req.valid("json");
  try {
    const data = await openaiChat({
      model: CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
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

export { router as aiRouter };

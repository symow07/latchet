import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "../auth";
import { env } from "../env";
import { allowUsageTiered } from "../lib/usage-limit";

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

// Auth guard + per-user spend cap for all AI routes
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!env.OPENAI_API_KEY) {
    return c.json({ error: "AI features are not configured on this server." }, 503);
  }
  // Cap OpenAI spend per user: 20 requests / 5 min, 200 / day.
  if (!allowUsageTiered("ai", user.id, { burstMax: 20, burstWindowMs: 5 * 60_000, dailyMax: 200 })) {
    return c.json({ error: "AI usage limit reached. Please try again later." }, 429);
  }
  await next();
});

/** Thin OpenAI chat-completions caller. Throws on non-2xx. */
async function openaiChat(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(OPENAI_URL, {
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

const receiptSchema = z.object({
  // Raw base64 (no data: prefix) as produced by expo-image-picker base64 option.
  image: z.string().min(1),
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

export { router as aiRouter };

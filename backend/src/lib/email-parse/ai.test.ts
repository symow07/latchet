import { afterEach, describe, expect, test } from "bun:test";
import { extractFinding, aiInput } from "./extract";
import { openAiExtractor } from "./ai";
import type { AiExtractor, ParsedMessage } from "./types";

const NOW = new Date("2026-10-12T12:00:00Z");

function msg(over: Partial<ParsedMessage>): ParsedMessage {
  return {
    messageId: "<m1@example.com>",
    fromAddress: "billing@example-streaming.com",
    fromName: "StreamCo",
    senderDomain: "example-streaming.com",
    subject: "Your receipt",
    dateISO: "2026-10-12",
    text: "",
    attachmentsText: [],
    ...over,
  };
}

/** A fake extractor that records what it was sent and answers with `reply`. */
function fake(reply: unknown | (() => Promise<unknown>)) {
  const calls: { senderDomain: string | null; subject: string; text: string }[] = [];
  const extractor: AiExtractor = {
    async extract(input) {
      calls.push(input);
      return typeof reply === "function" ? (reply as () => Promise<unknown>)() : reply;
    },
  };
  return { extractor, calls };
}

// The rules read a receipt but cannot find its amount: written as words.
const UNREADABLE = msg({
  subject: "Your receipt",
  text: "Hi jane.doe@example.com,\nThanks for your payment. You were charged twelve euros and ninety-nine cents for StreamCo Plus.\nManage: https://example-streaming.com/account?id=8812736455123\nCard 4242424242424242",
});

describe("ai", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("ai fallback: never called when the rules are confident, or when no extractor is given", async () => {
    const confident = msg({ fromName: "Spotify", senderDomain: "spotify.com", subject: "Your Spotify Premium receipt", text: "Total $11.99\nMonthly subscription\nSpotify USA Inc., New York, NY 10007" });
    const { extractor, calls } = fake({ kind: "receipt", amount: 1 });
    const f = await extractFinding(confident, { ai: extractor, now: NOW });
    expect(calls).toHaveLength(0);
    expect(f).toMatchObject({ parser: "rules", amount: 11.99, currency: "USD" });
    const withoutAi = await extractFinding(UNREADABLE, { ai: null, now: NOW });
    expect(withoutAi?.parser).toBe("rules");
    expect(withoutAi?.amount).toBeNull();
    // Not billing at all: no call either.
    const shipping = msg({ subject: "Your order has shipped", text: "Track your package." });
    await extractFinding(shipping, { ai: extractor, now: NOW });
    expect(calls).toHaveLength(0);
  });

  test("ai fallback: called for what the rules cannot read; its validated answer fills the gaps", async () => {
    const { extractor, calls } = fake({ isBilling: true, kind: "receipt", merchant: "StreamCo", amount: "12,99", currency: "EUR", cadence: "monthly", chargedDate: "2026-10-12", nextChargeDate: "2026-11-12", trialEndDate: null, previousAmount: null });
    const withEuro = { ...UNREADABLE, text: UNREADABLE.text + "\nAll prices in €." };
    const f = await extractFinding(withEuro, { ai: extractor, now: NOW });
    expect(calls).toHaveLength(1);
    expect(f).toMatchObject({ parser: "ai", kind: "receipt", merchant: "StreamCo", amount: 12.99, currency: "EUR", cadence: "monthly", chargedISO: "2026-10-12", nextChargeISO: "2026-11-12" });
    expect(f!.confidence).toBeGreaterThan(0.6);
    // What the AI saw: the sender's domain, the subject and masked text — no addresses, links or long numbers.
    const sent = calls[0]!;
    expect(sent.senderDomain).toBe("example-streaming.com");
    expect(JSON.stringify(sent)).not.toContain("jane.doe@example.com");
    expect(JSON.stringify(sent)).not.toContain("billing@example-streaming.com");
    expect(sent.text).not.toContain("https://");
    expect(sent.text).not.toContain("4242424242424242");
    expect(sent.text).toContain("[email]");
    expect(sent.text.length).toBeLessThanOrEqual(6000);
  });

  test("ai fallback: where the rules and the AI both answer, the rules win; the AI only fills gaps", async () => {
    // The rules read the merchant and the price but not the trial's end date, so they are not confident.
    const trial = msg({ fromName: "StreamCo", subject: "Your free trial is ending", text: "Your StreamCo free trial is ending soon. Then €9.99/month." });
    const { extractor, calls } = fake({ isBilling: true, kind: "trial_ending", merchant: "Streamco Premium Plus", amount: 19.99, currency: "EUR", cadence: "yearly", trialEndDate: "2026-10-20" });
    const f = await extractFinding(trial, { ai: extractor, now: NOW });
    expect(calls).toHaveLength(1);
    expect(f).toMatchObject({ parser: "ai", kind: "trial_ending", merchant: "StreamCo", amount: 9.99, currency: "EUR", cadence: "monthly", trialEndsISO: "2026-10-20" });
    // An AI answer that adds nothing leaves the rules' finding as it was.
    const same = fake({ isBilling: true, kind: "trial_ending", merchant: "Other", amount: 1 });
    expect((await extractFinding(trial, { ai: same.extractor, now: NOW }))?.parser).toBe("rules");
  });

  test("ai fallback: invalid output is rejected — bad fields dropped, a bad kind or a throw leaves the rules' answer", async () => {
    const bad = fake({ isBilling: true, kind: "receipt", merchant: "x".repeat(200), amount: -4, currency: "USD", cadence: "fortnightly", chargedDate: "2031-01-01", nextChargeDate: "2026-02-30", previousAmount: 3 });
    const f = await extractFinding(UNREADABLE, { ai: bad.extractor, now: NOW });
    expect(bad.calls).toHaveLength(1);
    // Nothing valid came back beyond what the rules had, so the rules' finding stands or the AI one is empty of bad values.
    expect(f).not.toBeNull();
    expect(f!.amount).toBeNull();
    expect(f!.currency).toBeNull(); // the email shows no dollar sign: USD would be a guess
    expect(f!.cadence).toBe("unknown");
    expect(f!.chargedISO === "2031-01-01").toBe(false);
    expect(f!.nextChargeISO).not.toBe("2026-02-30");
    expect(f!.previousAmount).toBeNull();
    expect(f!.merchant?.length ?? 0).toBeLessThanOrEqual(60);

    const nonsense = fake({ kind: "invoice-ish", amount: 12.99 });
    const g = await extractFinding(UNREADABLE, { ai: nonsense.extractor, now: NOW });
    expect(g?.parser).toBe("rules");

    const notJson = fake("I think this is a receipt for 12.99");
    expect((await extractFinding(UNREADABLE, { ai: notJson.extractor, now: NOW }))?.parser).toBe("rules");

    const notBilling = fake({ isBilling: false });
    expect((await extractFinding(UNREADABLE, { ai: notBilling.extractor, now: NOW }))?.parser).toBe("rules");

    const throwing = fake(async () => {
      throw new Error("OpenAI 500");
    });
    expect((await extractFinding(UNREADABLE, { ai: throwing.extractor, now: NOW }))?.parser).toBe("rules");
  });

  test("ai fallback: openAiExtractor posts JSON-mode requests with only domain, subject and masked text, and parses the reply", async () => {
    const requests: { url: string; body: Record<string, unknown>; auth: string | null; signal: boolean }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization"), signal: !!init?.signal });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"isBilling":true,"kind":"receipt","amount":12.99,"currency":"EUR"}' } }] }), { status: 200 });
    }) as typeof fetch;
    const extractor = openAiExtractor("sk-test-not-a-real-key");
    const reply = await extractor.extract(aiInput(UNREADABLE));
    expect(reply).toEqual({ isBilling: true, kind: "receipt", amount: 12.99, currency: "EUR" });
    expect(requests).toHaveLength(1);
    const r = requests[0]!;
    expect(r.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(r.auth).toBe("Bearer sk-test-not-a-real-key");
    expect(r.signal).toBe(true); // through fetch-timeout
    expect(r.body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(r.body)).not.toContain("jane.doe@example.com");
    expect(JSON.stringify(r.body)).not.toContain("billing@example-streaming.com");

    globalThis.fetch = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(extractor.extract(aiInput(UNREADABLE))).rejects.toThrow("OpenAI 429");
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await extractor.extract(aiInput(UNREADABLE))).toBeNull();
  });
});

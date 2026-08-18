import { test, expect } from "bun:test";

// Plaid credentials come from src/test-setup.ts, preloaded before any module
// imports env.ts — the route 503s without them.
import { plaidRouter } from "./plaid";

const body = JSON.stringify({
  webhook_type: "TRANSACTIONS",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  item_id: "item_abc",
});

function post(headers: Record<string, string> = {}) {
  return plaidRouter.request("/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

test("an unsigned webhook is rejected with 401", async () => {
  const res = await post();
  expect(res.status).toBe(401);
});

test("a webhook with a garbage signature is rejected with 401", async () => {
  const res = await post({ "Plaid-Verification": "not-a-jwt" });
  expect(res.status).toBe(401);
});

test("rejection happens before any item lookup or sync", async () => {
  // A real item_id would trigger syncItemTransactions if the guard were
  // bypassed; the response must carry no evidence of that work.
  const res = await post();
  expect(await res.json()).toEqual({ error: "Invalid webhook signature" });
});

import { test, expect } from "bun:test";
import {
  deleteAccount,
  confirmationMatches,
  type DeletionDeps,
  type DeletionTargets,
} from "./account-deletion";

function deps(
  targets: Partial<DeletionTargets> = {},
  failures: { plaid?: boolean; plaidTokens?: string[] } = {}
) {
  const order: string[] = [];
  const impl: DeletionDeps = {
    async loadTargets() {
      return {
        plaidItems: targets.plaidItems ?? [],
      };
    },
    async revokePlaidItem(accessTokenEnc) {
      order.push("revoke-plaid");
      if (failures.plaid || failures.plaidTokens?.includes(accessTokenEnc)) {
        throw new Error("Plaid is down");
      }
    },
    async deleteUser() {
      order.push("delete-user");
    },
  };
  return { impl, order };
}

const plaidItem = { id: "item_1", accessTokenEnc: "enc", institutionName: "Monzo" };

test("grants are revoked before the user is deleted", () => {
  // The tokens live on rows that cascade away with the user. Delete first and
  // the third-party grants stay live forever with nothing left to revoke them.
  const { impl, order } = deps({ plaidItems: [plaidItem] });

  return deleteAccount("u1", impl).then(() => {
    expect(order).toEqual(["revoke-plaid", "delete-user"]);
  });
});

test("a clean deletion reports what it revoked", async () => {
  const { impl } = deps({ plaidItems: [plaidItem] });
  const result = await deleteAccount("u1", impl);

  expect(result).toEqual({
    deleted: true,
    revoked: { banks: 1 },
    unrevoked: [],
  });
});

test("a failed bank revoke does not trap the user in the account", async () => {
  // Being unable to delete because a third party is down is the worse outcome.
  const { impl, order } = deps({ plaidItems: [plaidItem] }, { plaid: true });
  const result = await deleteAccount("u1", impl);

  expect(order).toContain("delete-user");
  expect(result.deleted).toBe(true);
  expect(result.revoked.banks).toBe(0);
});

test("a surviving grant is reported with somewhere to revoke it by hand", async () => {
  const { impl } = deps({ plaidItems: [plaidItem] }, { plaid: true });
  const [grant] = (await deleteAccount("u1", impl)).unrevoked;

  expect(grant).toMatchObject({ kind: "bank", label: "Monzo" });
  expect(grant!.manualRevokeUrl).toContain("plaid.com");
});

test("one failure does not stop the other revocations", async () => {
  const failing = { ...plaidItem, id: "item_down", accessTokenEnc: "enc-down", institutionName: "Barclays" };
  const { impl, order } = deps({ plaidItems: [failing, plaidItem] }, { plaidTokens: ["enc-down"] });
  const result = await deleteAccount("u1", impl);

  expect(order).toEqual(["revoke-plaid", "revoke-plaid", "delete-user"]);
  expect(result.revoked.banks).toBe(1);
  expect(result.unrevoked).toEqual([
    { kind: "bank", label: "Barclays", manualRevokeUrl: "https://my.plaid.com" },
  ]);
});

test("an account with nothing linked still deletes", async () => {
  const { impl, order } = deps();
  const result = await deleteAccount("u1", impl);

  expect(order).toEqual(["delete-user"]);
  expect(result).toEqual({ deleted: true, revoked: { banks: 0 }, unrevoked: [] });
});

test("every linked bank is revoked, not just the first", async () => {
  const { impl, order } = deps({
    plaidItems: [plaidItem, { ...plaidItem, id: "item_2" }, { ...plaidItem, id: "item_3" }],
  });
  await deleteAccount("u1", impl);

  expect(order.filter((o) => o === "revoke-plaid")).toHaveLength(3);
});

// ── Confirmation ─────────────────────────────────────────────────────────────

test("deletion requires the account's own email, typed out", () => {
  expect(confirmationMatches("a@example.com", "a@example.com")).toBe(true);
  expect(confirmationMatches("  A@Example.COM  ", "a@example.com")).toBe(true);
});

test("a near miss is not a confirmation", () => {
  expect(confirmationMatches("b@example.com", "a@example.com")).toBe(false);
  expect(confirmationMatches("a@example.co", "a@example.com")).toBe(false);
  expect(confirmationMatches("", "a@example.com")).toBe(false);
  expect(confirmationMatches(undefined, "a@example.com")).toBe(false);
  expect(confirmationMatches(null, "a@example.com")).toBe(false);
});

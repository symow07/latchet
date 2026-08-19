import { test, expect } from "bun:test";
import {
  deleteAccount,
  confirmationMatches,
  type DeletionDeps,
  type DeletionTargets,
} from "./account-deletion";

function deps(
  targets: Partial<DeletionTargets> = {},
  failures: { plaid?: boolean; google?: boolean } = {}
) {
  const order: string[] = [];
  const impl: DeletionDeps = {
    async loadTargets() {
      return {
        plaidItems: targets.plaidItems ?? [],
        emailConnections: targets.emailConnections ?? [],
      };
    },
    async revokePlaidItem() {
      order.push("revoke-plaid");
      if (failures.plaid) throw new Error("Plaid is down");
    },
    async revokeGoogleToken() {
      order.push("revoke-google");
      if (failures.google) throw new Error("Google is down");
    },
    async deleteUser() {
      order.push("delete-user");
    },
  };
  return { impl, order };
}

const plaidItem = { id: "item_1", accessTokenEnc: "enc", institutionName: "Monzo" };
const inbox = { id: "conn_1", email: "a@example.com", refreshTokenEnc: "enc" };

test("grants are revoked before the user is deleted", () => {
  // The tokens live on rows that cascade away with the user. Delete first and
  // the third-party grants stay live forever with nothing left to revoke them.
  const { impl, order } = deps({ plaidItems: [plaidItem], emailConnections: [inbox] });

  return deleteAccount("u1", impl).then(() => {
    expect(order).toEqual(["revoke-plaid", "revoke-google", "delete-user"]);
  });
});

test("a clean deletion reports what it revoked", async () => {
  const { impl } = deps({ plaidItems: [plaidItem], emailConnections: [inbox] });
  const result = await deleteAccount("u1", impl);

  expect(result).toEqual({
    deleted: true,
    revoked: { banks: 1, inboxes: 1 },
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

test("a failed inbox revoke is reported the same way", async () => {
  const { impl } = deps({ emailConnections: [inbox] }, { google: true });
  const [grant] = (await deleteAccount("u1", impl)).unrevoked;

  expect(grant).toMatchObject({ kind: "email", label: "a@example.com" });
  expect(grant!.manualRevokeUrl).toContain("google.com");
});

test("one failure does not stop the other revocations", async () => {
  const { impl, order } = deps(
    { plaidItems: [plaidItem], emailConnections: [inbox] },
    { plaid: true }
  );
  const result = await deleteAccount("u1", impl);

  expect(order).toEqual(["revoke-plaid", "revoke-google", "delete-user"]);
  expect(result.revoked.inboxes).toBe(1);
  expect(result.unrevoked).toHaveLength(1);
});

test("an inbox with no stored token needs no revoking", async () => {
  const { impl, order } = deps({
    emailConnections: [{ id: "c", email: "a@example.com", refreshTokenEnc: null }],
  });
  const result = await deleteAccount("u1", impl);

  expect(order).toEqual(["delete-user"]);
  expect(result.revoked.inboxes).toBe(0);
});

test("an account with nothing linked still deletes", async () => {
  const { impl, order } = deps();
  const result = await deleteAccount("u1", impl);

  expect(order).toEqual(["delete-user"]);
  expect(result).toEqual({ deleted: true, revoked: { banks: 0, inboxes: 0 }, unrevoked: [] });
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

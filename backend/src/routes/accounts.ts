import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { accountFields, storableText } from "../lib/sync/schemas";
import { openingBalanceForTarget, stampTombstones } from "../lib/sync/sql";

/**
 * Account CRUD. The phone syncs through /sync (routes/sync.ts); these routes
 * write the same rows under the same model:
 *
 *   - balance is derived (a trigger: openingBalance + the account's ledger), so
 *     a requested balance is turned into the openingBalance that produces it,
 *     and openingBalance may be sent directly instead;
 *   - every write is stamped with clientUpdatedAt = now, and a delete leaves a
 *     tombstone carrying that time.
 *
 * The old bulk POST /accounts/sync is gone.
 */
const accountSchema = z.object({
  id: storableText(1, 200).optional(),
  name: accountFields.name,
  type: accountFields.type,
  /** The balance the account should show now. Ignored when openingBalance is sent. */
  balance: z.number().optional(),
  openingBalance: accountFields.openingBalance.optional(),
  currency: accountFields.currency.optional().default("USD"),
  color: accountFields.color.optional().default("#a855f7"),
  icon: accountFields.icon.optional().default("wallet"),
  isDefault: accountFields.isDefault.optional().default(false),
});

const accountUpdateSchema = z.object({
  name: accountFields.name.optional(),
  type: accountFields.type.optional(),
  balance: z.number().optional(),
  openingBalance: accountFields.openingBalance.optional(),
  currency: accountFields.currency.optional(),
  color: accountFields.color.optional(),
  icon: accountFields.icon.optional(),
  isDefault: accountFields.isDefault.optional(),
});

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Auth guard for all account routes
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

router.get("/", async (c) => {
  const user = c.get("user")!;
  const accounts = await prisma.bankAccount.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return c.json(accounts);
});

router.post("/", zValidator("json", accountSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");
  // A new account has no transactions yet, so the balance asked for is its
  // opening balance.
  const account = await prisma.bankAccount.create({
    data: {
      id: body.id || `acc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      name: body.name,
      type: body.type,
      openingBalance: body.openingBalance ?? body.balance ?? 0,
      currency: body.currency,
      color: body.color,
      icon: body.icon,
      isDefault: body.isDefault,
      clientUpdatedAt: new Date(),
    },
  });
  return c.json(account, 201);
});

router.put("/:id", zValidator("json", accountUpdateSchema), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const body = c.req.valid("json");

  const account = await prisma.$transaction(async (tx) => {
    // "Set the balance to X" means: the opening balance that, with the
    // transactions already on the account, adds up to X. Writing balance
    // itself would last only until the next transaction changed it.
    let openingBalance = body.openingBalance;
    if (openingBalance === undefined && body.balance !== undefined) {
      const derived = await openingBalanceForTarget(tx, user.id, id, body.balance);
      if (derived === null) return null;
      openingBalance = derived;
    }
    return tx.bankAccount.update({
      where: { id, userId: user.id },
      data: {
        name: body.name,
        type: body.type,
        openingBalance,
        currency: body.currency,
        color: body.color,
        icon: body.icon,
        isDefault: body.isDefault,
        clientUpdatedAt: new Date(),
      },
    });
  });
  if (!account) return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(account);
});

router.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  await prisma.$transaction(async (tx) => {
    // Its transactions are kept, unlinked (the foreign key sets accountId null).
    await tx.bankAccount.delete({ where: { id, userId: user.id } });
    await stampTombstones(tx, user.id, "accounts", [{ id, cu: Date.now() }], { insertMissing: false });
  });
  return c.json({ success: true });
});

// ─── sharing one account with a household ────────────────────────────────────
// PUT /api/v1/accounts/:id/share  { groupId: string | null }
//
// The opt-in behind "joint account". Sharing is per account and per group, and
// it is the ACCOUNT OWNER who decides — there is no endpoint by which a group
// claims an account. Passing null un-shares.
router.put(
  "/:id/share",
  zValidator("json", z.object({ groupId: z.string().min(1).max(64).nullable() })),
  async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const { groupId } = c.req.valid("json");

    // Ownership of the account, first. Without this the route would let anyone
    // who knows an account id publish it to a group they control.
    const account = await prisma.bankAccount.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!account) return c.json({ error: "Account not found" }, 404);

    if (groupId !== null) {
      // Membership of the target, second. Sharing INTO a group you do not
      // belong to would be a way to push data at strangers.
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: user.id } },
        include: { group: { select: { type: true } } },
      });
      if (!membership) return c.json({ error: "Not a member of that group" }, 403);
      // Business groups have expense submission for this; an account-wide
      // window into someone's personal finances is not part of employment.
      if (membership.group.type !== "household") {
        return c.json({ error: "Accounts can only be shared with a household" }, 400);
      }
    }

    await prisma.bankAccount.update({ where: { id }, data: { sharedWithGroupId: groupId } });
    return c.json({ id, sharedWithGroupId: groupId });
  }
);

export { router as accountsRouter };

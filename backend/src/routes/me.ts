import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { env } from "../env";
import { decryptSecret } from "../lib/crypto";
import { isPro } from "../lib/entitlement";
import {
  loadEntitlement,
  saveEntitlement,
  fetchEntitlementFromRevenueCat,
} from "../lib/user-entitlement";
import { getProvider, DEFAULT_PROVIDER_ID } from "../lib/bank-providers";
import { canonicalTimeZone, MAX_TIME_ZONE_LENGTH } from "../lib/user-day";
import {
  deleteAccount,
  confirmationMatches,
  type DeletionDeps,
} from "../lib/account-deletion";
import { emailServicesFromEnv, revokeConnection, type EmailServices } from "../lib/email-providers";

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

router.use("*", async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

router.get("/", async (c) => {
  const user = c.get("user")!;
  const state = await loadEntitlement(user.id);
  // The client is told its tier, but never gets to assert one.
  return c.json({
    user,
    entitlement: {
      tier: isPro(state) ? "pro" : "free",
      expiresAt: state.expiresAt?.toISOString() ?? null,
    },
  });
});

const timeZoneSchema = z.object({
  /** An IANA name, e.g. "Europe/Paris": what the phone's Intl reports. */
  timeZone: z.string().min(1).max(MAX_TIME_ZONE_LENGTH),
});

/**
 * The time zone the user's phone is in (Phase 5 decision 1). A device fact,
 * not a synced setting: the phone reports it after it signs in and whenever
 * it changes (mobile lib/timezone-report.ts). The server's "today" for this
 * user — the date recurring occurrences are booked on, the day a bill
 * reminder fires — is their local date in it (lib/user-day.ts).
 *
 * Stored in its canonical spelling; a name this server's tz database does not
 * know is a 400, and the stored zone is left as it was.
 */
router.put("/timezone", zValidator("json", timeZoneSchema), async (c) => {
  const user = c.get("user")!;
  const timeZone = canonicalTimeZone(c.req.valid("json").timeZone);
  if (!timeZone) {
    return c.json({ error: "Unknown time zone", code: "invalid_timezone" }, 400);
  }
  await prisma.user.update({ where: { id: user.id }, data: { timezone: timeZone } });
  return c.json({ timeZone });
});

/**
 * Re-read this user's entitlement straight from RevenueCat.
 *
 * A purchase completes on device seconds before the webhook lands. Without
 * this the user would sit in front of a paywall they had just paid to dismiss.
 * The client calls it right after a successful purchase; the webhook stays the
 * source of truth for everything that happens later.
 */
router.post("/entitlement/refresh", async (c) => {
  const user = c.get("user")!;

  try {
    const fresh = await fetchEntitlementFromRevenueCat(user.id);
    if (!fresh) {
      // Not configured — report what we already hold rather than erroring.
      const current = await loadEntitlement(user.id);
      return c.json({
        tier: isPro(current) ? "pro" : "free",
        expiresAt: current.expiresAt?.toISOString() ?? null,
        refreshed: false,
      });
    }

    await saveEntitlement(user.id, fresh);
    return c.json({
      tier: isPro(fresh) ? "pro" : "free",
      expiresAt: fresh.expiresAt?.toISOString() ?? null,
      refreshed: true,
    });
  } catch (e) {
    console.warn(
      "[entitlement:refresh] failed:",
      e instanceof Error ? e.message : e
    );
    // Fall back to the stored value; the webhook will correct it shortly.
    const current = await loadEntitlement(user.id);
    return c.json({
      tier: isPro(current) ? "pro" : "free",
      expiresAt: current.expiresAt?.toISOString() ?? null,
      refreshed: false,
    });
  }
});

/**
 * What deleting this account would destroy.
 *
 * Business ownership is the part users cannot be expected to anticipate:
 * Business cascades from its owner, taking every team member, expense and
 * salary with it. Someone deleting a personal account should not discover
 * afterwards that they wiped their colleagues' records.
 */
router.get("/deletion-preview", async (c) => {
  const user = c.get("user")!;

  const [transactions, accounts, plaidItems, emailConnections, ownedGroups] =
    await Promise.all([
      prisma.transaction.count({ where: { userId: user.id } }),
      prisma.bankAccount.count({ where: { userId: user.id } }),
      prisma.plaidItem.count({ where: { userId: user.id } }),
      prisma.emailConnection.count({ where: { userId: user.id } }),
      // Plural since groups were generalised: a user can own a business AND a
      // household. Reporting only one would let someone delete their account
      // having been warned about the company and not about the household they
      // share with their partner, which is destroyed just as permanently.
      prisma.group.findMany({
        where: { ownerId: user.id },
        select: { id: true, name: true, type: true },
      }),
    ]);

  const ownedGroupImpact = await Promise.all(
    ownedGroups.map(async (g) => ({
      id: g.id,
      type: g.type,
      name: g.name,
      members: await prisma.groupMember.count({
        where: { groupId: g.id, userId: { not: user.id } },
      }),
      expenses: await prisma.expense.count({ where: { groupId: g.id } }),
    }))
  );

  return c.json({
    email: user.email,
    transactions,
    accounts,
    linkedBanks: plaidItems,
    connectedInboxes: emailConnections,
    ownedGroups: ownedGroupImpact,
    // Builds older than 28 Aug 2026 read a single `ownedBusiness` object here.
    // The generic aliaser cannot cover this one: the field was not just
    // renamed, it went from one object to a list. Without it an old client
    // shows the delete-account sheet with no warning that a company dies with
    // the account — which is quieter than a crash and worse.
    ownedBusiness: ownedGroupImpact.find((g) => g.type === "business") ?? null,
  });
});

const deleteSchema = z.object({
  /** The user's own email, typed out. Guards against an accidental tap. */
  confirmEmail: z.string().min(1).max(320),
});

/**
 * The real deletion steps. `email` is how mailbox grants are revoked: the
 * process's providers, or a test's fake.
 */
export const deletionDeps = (email: Pick<EmailServices, "http" | "cipher"> = emailServicesFromEnv()): DeletionDeps => ({
  async loadTargets(userId) {
    const [plaidItems, mailboxes] = await Promise.all([
      prisma.plaidItem.findMany({
        where: { userId },
        select: { id: true, accessTokenEnc: true, institutionName: true },
      }),
      prisma.emailConnection.findMany({
        where: { userId, provider: { in: ["gmail", "outlook"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, provider: true, email: true, refreshTokenEnc: true },
      }),
    ]);
    return {
      plaidItems,
      emailConnections: mailboxes.map((m) => ({
        id: m.id,
        provider: m.provider,
        address: m.email,
        refreshTokenEnc: m.refreshTokenEnc,
      })),
    };
  },

  // Google: revoked through its endpoint. Outlook: Microsoft offers no
  // revocation a server can call for personal accounts, so it is reported
  // with the page where the user removes the consent.
  revokeEmailGrant: (target) =>
    revokeConnection(target, { http: email.http, cipher: email.cipher }),

  async revokePlaidItem(accessTokenEnc) {
    const provider = getProvider(DEFAULT_PROVIDER_ID);
    if (!provider.isConfigured()) {
      throw new Error("bank provider not configured — cannot revoke");
    }
    await provider.removeConnection(decryptSecret(accessTokenEnc));
  },

  async deleteUser(userId) {
    // Every relation to User cascades (Expense.reviewer is SetNull, so an
    // expense someone else submitted survives its reviewer leaving), so this
    // one delete takes sessions, transactions, accounts, settings, bill
    // reminders, recurring rules, net worth, category budgets, achievements,
    // push tokens, Plaid items and accounts, email connections, inbox emails,
    // owned business, team memberships, expenses and salaries with it.
    // EmailOAuthGrant has no relation to User on purpose: Google's cap on an
    // unverified app counts users for life, and so does our ledger.
    await prisma.user.delete({ where: { id: userId } });
  },
});

const prismaDeps = deletionDeps();

/**
 * Delete the account and everything belonging to it.
 *
 * Required by App Store Guideline 5.1.1(v) for any app offering account
 * creation. Irreversible.
 */
router.delete("/", zValidator("json", deleteSchema), async (c) => {
  const user = c.get("user")!;
  const { confirmEmail } = c.req.valid("json");

  if (!confirmationMatches(confirmEmail, user.email)) {
    return c.json(
      { error: "Type your email address exactly to confirm deletion.", code: "confirmation_mismatch" },
      400
    );
  }

  const result = await deleteAccount(user.id, prismaDeps);

  if (result.unrevoked.length > 0) {
    console.warn(
      `[account-deletion] user ${user.id} deleted with ${result.unrevoked.length} grant(s) still live`
    );
  }
  return c.json(result);
});

export { router as meRouter };

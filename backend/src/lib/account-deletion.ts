/**
 * Account deletion.
 *
 * Apple has required in-app account deletion since 2022 for any app that lets
 * users create an account, and PRIVACY.md previously said "contact support",
 * which is an automatic rejection.
 *
 * Two things make this more than a DELETE:
 *
 * 1. Order. Plaid access tokens are stored encrypted against rows that cascade
 *    away with the user. Revoke first, or the grants stay live at the third
 *    party forever with no token left to revoke them.
 *
 * 2. Honesty about failure. A revocation that fails must not trap the user in
 *    an account they have asked to delete — but they do need telling which
 *    grants may still be live, so they can revoke them by hand.
 *
 * The deps are injectable so the ordering guarantee can be tested without
 * calling Plaid.
 */

export interface DeletionTargets {
  /** Encrypted Plaid access tokens, one per linked institution. */
  plaidItems: { id: string; accessTokenEnc: string; institutionName: string | null }[];
}

export interface DeletionDeps {
  loadTargets(userId: string): Promise<DeletionTargets>;
  revokePlaidItem(accessTokenEnc: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

/** A third-party grant we could not revoke, and where the user can do it. */
export interface UnrevokedGrant {
  kind: "bank";
  label: string;
  manualRevokeUrl: string;
}

export interface DeletionResult {
  deleted: true;
  revoked: { banks: number };
  /** Empty when everything was revoked cleanly. */
  unrevoked: UnrevokedGrant[];
}

const PLAID_MANUAL_REVOKE = "https://my.plaid.com";

export async function deleteAccount(
  userId: string,
  deps: DeletionDeps
): Promise<DeletionResult> {
  const targets = await deps.loadTargets(userId);
  const unrevoked: UnrevokedGrant[] = [];
  let banks = 0;

  // ── Revoke first, while the tokens still exist ──
  for (const item of targets.plaidItems) {
    try {
      await deps.revokePlaidItem(item.accessTokenEnc);
      banks++;
    } catch (e) {
      console.warn(
        `[account-deletion] Plaid revoke failed for item ${item.id}:`,
        e instanceof Error ? e.message : e
      );
      unrevoked.push({
        kind: "bank",
        label: item.institutionName ?? "your bank",
        manualRevokeUrl: PLAID_MANUAL_REVOKE,
      });
    }
  }

  // ── Then delete. A failed revoke must not block this: the user asked to
  // leave, and trapping them in the account is the worse outcome. They are
  // told which grants survived so they can revoke them themselves. ──
  await deps.deleteUser(userId);

  return { deleted: true, revoked: { banks }, unrevoked };
}

/**
 * Does the typed confirmation match?
 *
 * Deleting is irreversible, so it takes more than a tapped button. Compared
 * case-insensitively and trimmed — the user is transcribing their own address,
 * not proving they can match whitespace.
 */
export function confirmationMatches(
  typed: string | undefined | null,
  email: string
): boolean {
  if (!typed) return false;
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}

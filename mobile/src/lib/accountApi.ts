/**
 * Account deletion client.
 *
 * Apple requires an in-app path to delete an account for any app that offers
 * account creation (Guideline 5.1.1(v)).
 */
import { api } from './api/api';
import { request } from './api-errors';

export interface OwnedGroupImpact {
  id: string;
  /** "business" | "household" — they read very differently to the user. */
  type: string;
  name: string;
  members: number;
  expenses: number;
}

export interface DeletionPreview {
  email: string;
  transactions: number;
  accounts: number;
  linkedBanks: number;
  connectedInboxes: number;
  /**
   * Every group the user owns, each of which cascades away with them. Plural
   * since groups were generalised: someone can own a company AND a household,
   * and being warned about only one of them is how you delete the other by
   * surprise.
   */
  ownedGroups: OwnedGroupImpact[];
}

export interface UnrevokedGrant {
  kind: 'bank';
  label: string;
  manualRevokeUrl: string;
}

export interface DeletionResult {
  deleted: true;
  revoked: { banks: number };
  unrevoked: UnrevokedGrant[];
}

// Both calls reject with an ApiFailure (lib/api-errors), whose message is
// already in the reader's language.

/** What deleting this account would destroy. */
export function fetchDeletionPreview(): Promise<DeletionPreview> {
  return request(() => api.get<DeletionPreview>('/api/me/deletion-preview'));
}

/**
 * Delete the account. Irreversible.
 * `confirmEmail` must match the signed-in address exactly.
 */
export function deleteAccount(confirmEmail: string): Promise<DeletionResult> {
  return request(() => api.delete<DeletionResult>('/api/me', { confirmEmail }), 'typedName');
}

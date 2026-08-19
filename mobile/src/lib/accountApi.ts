/**
 * Account deletion client.
 *
 * Apple requires an in-app path to delete an account for any app that offers
 * account creation (Guideline 5.1.1(v)).
 */
import { api } from './api/api';

export interface OwnedBusinessImpact {
  name: string;
  /** Other people who lose access. */
  teamMembers: number;
  expenses: number;
}

export interface DeletionPreview {
  email: string;
  transactions: number;
  accounts: number;
  linkedBanks: number;
  connectedInboxes: number;
  /** Present only when the user owns a business, which cascades away with them. */
  ownedBusiness: OwnedBusinessImpact | null;
}

export interface UnrevokedGrant {
  kind: 'bank' | 'email';
  label: string;
  manualRevokeUrl: string;
}

export interface DeletionResult {
  deleted: true;
  revoked: { banks: number; inboxes: number };
  unrevoked: UnrevokedGrant[];
}

/** What deleting this account would destroy. */
export function fetchDeletionPreview(): Promise<DeletionPreview> {
  return api.get<DeletionPreview>('/api/me/deletion-preview');
}

/**
 * Delete the account. Irreversible.
 * `confirmEmail` must match the signed-in address exactly.
 */
export function deleteAccount(confirmEmail: string): Promise<DeletionResult> {
  return api.delete<DeletionResult>('/api/me', { confirmEmail });
}

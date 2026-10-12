/**
 * Household sharing.
 *
 * Every shape here mirrors what the server will actually send, which for a
 * member below `full` means fields that are simply absent rather than empty.
 * They are optional in the types for that reason: a `byCategory` that is
 * `undefined` is the server declining to send it, and the UI must render that
 * as "not shared" rather than as zero.
 */
import { authedFetch } from './api/api';
import { readJson, request, type RequestPurpose } from './api-errors';

const getBackendUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!url) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  return url;
};

const HOUSEHOLD = '/api/v1/household';

export const SHARE_LEVELS = ['summary', 'categories', 'full'] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];

export interface Household {
  id: string;
  name: string;
  type: string;
  ownerId: string;
}

export interface HouseholdMember {
  userId: string;
  name: string;
  role: 'owner' | 'member';
  shareLevel: ShareLevel;
  joinedAt: string;
}

export interface HouseholdResponse {
  household: Household | null;
  isOwner?: boolean;
  members?: HouseholdMember[];
}

export interface JoinPreview {
  name: string;
  memberCount: number;
  memberNames: string[];
  joiningMeans: {
    defaultShareLevel: ShareLevel;
    sharedOnJoin: string[];
    notSharedOnJoin: string[];
    changeableAnyTime: boolean;
    leaveableAnyTime: boolean;
  };
}

export interface SharedTransaction {
  id: string;
  accountId: string | null;
  amount: number;
  type: string;
  category: string;
  note: string | null;
  dateISO: string;
}

export interface DashboardMember {
  userId: string;
  name: string;
  shareLevel: ShareLevel;
  totalIn: number;
  totalOut: number;
  /** Absent below 'categories' — absent means withheld, not zero. */
  byCategory?: Record<string, number>;
  /** Absent below 'full'. */
  transactions?: SharedTransaction[];
}

export interface HouseholdDashboard {
  householdName: string;
  month: string;
  combined: { totalIn: number; totalOut: number };
  members: DashboardMember[];
  sharedAccounts: { id: string; name: string; balance: number; currency: string; ownerId: string }[];
  sharedTransactions: SharedTransaction[];
}

export interface VisibilityMember {
  userId: string;
  name: string;
  role: 'owner' | 'member';
  shareLevel: ShareLevel;
  isYou: boolean;
  sharedAccounts: { id: string; name: string }[];
}

type Init = Parameters<typeof authedFetch>[1];

/** A request carrying `payload` as JSON. */
const withJson = (method: string, payload: unknown): Init => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/**
 * One call to the backend, resolving to its JSON answer.
 *
 * It rejects with an ApiFailure (lib/api-errors), whose message is already a
 * sentence in the reader's language — the join and consent screens show it as
 * it is. It used to be the server's English, or "Request failed (404)".
 */
function call<T>(path: string, init?: Init, purpose?: RequestPurpose): Promise<T> {
  return request(
    async () => readJson<T>(await authedFetch(`${getBackendUrl()}${path}`, init), purpose),
    purpose,
  );
}

export async function getHousehold(): Promise<HouseholdResponse> {
  return call(HOUSEHOLD);
}

export async function createHousehold(name: string): Promise<{ household: Household; inviteCode: string }> {
  return call(HOUSEHOLD, withJson('POST', { name }));
}

/** Read before joining. This is what the consent screen renders. */
export async function previewInvite(code: string): Promise<JoinPreview> {
  return call(`${HOUSEHOLD}/preview?code=${encodeURIComponent(code)}`, undefined, 'invite');
}

/**
 * `acknowledgedShareLevel` is what the consent screen told the user they would
 * start at. The server treats it as a floor-check rather than a setting, so a
 * client that lies about it cannot start anyone above summary.
 */
export async function joinHousehold(
  code: string,
  acknowledgedShareLevel: ShareLevel
): Promise<{ household: Household }> {
  return call(`${HOUSEHOLD}/join`, withJson('POST', { code, acknowledgedShareLevel }), 'invite');
}

export async function setMyShareLevel(
  shareLevel: ShareLevel
): Promise<{ shareLevel: ShareLevel; previous: ShareLevel; notifyGroup: boolean }> {
  return call(`${HOUSEHOLD}/my-share-level`, withJson('PATCH', { shareLevel }));
}

export async function getVisibility(): Promise<{ householdName: string; members: VisibilityMember[] }> {
  return call(`${HOUSEHOLD}/visibility`);
}

export async function getDashboard(month?: string): Promise<HouseholdDashboard> {
  const q = month ? `?month=${encodeURIComponent(month)}` : '';
  return call(`${HOUSEHOLD}/dashboard${q}`);
}

export async function getInviteCode(): Promise<{ code: string; householdName: string }> {
  return call(`${HOUSEHOLD}/invite-code`);
}

export async function refreshInviteCode(): Promise<{ code: string }> {
  return call(`${HOUSEHOLD}/invite-code/refresh`, { method: 'POST' });
}

/** Unilateral and immediate. No owner approval, no grace period. */
export async function leaveHousehold(): Promise<{ ok: true }> {
  return call(`${HOUSEHOLD}/leave`, { method: 'DELETE' });
}

export async function deleteHousehold(confirmName: string): Promise<{ ok: true }> {
  return call(HOUSEHOLD, withJson('DELETE', { confirmName }), 'typedName');
}

/** Opt one account in to (or out of, with null) a household. */
export async function setAccountSharing(
  accountId: string,
  groupId: string | null
): Promise<{ id: string; sharedWithGroupId: string | null }> {
  return call(`/api/v1/accounts/${encodeURIComponent(accountId)}/share`, withJson('PUT', { groupId }));
}

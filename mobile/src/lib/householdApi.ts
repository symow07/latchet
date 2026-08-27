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

const getBackendUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!url) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  return url;
};

const base = () => `${getBackendUrl()}/api/v1/household`;

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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function getHousehold(): Promise<HouseholdResponse> {
  return json(await authedFetch(base()));
}

export async function createHousehold(name: string): Promise<{ household: Household; inviteCode: string }> {
  return json(
    await authedFetch(base(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  );
}

/** Read before joining. This is what the consent screen renders. */
export async function previewInvite(code: string): Promise<JoinPreview> {
  return json(await authedFetch(`${base()}/preview?code=${encodeURIComponent(code)}`));
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
  return json(
    await authedFetch(`${base()}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, acknowledgedShareLevel }),
    })
  );
}

export async function setMyShareLevel(
  shareLevel: ShareLevel
): Promise<{ shareLevel: ShareLevel; previous: ShareLevel; notifyGroup: boolean }> {
  return json(
    await authedFetch(`${base()}/my-share-level`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareLevel }),
    })
  );
}

export async function getVisibility(): Promise<{ householdName: string; members: VisibilityMember[] }> {
  return json(await authedFetch(`${base()}/visibility`));
}

export async function getDashboard(month?: string): Promise<HouseholdDashboard> {
  const q = month ? `?month=${encodeURIComponent(month)}` : '';
  return json(await authedFetch(`${base()}/dashboard${q}`));
}

export async function getInviteCode(): Promise<{ code: string; householdName: string }> {
  return json(await authedFetch(`${base()}/invite-code`));
}

export async function refreshInviteCode(): Promise<{ code: string }> {
  return json(await authedFetch(`${base()}/invite-code/refresh`, { method: 'POST' }));
}

/** Unilateral and immediate. No owner approval, no grace period. */
export async function leaveHousehold(): Promise<{ ok: true }> {
  return json(await authedFetch(`${base()}/leave`, { method: 'DELETE' }));
}

export async function deleteHousehold(confirmName: string): Promise<{ ok: true }> {
  return json(
    await authedFetch(base(), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName }),
    })
  );
}

/** Opt one account in to (or out of, with null) a household. */
export async function setAccountSharing(
  accountId: string,
  groupId: string | null
): Promise<{ id: string; sharedWithGroupId: string | null }> {
  return json(
    await authedFetch(`${getBackendUrl()}/api/v1/accounts/${encodeURIComponent(accountId)}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    })
  );
}

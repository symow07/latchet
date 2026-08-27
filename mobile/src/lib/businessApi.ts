import { authedFetch } from './api/api';
const getBackendUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!url) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  return url;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BusinessUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface Business {
  id: string;
  ownerId: string;
  name: string;
  /** Company profile and tax identity. All optional — a sole trader has none. */
  address?: string | null;
  vatNumber?: string | null;
  taxId?: string | null;
  /** Month the fiscal year starts, 1-12. */
  fiscalYearStartMonth?: number | null;
  /** Path this backend serves, never a remote URL. */
  logoUrl?: string | null;
  inviteCode?: string | null;
  createdAt: string;
  updatedAt: string;
  members: GroupMember[];
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: 'owner' | 'manager' | 'employee';
  /** What this member reveals about themselves. Unused in business mode:
   *  an expense is submitted deliberately, so it needs no dial. */
  shareLevel?: 'summary' | 'categories' | 'full';
  createdAt: string;
  updatedAt: string;
  user?: BusinessUser;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function createBusiness(name?: string): Promise<Business> {
  const res = await authedFetch(`${getBackendUrl()}/api/business`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name ?? '' }),
  });
  const data = await res.json() as { business: Business; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to create business');
  return data.business;
}

export async function getBusiness(): Promise<Business | null> {
  const res = await authedFetch(`${getBackendUrl()}/api/business`, {
  });
  if (res.status === 404) return null;
  const data = await res.json() as { business: Business; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch business');
  return data.business;
}

/**
 * Update the company profile or tax identity.
 *
 * Only the fields present are changed. Sending an empty string clears a field;
 * omitting it leaves the stored value alone — the backend keeps that
 * distinction so a screen editing one field cannot wipe the others.
 */
export async function updateBusiness(patch: {
  name?: string;
  address?: string | null;
  vatNumber?: string | null;
  taxId?: string | null;
  fiscalYearStartMonth?: number | null;
}): Promise<Business> {
  const res = await authedFetch(`${getBackendUrl()}/api/business`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json() as { business: Business; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to update business');
  return data.business;
}

/**
 * Delete the company and everything hanging off it.
 *
 * The name is retyped by the user and sent for the server to check, so the
 * confirmation is not something a client bug can skip.
 */
/** Replace the company logo. Owner only; the server enforces that. */
export async function uploadLogo(base64: string): Promise<Business> {
  const res = await authedFetch(`${getBackendUrl()}/api/business/logo`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  const data = await res.json() as { business: Business; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to upload logo');
  return data.business;
}

export async function removeLogo(): Promise<Business> {
  const res = await authedFetch(`${getBackendUrl()}/api/business/logo`, { method: 'DELETE' });
  const data = await res.json() as { business: Business; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to remove logo');
  return data.business;
}

export async function deleteBusiness(confirmName: string): Promise<void> {
  const res = await authedFetch(`${getBackendUrl()}/api/business`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmName }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? 'Failed to delete business');
  }
}

export async function getInviteCode(): Promise<{ code: string; businessName: string }> {
  const res = await authedFetch(`${getBackendUrl()}/api/business/invite-code`, {
  });
  const data = await res.json() as { code: string; businessName: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to get invite code');
  return { code: data.code, businessName: data.businessName };
}

export async function refreshInviteCode(): Promise<{ code: string; businessName: string }> {
  const res = await authedFetch(`${getBackendUrl()}/api/business/invite-code/refresh`, {
    method: 'POST',
  });
  const data = await res.json() as { code: string; businessName: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to refresh invite code');
  return { code: data.code, businessName: data.businessName };
}

export async function joinBusiness(code: string): Promise<{ member: GroupMember; businessName: string }> {
  const res = await authedFetch(`${getBackendUrl()}/api/business/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json() as { member: GroupMember; businessName: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to join business');
  return { member: data.member, businessName: data.businessName };
}

export async function getMembers(): Promise<GroupMember[]> {
  const res = await authedFetch(`${getBackendUrl()}/api/business/members`, {
  });
  const data = await res.json() as { members: GroupMember[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch members');
  return data.members;
}

export async function updateMemberRole(memberId: string, role: 'manager' | 'employee'): Promise<GroupMember> {
  const res = await authedFetch(`${getBackendUrl()}/api/business/team/${memberId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  const data = await res.json() as { member: GroupMember; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to update role');
  return data.member;
}

export async function removeMember(memberId: string): Promise<void> {
  const res = await authedFetch(`${getBackendUrl()}/api/business/team/${memberId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? 'Failed to remove member');
  }
}

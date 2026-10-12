import { authedFetch } from './api/api';
import { ensureOk, readJson, request, type RequestPurpose } from './api-errors';
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
  /**
   * What the backend called this before groups were generalised. Still sent by
   * a deployment that has not caught up, and a shipped build has no say in
   * when that happens — read it through readMembers/roleOf, never directly.
   */
  teamMembers?: GroupMember[];
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
//
// Every call rejects with an ApiFailure (lib/api-errors): its message is
// already a sentence in the reader's language, which is what the screens show.

type Init = Parameters<typeof authedFetch>[1];

/** A request carrying `payload` as JSON. */
const withJson = (method: string, payload: unknown): Init => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/** One call whose answer is JSON. */
function call<T>(path: string, init?: Init, purpose?: RequestPurpose): Promise<T> {
  return request(
    async () => readJson<T>(await authedFetch(`${getBackendUrl()}${path}`, init), purpose),
    purpose,
  );
}

/** One call whose answer is only its status. */
function send(path: string, init?: Init, purpose?: RequestPurpose): Promise<void> {
  return request(
    async () => ensureOk(await authedFetch(`${getBackendUrl()}${path}`, init), purpose),
    purpose,
  );
}

export async function createBusiness(name?: string): Promise<Business> {
  const data = await call<{ business: Business }>('/api/business', withJson('POST', { name: name ?? '' }));
  return data.business;
}

export async function getBusiness(): Promise<Business | null> {
  return request(async () => {
    const res = await authedFetch(`${getBackendUrl()}/api/business`);
    // Not belonging to a business is an answer, not a failure.
    if (res.status === 404) return null;
    return (await readJson<{ business: Business }>(res)).business;
  });
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
  const data = await call<{ business: Business }>('/api/business', withJson('PATCH', patch));
  return data.business;
}

/** Replace the company logo. Owner only; the server enforces that. */
export async function uploadLogo(base64: string): Promise<Business> {
  const data = await call<{ business: Business }>(
    '/api/business/logo',
    withJson('PUT', { image: base64 }),
    'image',
  );
  return data.business;
}

export async function removeLogo(): Promise<Business> {
  const data = await call<{ business: Business }>('/api/business/logo', { method: 'DELETE' });
  return data.business;
}

/**
 * Delete the company and everything hanging off it.
 *
 * The name is retyped by the user and sent for the server to check, so the
 * confirmation is not something a client bug can skip.
 */
export async function deleteBusiness(confirmName: string): Promise<void> {
  await send('/api/business', withJson('DELETE', { confirmName }), 'typedName');
}

export async function getInviteCode(): Promise<{ code: string; businessName: string }> {
  const data = await call<{ code: string; businessName: string }>('/api/business/invite-code');
  return { code: data.code, businessName: data.businessName };
}

export async function refreshInviteCode(): Promise<{ code: string; businessName: string }> {
  const data = await call<{ code: string; businessName: string }>('/api/business/invite-code/refresh', {
    method: 'POST',
  });
  return { code: data.code, businessName: data.businessName };
}

export async function joinBusiness(code: string): Promise<{ member: GroupMember; businessName: string }> {
  const data = await call<{ member: GroupMember; businessName: string }>(
    '/api/business/join',
    withJson('POST', { code }),
    'invite',
  );
  return { member: data.member, businessName: data.businessName };
}

export async function getMembers(): Promise<GroupMember[]> {
  const data = await call<{ members: GroupMember[] }>('/api/business/members');
  return data.members;
}

export async function updateMemberRole(memberId: string, role: 'manager' | 'employee'): Promise<GroupMember> {
  const data = await call<{ member: GroupMember }>(
    `/api/business/team/${memberId}`,
    withJson('PATCH', { role }),
  );
  return data.member;
}

export async function removeMember(memberId: string): Promise<void> {
  await send(`/api/business/team/${memberId}`, { method: 'DELETE' });
}

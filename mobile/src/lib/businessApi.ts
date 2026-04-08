const getBackendUrl = () =>
  process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  'http://localhost:3000';

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
  inviteCode?: string | null;
  createdAt: string;
  updatedAt: string;
  teamMembers: TeamMember[];
}

export interface TeamMember {
  id: string;
  businessId: string;
  userId: string;
  role: 'owner' | 'manager' | 'employee';
  createdAt: string;
  updatedAt: string;
  user?: BusinessUser;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function createBusiness(name?: string): Promise<Business> {
  const res = await fetch(`${getBackendUrl()}/api/business`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name ?? '' }),
  });
  const data = await res.json() as { business: Business; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to create business');
  return data.business;
}

export async function getBusiness(): Promise<Business | null> {
  const res = await fetch(`${getBackendUrl()}/api/business`, {
    credentials: 'include',
  });
  if (res.status === 404) return null;
  const data = await res.json() as { business: Business; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch business');
  return data.business;
}

export async function getInviteCode(): Promise<{ code: string; businessName: string }> {
  const res = await fetch(`${getBackendUrl()}/api/business/invite-code`, {
    credentials: 'include',
  });
  const data = await res.json() as { code: string; businessName: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to get invite code');
  return { code: data.code, businessName: data.businessName };
}

export async function refreshInviteCode(): Promise<{ code: string; businessName: string }> {
  const res = await fetch(`${getBackendUrl()}/api/business/invite-code/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  const data = await res.json() as { code: string; businessName: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to refresh invite code');
  return { code: data.code, businessName: data.businessName };
}

export async function joinBusiness(code: string): Promise<{ member: TeamMember; businessName: string }> {
  const res = await fetch(`${getBackendUrl()}/api/business/join`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json() as { member: TeamMember; businessName: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to join business');
  return { member: data.member, businessName: data.businessName };
}

export async function getMembers(): Promise<TeamMember[]> {
  const res = await fetch(`${getBackendUrl()}/api/business/members`, {
    credentials: 'include',
  });
  const data = await res.json() as { members: TeamMember[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch members');
  return data.members;
}

export async function updateMemberRole(memberId: string, role: 'manager' | 'employee'): Promise<TeamMember> {
  const res = await fetch(`${getBackendUrl()}/api/business/team/${memberId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  const data = await res.json() as { member: TeamMember; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to update role');
  return data.member;
}

export async function removeMember(memberId: string): Promise<void> {
  const res = await fetch(`${getBackendUrl()}/api/business/team/${memberId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? 'Failed to remove member');
  }
}

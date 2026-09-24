// Backend client for the Family screen.
//
// Endpoints used:
//   GET  /api/family               — full snapshot (family + profile_members + users + portionSum)
//   POST /api/family/members       — create a name-only roster member (no invite/email)
//   PUT  /api/family/members/:id   — partial update of one roster row
//
// Same fetch-conventions as authApi/dashboardApi: credentials:'include'
// so the HttpOnly session cookie tags every request, and a single
// FamilyApiError type that carries the HTTP status so callers can
// branch on 401/403/4xx without parsing message strings.

export class FamilyApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'FamilyApiError';
    this.status = status;
  }
}

// ============================================================
// Response shapes
// ============================================================

export type MemberCategory = 'adult' | 'teen' | 'child';
export type UserRole = 'owner' | 'adult' | 'child';

export interface ProfileMember {
  id: number;
  name: string;
  category: MemberCategory;
  portionFactor: number;
  sortOrder: number;
  allergies: string[] | null;
  dislikes: string[] | null;
  dietTags: string[];
  customDietNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyUser {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
  profileMemberId: number | null;
  lastSeenAt: string | null;
}

export interface FamilyResponse {
  family: {
    id: number;
    name: string;
    ownerUserId: number | null;
    createdAt: string;
    updatedAt: string;
    gamificationEnabled?: boolean;
    weekGoal?: number;
  };
  profileMembers: ProfileMember[];
  users: FamilyUser[];
  portionSum: number;
}

export interface UpdateMemberResponse {
  ok: true;
  member: ProfileMember;
}

export interface CreateMemberInput {
  name: string;
  category: MemberCategory;
  /** Defaults to 1.0 on the server when omitted. Range 0.1–2.0. */
  portionFactor?: number;
}

export interface CreateMemberResponse {
  ok: true;
  member: ProfileMember;
}

// ============================================================
// Internal helpers
// ============================================================

interface FetchOptions {
  signal?: AbortSignal;
}

async function callApi(
  path: string,
  init: RequestInit,
  options: FetchOptions = {}
): Promise<unknown> {
  const finalInit: RequestInit = {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
  };
  if (options.signal) finalInit.signal = options.signal;

  const res = await fetch(path, finalInit);
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Non-JSON body — fall through to status check.
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new FamilyApiError(res.status, detail);
  }
  return parsed;
}

// ============================================================
// Public API
// ============================================================

export async function fetchFamily(signal?: AbortSignal): Promise<FamilyResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi('/api/family', { method: 'GET' }, init)) as FamilyResponse;
}

/**
 * Update a single profile-member row. Backend accepts partial fields,
 * but we ship a typed surface that only exposes portionFactor for now —
 * other fields (name, category, sortOrder) get their own helpers when
 * their UI lands. Keeping the signature narrow forces a follow-up PR
 * to add edit-name etc rather than letting the shape silently grow.
 */
export async function updateMemberPortion(
  memberId: number,
  portionFactor: number,
  signal?: AbortSignal
): Promise<UpdateMemberResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(
    `/api/family/members/${memberId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portionFactor }),
    },
    init
  )) as UpdateMemberResponse;
}

/**
 * Create a name-only roster member (no email, no invitation).
 * Backend: POST /api/family/members — requireRole('adult') (owner + adult).
 */
export async function createMember(
  input: CreateMemberInput,
  signal?: AbortSignal
): Promise<CreateMemberResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  const body: { name: string; category: MemberCategory; portionFactor?: number } = {
    name: input.name,
    category: input.category,
  };
  if (input.portionFactor !== undefined) {
    body.portionFactor = input.portionFactor;
  }
  return (await callApi(
    '/api/family/members',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    init
  )) as CreateMemberResponse;
}

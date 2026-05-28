// Backend client for the Sprint 9 family-invitation UI surface.
//
// Endpoints used (see server/auth/family-routes.js):
//   POST   /api/family/invitations              — create
//   GET    /api/family/invitations              — list pending
//   DELETE /api/family/invitations/:id          — revoke
//   POST   /api/family/invitations/:id/resend   — rotate token + re-send
//   GET    /api/invitations/:token              — public peek (no auth)
//   POST   /api/invitations/:token/accept       — accept (auth required)
//
// Same fetch-conventions as authApi/familyApi: credentials:'include' so
// the HttpOnly session cookie tags every request, and a single
// FamilyInvitationsApiError that carries the HTTP status + machine-
// readable code so callers can branch on (e.g.) EMAIL_ALREADY_MEMBER
// without parsing detail strings.

export class FamilyInvitationsApiError extends Error {
  status: number;
  code: string | undefined;
  detail: string | undefined;

  constructor(status: number, message: string, code?: string, detail?: string) {
    super(message);
    this.name = 'FamilyInvitationsApiError';
    this.status = status;
    if (code !== undefined) this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

// ============================================================
// Response shapes
// ============================================================

export type InvitationLocale = 'no' | 'en';
export type InvitationRole = 'adult' | 'child';

// Listing shape (GET /api/family/invitations). Post-migration 030 the
// plain token is unrecoverable after creation (sha256 at rest), so the
// listing endpoint deliberately omits both `token` and `url`. The
// pending-invitations UI uses only id/email/dates anyway.
export interface Invitation {
  id: number;
  assignedRole: InvitationRole;
  profileMemberId: number | null;
  invitedEmail: string | null;
  invitationMessage: string | null;
  locale: InvitationLocale;
  expiresAt: string;
  createdAt: string;
}

// One-shot create- and resend-response shape. Carries the plain token
// and the share-URL — these are the only moments the plain token
// exists in memory, so the caller is responsible for using them
// immediately (e.g. send the email, copy to clipboard).
export interface InvitationWithSecret extends Invitation {
  token: string;
  url: string;
}

export interface CreateInvitationRequest {
  email: string;
  role: InvitationRole;
  invitationMessage?: string | null;
  locale?: InvitationLocale;
}

export interface CreateInvitationResponse {
  ok: true;
  invitation: InvitationWithSecret;
}

export interface ListInvitationsResponse {
  invitations: Invitation[];
}

export interface PeekInvitationResponse {
  familyId: number;
  familyName: string;
  assignedRole: InvitationRole;
  inviterName: string | null;
  inviterEmail: string | null;
  invitedEmail: string | null;
  invitationMessage: string | null;
  locale: InvitationLocale;
  expiresAt: string;
}

export interface AcceptInvitationResponse {
  ok: true;
  user: {
    id: number;
    email: string;
    name: string | null;
    role: 'owner' | 'adult' | 'child';
    familyId: number | null;
    profileMemberId: number | null;
  };
  family: {
    id: number;
    name: string;
  };
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
    const detail = readString(parsed, 'detail');
    const code = readString(parsed, 'code');
    const title = readString(parsed, 'title') ?? `HTTP ${res.status}`;
    throw new FamilyInvitationsApiError(res.status, title, code, detail);
  }
  return parsed;
}

function readString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

// ============================================================
// Public API
// ============================================================

export async function createInvitation(
  body: CreateInvitationRequest,
  signal?: AbortSignal
): Promise<CreateInvitationResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(
    '/api/family/invitations',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    init
  )) as CreateInvitationResponse;
}

export async function listInvitations(signal?: AbortSignal): Promise<ListInvitationsResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(
    '/api/family/invitations',
    { method: 'GET' },
    init
  )) as ListInvitationsResponse;
}

export async function revokeInvitation(id: number, signal?: AbortSignal): Promise<{ ok: true }> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(`/api/family/invitations/${id}`, { method: 'DELETE' }, init)) as {
    ok: true;
  };
}

export async function resendInvitation(
  id: number,
  signal?: AbortSignal
): Promise<CreateInvitationResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(
    `/api/family/invitations/${id}/resend`,
    { method: 'POST' },
    init
  )) as CreateInvitationResponse;
}

export async function peekInvitation(
  token: string,
  signal?: AbortSignal
): Promise<PeekInvitationResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(
    `/api/invitations/${encodeURIComponent(token)}`,
    { method: 'GET' },
    init
  )) as PeekInvitationResponse;
}

export async function acceptInvitation(
  token: string,
  signal?: AbortSignal
): Promise<AcceptInvitationResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return (await callApi(
    `/api/invitations/${encodeURIComponent(token)}/accept`,
    { method: 'POST' },
    init
  )) as AcceptInvitationResponse;
}

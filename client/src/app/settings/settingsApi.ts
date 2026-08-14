// Backend client for the Settings screen.
//
// Phase 2F scope: read the family + user data needed for the
// Settings header (familyName + current user role), rename the
// family (owner-only), and trigger the two GDPR endpoints
// (export + soft-delete account).
//
// All endpoints follow the existing fetch conventions:
// credentials:'include' so the HttpOnly session cookie tags every
// request, and a single SettingsApiError carrying the HTTP status.
//
// We deliberately reuse the family endpoint instead of duplicating
// it under a new /api/settings prefix — the family payload IS what
// Settings consumes, and a parallel route would diverge on shape
// drift. familyApi.ts (used by Family.tsx) and this module both
// hit the same /api/family endpoint; if either one needs a wider
// shape later, the type contract stays in lockstep through this
// shared response definition.

export class SettingsApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'SettingsApiError';
    this.status = status;
    this.code = code;
  }
}

// ============================================================
// Response shapes
// ============================================================

export interface FamilyMember {
  id: number;
  name: string;
  category: 'adult' | 'teen' | 'child' | string;
  portionFactor: number;
  sortOrder?: number;
  allergies?: string[] | null;
  dislikes?: string[] | null;
  dietTags?: string[];
  customDietNote?: string | null;
}

export interface FamilyUser {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: 'owner' | 'adult' | 'child' | string;
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
  profileMembers: FamilyMember[];
  users: FamilyUser[];
  portionSum: number;
}

export interface RenameFamilyResponse {
  ok: true;
  family: {
    id: number;
    name: string;
    ownerUserId: number | null;
    createdAt: string;
    updatedAt: string;
  };
}

export interface DeleteAccountResponse {
  ok: true;
  hardDeleteAt: string;
  graceDays: number;
}

// ============================================================
// Internal helpers — mirror shoppingApi/pantryApi for consistency
// ============================================================

interface FetchOptions {
  signal?: AbortSignal;
}

interface ProblemResponse {
  detail?: string;
  code?: string;
}

async function parseResponse(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function throwIfError(res: Response, parsed: unknown, fallback: string): void {
  if (res.ok) return;
  const detail =
    parsed && typeof parsed === 'object' && 'detail' in parsed
      ? String((parsed as ProblemResponse).detail || fallback)
      : fallback;
  const code =
    parsed && typeof parsed === 'object' && 'code' in parsed
      ? String((parsed as ProblemResponse).code || '') || null
      : null;
  throw new SettingsApiError(res.status, detail, code);
}

async function getJson<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(path, init);
  const parsed = await parseResponse(res);
  throwIfError(res, parsed, `HTTP ${res.status}`);
  return parsed as T;
}

async function sendJson<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: FetchOptions = {}
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  if (options.signal) init.signal = options.signal;
  const res = await fetch(path, init);
  const parsed = await parseResponse(res);
  throwIfError(res, parsed, `HTTP ${res.status}`);
  return parsed as T;
}

// ============================================================
// Public API
// ============================================================

export async function fetchFamily(signal?: AbortSignal): Promise<FamilyResponse> {
  const opts: FetchOptions = {};
  if (signal) opts.signal = signal;
  return getJson<FamilyResponse>('/api/family', opts);
}

export async function renameFamily(name: string): Promise<RenameFamilyResponse> {
  return sendJson<RenameFamilyResponse>('PUT', '/api/family', { name });
}

/**
 * GDPR export. Returns the raw JSON payload — the caller is responsible
 * for triggering a download via Blob + anchor click. Returning the
 * parsed JSON instead of the Response keeps the API surface consistent
 * with the rest of the module (every call returns a typed object) and
 * makes it easy to test. The download wrapper lives in DataExportButton
 * because it needs DOM APIs that don't belong in the API layer.
 */
export async function exportMyData(signal?: AbortSignal): Promise<unknown> {
  const opts: FetchOptions = {};
  if (signal) opts.signal = signal;
  return getJson<unknown>('/api/me/export', opts);
}

export async function deleteMyAccount(): Promise<DeleteAccountResponse> {
  return sendJson<DeleteAccountResponse>('DELETE', '/api/me');
}

export async function patchGamification(body: {
  enabled?: boolean;
  weekGoal?: number;
}): Promise<{ ok: true; enabled: boolean; weekGoal: number }> {
  return sendJson<{ ok: true; enabled: boolean; weekGoal: number }>(
    'PATCH',
    '/api/family/gamification',
    body
  );
}

export async function downloadFamilyBackup(signal?: AbortSignal): Promise<unknown> {
  const opts: FetchOptions = {};
  if (signal) opts.signal = signal;
  return getJson<unknown>('/api/family/backup', opts);
}

export async function importFamilyBackup(
  mode: 'merge' | 'replace',
  payload: unknown
): Promise<{ ok: true }> {
  return sendJson<{ ok: true }>('POST', '/api/family/backup/import', { mode, payload });
}

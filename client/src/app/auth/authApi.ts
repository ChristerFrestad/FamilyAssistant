// Backend client for the auth-flyt endpoints.
//
// One thin module that wraps every fetch the AuthContext needs.
// Centralising the URL paths + the credentials policy here keeps
// the call sites in components and the context tidy and avoids
// drift between three different ways of calling /api/auth/me.
//
// Cookie note: every request sets `credentials: 'include'`. The
// backend writes an HttpOnly session cookie on /api/auth/magic-link/
// verify; subsequent calls to /api/auth/me must send that cookie
// back so the server can identify the user. Without `include` the
// browser would treat the API as a third party and strip the
// cookie, even on a same-origin dev setup behind Vite's proxy.
//
// Errors: handlers throw `AuthApiError` with the HTTP status so
// callers can branch on rate-limit (429) vs validation (400) vs
// auth (401) without parsing message strings.

export class AuthApiError extends Error {
  status: number;
  detail: string | undefined;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    if (detail !== undefined) {
      this.detail = detail;
    }
  }
}

export interface AuthUser {
  id: number;
  email: string | null;
  username?: string | null;
  name: string | null;
  role: 'owner' | 'adult' | 'child';
  avatarUrl: string | null;
  familyId: number | null;
  profileMemberId: number | null;
  onboardingCompleted: boolean;
  synthetic: boolean;
  isAdmin?: boolean;
  emailVerified?: boolean;
  withinGrace?: boolean;
  verificationDueAt?: string | null;
  passwordResetRequired?: boolean;
}

export interface MeResponse {
  authenticated: boolean;
  user: AuthUser | null;
}

interface FetchOptions {
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function callApi(path: string, options: FetchOptions): Promise<Response> {
  const init: RequestInit = {
    method: options.method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  };
  if (options.signal) init.signal = options.signal;
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  return fetch(path, init);
}

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Body wasn't JSON — fall through to the status check below.
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : undefined;
    const title =
      parsed && typeof parsed === 'object' && 'title' in parsed
        ? String((parsed as { title: unknown }).title)
        : `HTTP ${res.status}`;
    const err = new AuthApiError(res.status, title, detail);
    if (parsed && typeof parsed === 'object') {
      (err as AuthApiError & { extras?: unknown }).extras = parsed;
    }
    throw err;
  }
  return parsed as T;
}

// ============================================================
// Public API
// ============================================================

export async function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  // The backend handler returns 200 with `authenticated:false` for
  // unauthenticated requests rather than 401, so a missing session
  // is not an error here — the caller should switch on the boolean.
  const init: FetchOptions = { method: 'GET' };
  if (signal) init.signal = signal;
  const res = await callApi('/api/auth/me', init);
  return readJsonOrThrow<MeResponse>(res);
}

export interface MagicLinkStartResponse {
  ok: boolean;
  message: string;
}

export async function startMagicLink(email: string): Promise<MagicLinkStartResponse> {
  const res = await callApi('/api/auth/magic-link/start', {
    method: 'POST',
    body: { email },
  });
  return readJsonOrThrow<MagicLinkStartResponse>(res);
}

export interface PasswordAuthResponse {
  ok: boolean;
  user: AuthUser;
  redirect: string;
}

export interface PasswordLoginErrorBody {
  code?: string;
  mustResetPassword?: boolean;
  hasRealEmail?: boolean;
  username?: string;
  detail?: string;
  title?: string;
  status?: number;
}

export async function registerWithPassword(payload: {
  username: string;
  password: string;
  name?: string;
  email?: string;
}): Promise<PasswordAuthResponse> {
  const res = await callApi('/api/auth/password/register', {
    method: 'POST',
    body: payload,
  });
  return readJsonOrThrow<PasswordAuthResponse>(res);
}

export async function loginWithPassword(payload: {
  username: string;
  password: string;
}): Promise<PasswordAuthResponse> {
  const res = await callApi('/api/auth/password/login', {
    method: 'POST',
    body: payload,
  });
  // 403 email_verification_required is thrown as AuthApiError with
  // extras (code, mustResetPassword, hasRealEmail) for the Login UI.
  return readJsonOrThrow<PasswordAuthResponse>(res);
}

export async function startEmailVerification(payload: {
  username?: string;
  password?: string;
  email?: string;
}): Promise<{
  ok: boolean;
  purpose?: string;
  mustResetPassword?: boolean;
  alreadyVerified?: boolean;
}> {
  const res = await callApi('/api/auth/password/start-verification', {
    method: 'POST',
    body: payload,
  });
  return readJsonOrThrow(res);
}

export async function setPassword(password: string): Promise<PasswordAuthResponse> {
  const res = await callApi('/api/auth/password/set', {
    method: 'POST',
    body: { password },
  });
  return readJsonOrThrow<PasswordAuthResponse>(res);
}

// PR #77 atomic onboarding: the endpoint now creates the family,
// the first profile-member row, and flips onboarding_completed in a
// single transaction. The legacy "flag-flip only" version of this
// endpoint and the now-deleted POST /api/onboarding/create-family
// are both gone.
export interface OnboardingCompleteRequest {
  family: { name: string };
  user: {
    name: string;
    category: 'adult' | 'teen' | 'child';
    portionFactor: number;
  };
}

export interface OnboardingCompleteResponse {
  ok: boolean;
  user: {
    id: number;
    email: string;
    name: string | null;
    role: 'owner' | 'adult' | 'child';
    familyId: number | null;
    profileMemberId: number | null;
    onboardingCompleted: boolean;
  };
  family: {
    id: number;
    name: string;
    ownerUserId: number;
    createdAt: string;
  };
  member: {
    id: number;
    name: string;
    category: 'adult' | 'teen' | 'child';
    portionFactor: number;
  };
}

export async function completeOnboarding(
  payload: OnboardingCompleteRequest
): Promise<OnboardingCompleteResponse> {
  const res = await callApi('/api/auth/onboarding/complete', {
    method: 'POST',
    body: payload,
  });
  return readJsonOrThrow<OnboardingCompleteResponse>(res);
}

export async function logout(): Promise<{ ok: boolean }> {
  const res = await callApi('/api/auth/logout', {
    method: 'POST',
    body: {},
  });
  return readJsonOrThrow<{ ok: boolean }>(res);
}

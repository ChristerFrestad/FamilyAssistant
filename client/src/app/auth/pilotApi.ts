// Backend client for the pre-auth pilot-password gate.
//
// Used only when PILOT_MODE=true on the backend. Two endpoints:
//   - GET /api/pilot/status          — returns { pilotMode, pilotAuthenticated }
//   - POST /api/auth/pilot-password  — submits the password, sets cookie on success
//
// All requests use credentials: 'include' so the pilot cookie can be
// read back on subsequent calls. On rate-limit (429) the response body
// includes retryAfterSeconds so the gate UI can show how long to wait.

export interface PilotStatusResponse {
  pilotMode: boolean;
  pilotAuthenticated: boolean;
}

export type PilotPasswordResult =
  | { ok: true }
  | { ok: false; code: 'wrong_password'; attemptsRemaining: number }
  | { ok: false; code: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; code: 'pilot_disabled' }
  | { ok: false; code: 'network_error' };

export async function fetchPilotStatus(signal?: AbortSignal): Promise<PilotStatusResponse> {
  const init: RequestInit = {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (signal) init.signal = signal;
  const res = await fetch('/api/pilot/status', init);
  if (!res.ok) {
    // The endpoint is expected to always return 200 with the structured
    // body. A non-2xx is an unexpected server error; treat as
    // "pilot disabled" so the app doesn't get stuck behind a gate it
    // cannot resolve.
    return { pilotMode: false, pilotAuthenticated: true };
  }
  return (await res.json()) as PilotStatusResponse;
}

export async function submitPilotPassword(password: string): Promise<PilotPasswordResult> {
  let res: Response;
  try {
    res = await fetch('/api/auth/pilot-password', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, code: 'network_error' };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through
  }

  if (res.ok) return { ok: true };

  if (res.status === 429) {
    const retryAfterSeconds =
      typeof (body as { retryAfterSeconds?: unknown })?.retryAfterSeconds === 'number'
        ? (body as { retryAfterSeconds: number }).retryAfterSeconds
        : 600;
    return { ok: false, code: 'rate_limited', retryAfterSeconds };
  }

  if (res.status === 503) {
    return { ok: false, code: 'pilot_disabled' };
  }

  const attemptsRemaining =
    typeof (body as { attemptsRemaining?: unknown })?.attemptsRemaining === 'number'
      ? (body as { attemptsRemaining: number }).attemptsRemaining
      : 0;
  return { ok: false, code: 'wrong_password', attemptsRemaining };
}

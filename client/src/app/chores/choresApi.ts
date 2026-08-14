// Backend client for the Chores screen.
//
// Endpoints:
//   GET  /api/chores/current     — this week's schedule
//   PUT  /api/chores/complete    — mark done
//   PUT  /api/chores/undone      — revert to pending
//   PUT  /api/chores/postpone    — adult, one day later
//   POST /api/chores             — adult create
//
// Same fetch conventions as mealsApi/familyApi: credentials:'include'
// and a typed error that carries HTTP status.

export class ChoresApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChoresApiError';
    this.status = status;
  }
}

export type ChoreStatus = 'pending' | 'done' | 'postponed';

export type ChoreFrequency = 'ukentlig' | '14_dager' | 'etter_behov';

export interface CurrentChore {
  choreId: number;
  task: string;
  icon: string;
  frequency: string;
  details?: string | null;
  scheduledDay: number;
  postponedTo: number | null;
  effectiveDay: number;
  dayName: string;
  status: ChoreStatus;
  assignedUserId?: number | null;
  assignedName?: string | null;
  assigneeMemberId?: number | null;
}

export interface ChoresCurrentResponse {
  weekYear: string;
  chores: CurrentChore[];
}

export interface CreateChoreBody {
  task: string;
  details?: string | null;
  frequency: ChoreFrequency;
  defaultDay?: number | null;
  icon?: string | null;
  assigneeMemberId?: number | null;
}

export interface CreatedChore {
  id: number;
  task: string;
  details: string | null;
  frequency: string;
  defaultDay: number | null;
  icon: string | null;
  assigneeMemberId: number | null;
  intervalDays: number | null;
  active: boolean;
}

interface FetchOptions {
  signal?: AbortSignal;
}

async function parseBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorFrom(res: Response, parsed: unknown): ChoresApiError {
  const detail =
    parsed && typeof parsed === 'object' && 'detail' in parsed
      ? String((parsed as { detail: unknown }).detail)
      : `HTTP ${res.status}`;
  return new ChoresApiError(res.status, detail);
}

async function getJson<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(path, init);
  const parsed = await parseBody(res);
  if (!res.ok) throw errorFrom(res, parsed);
  return parsed as T;
}

async function sendJson<T>(path: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const parsed = await parseBody(res);
  if (!res.ok) throw errorFrom(res, parsed);
  return parsed as T;
}

export interface ChoreStatsUser {
  userId: number | null;
  name: string | null;
  xp: number;
  completions: number;
}

export interface ChoreStatsResponse {
  enabled: boolean;
  goal: number;
  byUser: ChoreStatsUser[];
  streakByUser?: { userId: number; streak: number }[];
}

export async function fetchChoreStats(
  week?: string,
  signal?: AbortSignal
): Promise<ChoreStatsResponse> {
  const q = week ? `?week=${encodeURIComponent(week)}` : '';
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return getJson<ChoreStatsResponse>(`/api/chores/stats${q}`, init);
}

export async function fetchChoresCurrent(signal?: AbortSignal): Promise<ChoresCurrentResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return getJson<ChoresCurrentResponse>('/api/chores/current', init);
}

export async function completeChore(choreId: number, weekYear?: string): Promise<{ ok: true }> {
  const body: { choreId: number; weekYear?: string } = { choreId };
  if (weekYear) body.weekYear = weekYear;
  return sendJson<{ ok: true }>('/api/chores/complete', 'PUT', body);
}

export async function undoChore(choreId: number, weekYear?: string): Promise<{ ok: true }> {
  const body: { choreId: number; weekYear?: string } = { choreId };
  if (weekYear) body.weekYear = weekYear;
  return sendJson<{ ok: true }>('/api/chores/undone', 'PUT', body);
}

export async function postponeChore(choreId: number, weekYear?: string): Promise<{ ok: true }> {
  const body: { choreId: number; weekYear?: string } = { choreId };
  if (weekYear) body.weekYear = weekYear;
  return sendJson<{ ok: true }>('/api/chores/postpone', 'PUT', body);
}

export async function createChore(
  body: CreateChoreBody
): Promise<{ ok: true; chore: CreatedChore }> {
  return sendJson<{ ok: true; chore: CreatedChore }>('/api/chores', 'POST', body);
}

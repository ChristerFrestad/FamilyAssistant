// Integration tests for the Settings screen.
//
// useSettingsData has its own tests; here we mount the full screen,
// spy on globalThis.fetch and assert:
//   * skeleton, error, and data states render
//   * 4 sections are present (System, Family, User, Account)
//   * disabled rows surface their badges
//   * family name inline-edit calls PUT /api/family
//   * owner-blocked delete state is wired through user.role
//   * GDPR export triggers /api/me/export
//   * GDPR delete with confirm triggers DELETE /api/me

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import { Settings } from './Settings';
import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeContext';
import type { AuthUser } from '../auth/authApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
});

const ownerUser: AuthUser = {
  id: 1,
  email: 'owner@test',
  name: 'Owner',
  role: 'owner',
  avatarUrl: null,
  familyId: 1,
  profileMemberId: null,
  onboardingCompleted: true,
  synthetic: false,
};

const adultMember: AuthUser = {
  id: 2,
  email: 'adult@test',
  name: 'Adult',
  role: 'adult',
  avatarUrl: null,
  familyId: 1,
  profileMemberId: null,
  onboardingCompleted: true,
  synthetic: false,
};

const ownerWithoutFamily: AuthUser = {
  id: 3,
  email: 'orphan@test',
  name: 'Orphan',
  role: 'owner',
  avatarUrl: null,
  familyId: null,
  profileMemberId: null,
  onboardingCompleted: true,
  synthetic: false,
};

const FAMILY_PAYLOAD = {
  family: {
    id: 1,
    name: 'Frestad',
    ownerUserId: 1,
    createdAt: '2026-01-01',
    updatedAt: '2026-04-01',
  },
  profileMembers: [],
  users: [],
  portionSum: 1,
};

function mountSettings(user: AuthUser = ownerUser) {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <ThemeProvider>
        <AuthProvider initialState={{ user, isLoading: false }}>
          <Routes>
            <Route path="/settings" element={<Settings />} />
            <Route path="/login" element={<div data-testid="login-route">Login</div>} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function mockFetchByPath(handlers: Record<string, (init?: RequestInit) => Response>): void {
  fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url === pattern) return Promise.resolve(handler(init));
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

describe('Settings — loading/error states', () => {
  test('renders skeleton initially', () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    mountSettings();
    expect(screen.getByTestId('settings-skeleton')).toBeInTheDocument();
    if (resolveFetch) (resolveFetch as (res: Response) => void)(jsonResponse(200, FAMILY_PAYLOAD));
  });

  test('renders error card when fetch fails', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(500, { detail: 'boom' }),
    });
    mountSettings();
    await waitFor(() => expect(screen.getByTestId('settings-error')).toBeInTheDocument());
  });
});

describe('Settings — sections', () => {
  test('renders all five sections (System, Family, User, Account, Session)', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_PAYLOAD),
    });
    mountSettings();
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    expect(screen.getByRole('heading', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Familie' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bruker' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Konto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sesjon' })).toBeInTheDocument();
  });

  test('renders logout button in Session section', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_PAYLOAD),
    });
    mountSettings();
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    expect(screen.getByTestId('settings-logout-button')).toBeInTheDocument();
  });

  test('renders disabled rows with realistic badges (post-pilot + Resend gate)', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_PAYLOAD),
    });
    mountSettings();
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    const badges = screen.getAllByTestId('settings-row-badge');
    expect(badges.length).toBeGreaterThan(0);
    const texts = badges.map((b) => b.textContent ?? '');
    // Post-pilot badge for features deferred until after pilot launch:
    // timezone, mealTimes, pushNotifications.
    expect(texts.some((t) => t.includes('post-pilot'))).toBe(true);
    // emailNotifications keeps the Resend-gate badge — it activates in
    // Sprint 7 once Christer wires RESEND_API_KEY.
    expect(texts.some((t) => t.includes('Resend'))).toBe(true);
    // Old Sprint 6/7 badges are gone for these specific rows.
    expect(texts.every((t) => !/Sprint [67]/.test(t) || t.includes('Resend'))).toBe(true);
  });

  test('renders version footer', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_PAYLOAD),
    });
    mountSettings();
    await waitFor(() => expect(screen.getByTestId('settings-version')).toBeInTheDocument());
    expect(screen.getByTestId('settings-version').textContent).toContain('v1.3.0');
  });
});

describe('Settings — family name (inline edit)', () => {
  test('shows family name in read mode', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_PAYLOAD),
    });
    mountSettings();
    await waitFor(() => expect(screen.getByText('Frestad')).toBeInTheDocument());
  });

  test('owner can edit family name and save calls PUT /api/family', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/family' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, FAMILY_PAYLOAD));
      }
      if (url === '/api/family' && init?.method === 'PUT') {
        return Promise.resolve(
          jsonResponse(200, {
            ok: true,
            family: {
              ...FAMILY_PAYLOAD.family,
              name: 'Husby',
              updatedAt: '2026-05-01',
            },
          })
        );
      }
      return Promise.reject(new Error(`Unmocked: ${url}`));
    });
    mountSettings();
    await waitFor(() => expect(screen.getByText('Frestad')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('inline-editable-edit'));
    fireEvent.change(screen.getByTestId('inline-editable-input'), {
      target: { value: 'Husby' },
    });
    fireEvent.click(screen.getByTestId('inline-editable-save'));
    await waitFor(() => expect(screen.getByText('Husby')).toBeInTheDocument());

    type FetchCall = [RequestInfo | URL, RequestInit | undefined];
    const calls = fetchSpy.mock.calls as unknown as FetchCall[];
    const putCall = calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeTruthy();
  });

  test('non-owner sees readOnly state with hint', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_PAYLOAD),
    });
    mountSettings(adultMember);
    await waitFor(() => expect(screen.getByText('Frestad')).toBeInTheDocument());
    expect(screen.queryByTestId('inline-editable-edit')).toBeNull();
    expect(screen.getByText(/Kun owner kan endre/i)).toBeInTheDocument();
  });
});

describe('Settings — GDPR export', () => {
  test('clicking export calls /api/me/export', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/family') return Promise.resolve(jsonResponse(200, FAMILY_PAYLOAD));
      if (url === '/api/me/export') {
        return Promise.resolve(jsonResponse(200, { exportVersion: 1, user: { email: 'x@y' } }));
      }
      return Promise.reject(new Error(`Unmocked: ${url}`));
    });
    mountSettings();
    await waitFor(() => expect(screen.getByTestId('settings-export-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('settings-export-button'));
    await waitFor(() => {
      type FetchCall = [RequestInfo | URL, RequestInit | undefined];
      const allCalls = fetchSpy.mock.calls as unknown as FetchCall[];
      const urls = allCalls.map(([input]) =>
        typeof input === 'string' ? input : input.toString()
      );
      expect(urls).toContain('/api/me/export');
    });
  });
});

describe('Settings — GDPR delete', () => {
  test('owner with family is blocked with hint', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_PAYLOAD),
    });
    mountSettings(ownerUser);
    await waitFor(() => expect(screen.getByTestId('settings-delete-button')).toBeInTheDocument());

    expect((screen.getByTestId('settings-delete-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('settings-delete-owner-hint')).toBeInTheDocument();
  });

  test('non-owner can delete and is redirected on success', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/family') return Promise.resolve(jsonResponse(200, FAMILY_PAYLOAD));
      if (url === '/api/me' && init?.method === 'DELETE') {
        return Promise.resolve(
          jsonResponse(200, { ok: true, hardDeleteAt: '2026-05-31', graceDays: 30 })
        );
      }
      return Promise.reject(new Error(`Unmocked: ${url}`));
    });
    // Mock window.confirm to always accept.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    mountSettings(adultMember);
    await waitFor(() => expect(screen.getByTestId('settings-delete-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('settings-delete-button'));

    await waitFor(() => expect(screen.getByTestId('login-route')).toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  test('owner without family can delete (familyId = null)', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_PAYLOAD),
    });
    mountSettings(ownerWithoutFamily);
    await waitFor(() => expect(screen.getByTestId('settings-delete-button')).toBeInTheDocument());

    // Even though user is owner, familyId=null means not blocked.
    expect((screen.getByTestId('settings-delete-button') as HTMLButtonElement).disabled).toBe(
      false
    );
    expect(screen.queryByTestId('settings-delete-owner-hint')).toBeNull();
  });
});

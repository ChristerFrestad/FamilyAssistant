// Tests for the six Sprint 3 / Fase 1e auth + onboarding screens.
//
// Each screen gets a render-test that asserts the heading + key
// interactive element. Welcome, Login, and FamilySetup also get
// submit-flow tests that mock fetch and assert the right
// endpoint is hit. The intent is to lock down the contract
// between screen and AuthContext / authApi without re-testing
// the network layer (already covered by authApi-level fetch
// mocks in AuthContext.test.tsx).

import { render, screen, fireEvent, act } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthContext';
import type { AuthUser } from '../../auth/authApi';

import { Welcome } from './Welcome';
import { Login } from './Login';
import { MagicLinkSent } from './MagicLinkSent';
import { AuthCallback } from './AuthCallback';
import { FamilySetup } from './FamilySetup';
import { UserProfile } from './UserProfile';

const TEST_USER: AuthUser = {
  id: 1,
  email: 'test@example.com',
  name: 'Test',
  role: 'adult',
  avatarUrl: null,
  familyId: null,
  profileMemberId: null,
  onboardingCompleted: false,
  synthetic: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderScreen(
  ui: JSX.Element,
  options: { user?: AuthUser | null; path?: string; state?: unknown } = {}
): void {
  const { user = null, path = '/', state } = options;
  // MemoryRouter accepts entries either as plain path-strings ("/foo
  // ?bar=1") or as {pathname, search, state} objects. Plain strings
  // get parsed by react-router so ?-search and #-hash propagate to
  // useSearchParams etc; the object form requires the search to be
  // passed under its own key. We split the input here so query
  // strings actually arrive at useSearchParams.
  const [pathname, search = ''] = path.split('?');
  const entry = state
    ? { pathname: pathname ?? '/', search: search ? `?${search}` : '', state }
    : { pathname: pathname ?? '/', search: search ? `?${search}` : '' };
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider initialState={{ user, isLoading: false }}>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

// ----------------------------------------------------------------
// Welcome
// ----------------------------------------------------------------

describe('Welcome', () => {
  test('renders the brand-aware heading and two CTAs', () => {
    renderScreen(<Welcome />);
    // Heading interpolates appName ("FamilyAssistant" by default).
    expect(
      screen.getByRole('heading', { name: /Velkommen til FamilyAssistant/, level: 1 })
    ).toBeInTheDocument();
    // Both CTAs link to /login.
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links[0]).toHaveAttribute('href', '/login');
  });
});

// ----------------------------------------------------------------
// Login
// ----------------------------------------------------------------

describe('Login', () => {
  test('renders heading and email input', () => {
    renderScreen(<Login />);
    expect(
      screen.getByRole('heading', { name: /Logg inn på FamilyAssistant/, level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /E-postadresse/i })).toBeInTheDocument();
  });

  test('submit button stays disabled until email is non-empty', () => {
    renderScreen(<Login />);
    const submit = screen.getByRole('button', { name: /Send innloggings-link/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /E-postadresse/i }), {
      target: { value: 'foo@example.com' },
    });
    expect(submit).not.toBeDisabled();
  });

  test('submit POSTs to /api/auth/magic-link/start', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { ok: true, message: 'sent' }));
    renderScreen(<Login />);

    fireEvent.change(screen.getByRole('textbox', { name: /E-postadresse/i }), {
      target: { value: 'foo@example.com' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('textbox', { name: /E-postadresse/i }).closest('form')!);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/magic-link/start',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('shows rate-limit hint on 429 response', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(429, { title: 'Too Many Requests', detail: 'wait' }));
    renderScreen(<Login />);

    fireEvent.change(screen.getByRole('textbox', { name: /E-postadresse/i }), {
      target: { value: 'foo@example.com' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('textbox', { name: /E-postadresse/i }).closest('form')!);
    });

    expect(screen.getByText(/mange linker/)).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------
// MagicLinkSent
// ----------------------------------------------------------------

describe('MagicLinkSent', () => {
  test('renders the email from route state', () => {
    renderScreen(<MagicLinkSent />, { state: { email: 'foo@example.com' } });
    expect(
      screen.getByRole('heading', { name: 'Sjekk e-posten din', level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText(/foo@example\.com/)).toBeInTheDocument();
  });

  test('falls back to generic copy when no state is present', () => {
    renderScreen(<MagicLinkSent />);
    expect(
      screen.getByRole('heading', { name: 'Sjekk e-posten din', level: 1 })
    ).toBeInTheDocument();
  });

  test('Try again link points back to /login', () => {
    renderScreen(<MagicLinkSent />);
    expect(screen.getByRole('link', { name: /Be om en ny link/ })).toHaveAttribute(
      'href',
      '/login'
    );
  });
});

// ----------------------------------------------------------------
// AuthCallback
// ----------------------------------------------------------------

describe('AuthCallback', () => {
  test('shows verifying state initially, then success after refresh', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { authenticated: true, user: TEST_USER }));
    await act(async () => {
      renderScreen(<AuthCallback />, { path: '/auth/callback' });
    });
    expect(screen.getByText(/Logget inn/)).toBeInTheDocument();
  });

  test('shows error when query has ?error=expired', () => {
    renderScreen(<AuthCallback />, { path: '/auth/callback?error=expired' });
    expect(
      screen.getByRole('heading', { name: 'Linken kunne ikke verifiseres', level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText(/utløpt/i)).toBeInTheDocument();
  });

  test('error view links back to /login', () => {
    renderScreen(<AuthCallback />, { path: '/auth/callback?error=invalid' });
    expect(screen.getByRole('link', { name: /Tilbake til innlogging/ })).toHaveAttribute(
      'href',
      '/login'
    );
  });
});

// ----------------------------------------------------------------
// FamilySetup
// ----------------------------------------------------------------

describe('FamilySetup', () => {
  test('renders heading + family-name input', () => {
    renderScreen(<FamilySetup />, { user: TEST_USER });
    expect(screen.getByRole('heading', { name: 'Lag familien din', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Familienavn/ })).toBeInTheDocument();
  });

  test('submit POSTs to /api/onboarding/create-family then refreshes', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          family: { id: 5, name: 'Frestad', ownerUserId: 1, createdAt: 'now' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { authenticated: true, user: { ...TEST_USER, familyId: 5 } })
      );

    renderScreen(<FamilySetup />, { user: TEST_USER });
    fireEvent.change(screen.getByRole('textbox', { name: /Familienavn/ }), {
      target: { value: 'Frestad' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('textbox', { name: /Familienavn/ }).closest('form')!);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/onboarding/create-family',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('blocks empty submission with a client-side error', async () => {
    renderScreen(<FamilySetup />, { user: TEST_USER });
    const submit = screen.getByRole('button', { name: /Opprett familien/ });
    expect(submit).toBeDisabled();
  });
});

// ----------------------------------------------------------------
// UserProfile
// ----------------------------------------------------------------

describe('UserProfile', () => {
  test('renders heading + role radiogroup', () => {
    renderScreen(<UserProfile />, { user: TEST_USER });
    expect(screen.getByRole('heading', { name: 'Profilen din', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Rolle' })).toBeInTheDocument();
    // Three role options.
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  test('submit POSTs to /api/auth/onboarding/complete', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          user: { ...TEST_USER, onboardingCompleted: true },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          authenticated: true,
          user: { ...TEST_USER, onboardingCompleted: true },
        })
      );

    renderScreen(<UserProfile />, { user: TEST_USER });
    fireEvent.change(screen.getByRole('textbox', { name: 'Navnet ditt' }), {
      target: { value: 'Christer' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('textbox', { name: 'Navnet ditt' }).closest('form')!);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/onboarding/complete',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

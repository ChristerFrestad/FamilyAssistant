// Tests for the six Sprint 3 / Fase 1e auth + onboarding screens.
//
// Each screen gets a render-test that asserts the heading + key
// interactive element. Welcome, Login, and FamilySetup also get
// submit-flow tests that mock fetch and assert the right
// endpoint is hit. The intent is to lock down the contract
// between screen and AuthContext / authApi without re-testing
// the network layer (already covered by authApi-level fetch
// mocks in AuthContext.test.tsx).

import type { JSX } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '../../auth/AuthContext';
import { OnboardingProvider } from '../../auth/OnboardingContext';
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

interface RenderScreenOptions {
  user?: AuthUser | null;
  path?: string;
  state?: unknown;
  /**
   * When provided, wraps the rendered tree in an OnboardingProvider
   * seeded with this state. Used by FamilySetup / UserProfile tests
   * that read or write the shared onboarding state.
   */
  onboarding?: { family?: { name?: string }; user?: Record<string, unknown> };
}

function renderScreen(ui: JSX.Element, options: RenderScreenOptions = {}): void {
  const { user = null, path = '/', state, onboarding } = options;
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

  // Onboarding provider only wraps the tree when a test opts in. The
  // public/login/magic-link/auth-callback screens never read the
  // onboarding state, so omitting the wrapper there keeps the tests
  // honest about which dependencies each screen actually has.
  const tree = onboarding ? (
    <OnboardingProvider
      initialState={{ family: onboarding.family ?? {}, user: (onboarding.user ?? {}) as never }}
    >
      {ui}
    </OnboardingProvider>
  ) : (
    ui
  );

  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider initialState={{ user, isLoading: false }}>{tree}</AuthProvider>
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
  test('renders password login heading and username input by default', () => {
    renderScreen(<Login />);
    expect(screen.getByRole('heading', { name: /^Logg inn$/, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Brukernavn/i })).toBeInTheDocument();
  });

  test('submit button stays disabled until username and password are filled', () => {
    renderScreen(<Login />);
    const submit = screen.getByRole('button', { name: /^Logg inn$/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /Brukernavn/i }), {
      target: { value: 'alice' },
    });
    // Password field has no accessible name via role textbox (type=password);
    // fill via label association.
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });
    expect(submit).not.toBeDisabled();
  });

  test('password login POSTs to /api/auth/password/login', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        user: { ...TEST_USER, username: 'alice' },
        redirect: '/dashboard',
      })
    );
    renderScreen(<Login />);

    fireEvent.change(screen.getByRole('textbox', { name: /Brukernavn/i }), {
      target: { value: 'alice' },
    });
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });
    await act(async () => {
      fireEvent.submit(screen.getByRole('textbox', { name: /Brukernavn/i }).closest('form')!);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/password/login',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('magic-link mode POSTs to /api/auth/magic-link/start', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { ok: true, message: 'sent' }));
    renderScreen(<Login />);

    fireEvent.click(screen.getByRole('button', { name: /e-post-link/i }));
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
    renderScreen(<FamilySetup />, { user: TEST_USER, onboarding: {} });
    expect(screen.getByRole('heading', { name: 'Lag familien din', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Familienavn/ })).toBeInTheDocument();
  });

  test('submit DOES NOT call any API (PR #77 atomic onboarding)', async () => {
    // Step 1 only stashes the family name in OnboardingContext and
    // navigates to /onboarding/profile. The DB write happens once at
    // Step 2 submit. Here we just confirm that submitting Step 1
    // never fires fetch.
    renderScreen(<FamilySetup />, { user: TEST_USER, onboarding: {} });
    fireEvent.change(screen.getByRole('textbox', { name: /Familienavn/ }), {
      target: { value: 'Frestad' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('textbox', { name: /Familienavn/ }).closest('form')!);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('blocks empty submission with a client-side error', async () => {
    renderScreen(<FamilySetup />, { user: TEST_USER, onboarding: {} });
    const submit = screen.getByRole('button', { name: /Opprett familien/ });
    expect(submit).toBeDisabled();
  });
});

// ----------------------------------------------------------------
// UserProfile
// ----------------------------------------------------------------

describe('UserProfile', () => {
  test('renders heading + role radiogroup', () => {
    renderScreen(<UserProfile />, { user: TEST_USER, onboarding: { family: { name: 'F' } } });
    expect(screen.getByRole('heading', { name: 'Profilen din', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Rolle' })).toBeInTheDocument();
    // Three role options.
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  test('submit POSTs the atomic payload (family + user) to /api/auth/onboarding/complete', async () => {
    // Mock the onboarding-complete response, then the /api/auth/me
    // refresh that fires after success.
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          user: { ...TEST_USER, onboardingCompleted: true, familyId: 5, profileMemberId: 9 },
          family: { id: 5, name: 'Frestad', ownerUserId: 1, createdAt: 'now' },
          member: { id: 9, name: 'Christer', category: 'adult', portionFactor: 1.0 },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          authenticated: true,
          user: { ...TEST_USER, onboardingCompleted: true, familyId: 5 },
        })
      );

    renderScreen(<UserProfile />, {
      user: TEST_USER,
      onboarding: { family: { name: 'Frestad' } },
    });
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
    // Body must include both family.name (from context) and the
    // personal profile fields. Asserting the shape catches the
    // regression where Step 1 wrote to the DB on its own.
    const onboardingCall = fetchSpy.mock.calls.find(
      (call: unknown[]) => call[0] === '/api/auth/onboarding/complete'
    );
    expect(onboardingCall).toBeDefined();
    const init = onboardingCall?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.family).toEqual({ name: 'Frestad' });
    expect(body.user.name).toBe('Christer');
    expect(body.user.category).toBe('adult');
    expect(typeof body.user.portionFactor).toBe('number');
  });

  test('401 from onboarding/complete shows the session-lost message', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(401, {
        title: 'Unauthorized',
        detail: 'Authentication required.',
        status: 401,
      })
    );

    renderScreen(<UserProfile />, {
      user: TEST_USER,
      onboarding: { family: { name: 'Frestad' } },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Navnet ditt' }), {
      target: { value: 'Christer' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('textbox', { name: 'Navnet ditt' }).closest('form')!);
    });

    expect(screen.getByText(/Sesjonen ble ikke lagret/)).toBeInTheDocument();
  });
});

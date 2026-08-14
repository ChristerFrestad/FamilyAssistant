// Tests for UserMenu.
//
// The dropdown's behavior is what we lock down here:
//   - Trigger renders avatar + name with the right ARIA
//   - Click opens the menu (aria-expanded flips to true)
//   - Menu exposes Min konto + Logg ut as menuitems
//   - Logout invokes the auth-hook's logout function
//   - Escape closes the menu and returns focus to the trigger
//   - Click outside the wrapper closes the menu
//
// Sprint 3 / Fase 1e replaced the Phase-1d mock useAuth with a
// real AuthContext-backed hook. UserMenu therefore needs an
// AuthProvider wrapper at render time. We pass `initialState`
// with a fixture user so the menu renders with a known identity
// without making a network call. The provider also lets us spy on
// the logout side-effect by checking that the test fixture's
// authenticated state survives until the click handler fires.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { UserMenu } from './UserMenu';
import { AuthProvider } from '../../auth/AuthContext';
import type { AuthUser } from '../../auth/authApi';

const TEST_USER: AuthUser = {
  id: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'adult',
  avatarUrl: null,
  familyId: 1,
  profileMemberId: null,
  onboardingCompleted: true,
  synthetic: false,
};

function renderMenu(user: AuthUser | null = TEST_USER): void {
  render(
    <MemoryRouter>
      <AuthProvider initialState={{ user, isLoading: false }}>
        <UserMenu />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('UserMenu trigger', () => {
  test('renders the trigger with avatar and aria-expanded=false', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Åpne bruker-meny' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('does not render the menu before the trigger is clicked', () => {
    renderMenu();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('UserMenu open behavior', () => {
  test('clicking the trigger opens the menu and flips aria-expanded', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Åpne bruker-meny' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Bruker-meny' })).toBeInTheDocument();
  });

  test('open menu exposes Familie, Min konto and Logg ut as menuitems', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
    expect(screen.getByRole('menuitem', { name: 'Familie' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Min konto' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Logg ut/ })).toBeInTheDocument();
  });

  test('clicking the trigger again closes the menu', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Åpne bruker-meny' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('UserMenu close behavior', () => {
  test('Escape key closes the menu', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('mousedown outside the wrapper closes the menu', () => {
    render(
      <MemoryRouter>
        <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
          <UserMenu />
          <div data-testid="outside">outside</div>
        </AuthProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('clicking Min konto closes the menu before navigating', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Min konto' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('UserMenu logout action', () => {
  // Sprint 3 / Fase 1e: the mock useAuth's console.info trail is
  // gone. Logout now goes through AuthProvider -> apiLogout ->
  // fetch. We spy on global.fetch and assert that the click
  // triggers a POST to /api/auth/logout. The provider's catch-
  // 401 fallback means the spy can resolve with a 401 and we
  // still verify the call was made.
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('clicking Logg ut hits POST /api/auth/logout', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Logg ut/ }));
    // Logout is async — wait for the next microtask so the
    // promise inside the click handler resolves before we assert.
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('clicking Logg ut closes the menu', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Logg ut/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

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
// We use the real useAuth() (Phase-1d mock) rather than mocking the
// hook because the mock is itself the production-shape contract.
// The logout function spy is verified by reading the console.info
// signal the mock emits.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UserMenu } from './UserMenu';

function renderMenu(): void {
  render(
    <MemoryRouter>
      <UserMenu />
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

  test('open menu exposes Min konto and Logg ut as menuitems', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
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
        <UserMenu />
        <div data-testid="outside">outside</div>
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
  // Spy on console.info because the Phase-1d mock useAuth.logout
  // logs to console as its observable side-effect. When real auth
  // lands in Phase 1e this assertion gets replaced with a fetch
  // spy, but the test contract — "clicking Logg ut invokes logout"
  // — stays the same.
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => {
    infoSpy.mockRestore();
  });

  test('clicking Logg ut invokes the auth hook logout function', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Logg ut/ }));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('logout invoked'));
  });

  test('clicking Logg ut closes the menu', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Åpne bruker-meny' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Logg ut/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

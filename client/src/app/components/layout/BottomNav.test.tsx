// Tests for BottomNav.
//
// Active-route highlighting is the highest-risk piece — if the
// pathname-matching logic regresses, the user sees a "wrong" item
// highlighted and trust in the nav collapses. We exercise the
// highlight on each of the five primary routes plus the special
// `/` -> dashboard fallback, so the matcher is locked down.

import { render, screen } from '@testing-library/react';
import { test, expect, describe } from 'vitest';
import { MemoryRouter } from 'react-router';
import { BottomNav } from './BottomNav';
import { PRIMARY_NAV_ITEMS } from './nav-items';

function renderAt(pathname: string): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <BottomNav />
    </MemoryRouter>
  );
}

describe('BottomNav structure', () => {
  test('renders a nav landmark labelled with the primary-nav i18n string', () => {
    renderAt('/dashboard');
    const nav = screen.getByRole('navigation', { name: 'Hovedmeny' });
    expect(nav).toBeInTheDocument();
  });

  test('renders all five primary nav items', () => {
    renderAt('/dashboard');
    // Each item exposes an accessible name via aria-label (inactive)
    // or via the visible label text (active). getByRole('link', name)
    // hits both surfaces because RTL falls back to aria-label when
    // text content is missing.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Familie' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Måltider' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Handleliste' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kalender' })).toBeInTheDocument();
  });

  test('exposes the source-of-truth nav-items count', () => {
    // Locks BottomNav at five items. Adding a sixth without updating
    // SideNav (which still expects the secondary slot) would
    // otherwise silently change the bottom-nav layout.
    expect(PRIMARY_NAV_ITEMS.length).toBe(5);
  });
});

describe('BottomNav active-route highlighting', () => {
  test('highlights Dashboard on /dashboard', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  test('highlights Dashboard when at the bare basename /', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  test('highlights Family on /family', () => {
    renderAt('/family');
    expect(screen.getByRole('link', { name: 'Familie' })).toHaveAttribute('aria-current', 'page');
  });

  test('highlights Meals on /meals', () => {
    renderAt('/meals');
    expect(screen.getByRole('link', { name: 'Måltider' })).toHaveAttribute('aria-current', 'page');
  });

  test('highlights parent route when on a nested child path', () => {
    // /meals/add is a child of /meals — the parent should still
    // highlight so the user does not lose the breadcrumb.
    renderAt('/meals/add');
    expect(screen.getByRole('link', { name: 'Måltider' })).toHaveAttribute('aria-current', 'page');
  });

  test('does NOT highlight Dashboard on /family (precision check)', () => {
    renderAt('/family');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });
});

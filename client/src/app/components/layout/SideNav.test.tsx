// Tests for SideNav. Mirrors BottomNav's coverage but adds Settings
// as the secondary slot — Settings only appears on desktop, so we
// verify both that the link exists in the rail and that its active
// highlight works the same way as the primary items.

import { render, screen } from '@testing-library/react';
import { test, expect, describe } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SideNav } from './SideNav';
import { PRIMARY_NAV_ITEMS, SECONDARY_NAV_ITEMS } from './nav-items';

function renderAt(pathname: string): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <SideNav />
    </MemoryRouter>
  );
}

describe('SideNav structure', () => {
  test('renders a nav landmark labelled with the primary-nav i18n string', () => {
    renderAt('/dashboard');
    const nav = screen.getByRole('navigation', { name: 'Hovedmeny' });
    expect(nav).toBeInTheDocument();
  });

  test('renders all five primary nav items plus Settings', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Familie' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Måltider' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Handleliste' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kalender' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Innstillinger' })).toBeInTheDocument();
  });

  test('exposes the source-of-truth nav-items split', () => {
    // Five primary + one secondary. Locking the split here so
    // accidental moves between the two arrays trip the test.
    expect(PRIMARY_NAV_ITEMS.length).toBe(5);
    expect(SECONDARY_NAV_ITEMS.length).toBe(1);
    expect(SECONDARY_NAV_ITEMS[0]?.id).toBe('settings');
  });
});

describe('SideNav active-route highlighting', () => {
  test('highlights Dashboard on /dashboard', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  test('highlights Settings on /settings', () => {
    renderAt('/settings');
    expect(screen.getByRole('link', { name: 'Innstillinger' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  test('does NOT highlight Settings on /dashboard (precision check)', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('link', { name: 'Innstillinger' })).not.toHaveAttribute('aria-current');
  });
});

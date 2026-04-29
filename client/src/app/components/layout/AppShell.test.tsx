// Tests for AppShell.
//
// AppShell composes 5+ children (header, ThemeToggle, LanguageSwitcher,
// UserMenu, SideNav, BottomNav). The unit test verifies the *shape*:
// landmark roles, the presence of each child, and that {children} is
// rendered inside <main>. Behavior of each individual child is
// covered in its own test file.

import { render, screen } from '@testing-library/react';
import { test, expect, describe } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

function renderShell(pathname = '/dashboard'): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppShell>
        <div data-testid="page-content">Page body</div>
      </AppShell>
    </MemoryRouter>
  );
}

describe('AppShell structure', () => {
  test('renders a banner role for the header', () => {
    renderShell();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  test('renders a main landmark with id="main-content"', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute('id', 'main-content');
  });

  test('renders the page body as children of <main>', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main).toContainElement(screen.getByTestId('page-content'));
  });

  test('renders the skip-link with the i18n target text', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Hopp til hovedinnhold' })).toBeInTheDocument();
  });

  test('renders the brand-link to /dashboard', () => {
    renderShell();
    const link = screen.getByRole('link', { name: 'Familieassistenten — til startsiden' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  test('renders LanguageSwitcher, BottomNav, and SideNav simultaneously', () => {
    // Both nav surfaces sit in the DOM at the same time; CSS media
    // queries decide which is visible. RTL/jsdom does not evaluate
    // media queries, so we verify that BOTH renderings exist via
    // their accessible names — even if one of them is media-hidden
    // in the actual viewport.
    renderShell();
    // LanguageSwitcher exposes a group with the Språk label.
    expect(screen.getByRole('group', { name: 'Språk' })).toBeInTheDocument();
    // BottomNav and SideNav both render <nav aria-label="Hovedmeny">.
    // getAllByRole returns both — exactly two.
    const navs = screen.getAllByRole('navigation', { name: 'Hovedmeny' });
    expect(navs.length).toBe(2);
  });

  test('renders the UserMenu trigger', () => {
    renderShell();
    expect(screen.getByRole('button', { name: 'Åpne bruker-meny' })).toBeInTheDocument();
  });
});

// Tests for QuickActions.
//
// Each button must trigger react-router navigation to a known
// destination. We render inside a MemoryRouter and assert on the
// rendered Routes children — that's the pattern used by AuthGuard
// tests and exercises the actual <Link>/navigate() chain instead
// of mocking it.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QuickActions } from './QuickActions';

function renderQuickActions(): void {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<QuickActions />} />
        <Route path="/meals" element={<div data-testid="dest-meals" />} />
        <Route path="/family" element={<div data-testid="dest-family" />} />
        <Route path="/shopping" element={<div data-testid="dest-shopping" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('QuickActions', () => {
  test('renders three labelled buttons inside a nav landmark', () => {
    renderQuickActions();
    expect(screen.getByRole('navigation', { name: /Hurtighandlinger/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Legg til måltid/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nytt gjøremål/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Legg til på handleliste/i })).toBeInTheDocument();
  });

  test('"Legg til måltid" navigates to /meals', () => {
    renderQuickActions();
    fireEvent.click(screen.getByRole('button', { name: /Legg til måltid/i }));
    expect(screen.getByTestId('dest-meals')).toBeInTheDocument();
  });

  test('"Nytt gjøremål" navigates to /family (chores live there until Sprint 5)', () => {
    renderQuickActions();
    fireEvent.click(screen.getByRole('button', { name: /Nytt gjøremål/i }));
    expect(screen.getByTestId('dest-family')).toBeInTheDocument();
  });

  test('"Legg til på handleliste" navigates to /shopping', () => {
    renderQuickActions();
    fireEvent.click(screen.getByRole('button', { name: /Legg til på handleliste/i }));
    expect(screen.getByTestId('dest-shopping')).toBeInTheDocument();
  });
});

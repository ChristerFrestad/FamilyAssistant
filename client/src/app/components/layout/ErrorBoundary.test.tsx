// Tests for ErrorBoundary.

import type { JSX } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('boom');
}

function Safe(): JSX.Element {
  return <div data-testid="safe">safe</div>;
}

let originalReload: typeof window.location.reload;

beforeEach(() => {
  originalReload = window.location.reload;
  // jsdom's window.location is read-only — we cannot just assign reload.
  // Replace via Object.defineProperty so the spy mock is callable.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: originalReload },
  });
});

describe('ErrorBoundary', () => {
  test('renders children when no error is thrown', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Safe />
        </ErrorBoundary>
      </MemoryRouter>
    );
    expect(screen.getByTestId('safe')).toBeInTheDocument();
  });

  test('renders fallback when child throws', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary silent>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>
    );
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Noe gikk galt' })).toBeInTheDocument();
    // Default messageKey = genericMessage
    expect(screen.getByText(/Vi kunne ikke vise denne siden/)).toBeInTheDocument();
  });

  test('uses shoppingMessage when messageKey is set', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary silent messageKey="shoppingMessage">
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>
    );
    expect(screen.getByText(/Vi kunne ikke vise handlelisten/)).toBeInTheDocument();
  });

  test('retry button calls window.location.reload', async () => {
    render(
      <MemoryRouter>
        <ErrorBoundary silent>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByTestId('error-boundary-retry'));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  test('back-to-dashboard link points at /dashboard', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary silent>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>
    );
    const link = screen.getByTestId('error-boundary-back');
    expect(link).toHaveAttribute('href', '/dashboard');
    expect(link.textContent).toBe('Tilbake til dashboard');
  });

  test('navigating to /dashboard via the link clears the boundary', async () => {
    render(
      <MemoryRouter initialEntries={['/shopping']}>
        <Routes>
          <Route
            path="/shopping"
            element={
              <ErrorBoundary silent messageKey="shoppingMessage">
                <Boom />
              </ErrorBoundary>
            }
          />
          <Route path="/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('error-boundary-back'));
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });
});

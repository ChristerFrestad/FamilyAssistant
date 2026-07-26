// Tests for ShoppingViewToggle — verifies URL-state pattern, default
// behaviour, and click handling.

import type { JSX } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router';
import i18n from '../../i18n/config';
import { ShoppingViewToggle, readShoppingView } from './ShoppingViewToggle';

function Probe(): JSX.Element {
  const [params] = useSearchParams();
  return (
    <>
      <ShoppingViewToggle />
      <span data-testid="probe-view">{readShoppingView(params)}</span>
    </>
  );
}

function renderWithRouter(initialPath: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/shopping" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('readShoppingView', () => {
  test('returns "list" by default', () => {
    expect(readShoppingView(new URLSearchParams(''))).toBe('list');
  });

  test('returns "pantry" when ?view=pantry', () => {
    expect(readShoppingView(new URLSearchParams('view=pantry'))).toBe('pantry');
  });

  test('returns "list" for unrecognised values', () => {
    expect(readShoppingView(new URLSearchParams('view=foobar'))).toBe('list');
  });

  test('returns "list" when view is empty string', () => {
    expect(readShoppingView(new URLSearchParams('view='))).toBe('list');
  });
});

describe('ShoppingViewToggle — initial state', () => {
  test('marks list as selected by default', () => {
    renderWithRouter('/shopping');
    expect(screen.getByTestId('shopping-view-toggle-list').getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByTestId('shopping-view-toggle-pantry').getAttribute('aria-selected')).toBe(
      'false'
    );
  });

  test('marks pantry as selected when ?view=pantry', () => {
    renderWithRouter('/shopping?view=pantry');
    expect(screen.getByTestId('shopping-view-toggle-pantry').getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByTestId('shopping-view-toggle-list').getAttribute('aria-selected')).toBe(
      'false'
    );
  });
});

describe('ShoppingViewToggle — interaction', () => {
  test('clicking pantry tab updates URL', () => {
    renderWithRouter('/shopping');
    expect(screen.getByTestId('probe-view').textContent).toBe('list');
    fireEvent.click(screen.getByTestId('shopping-view-toggle-pantry'));
    expect(screen.getByTestId('probe-view').textContent).toBe('pantry');
  });

  test('clicking list tab clears the view param', () => {
    renderWithRouter('/shopping?view=pantry');
    expect(screen.getByTestId('probe-view').textContent).toBe('pantry');
    fireEvent.click(screen.getByTestId('shopping-view-toggle-list'));
    expect(screen.getByTestId('probe-view').textContent).toBe('list');
  });
});

describe('ShoppingViewToggle — overrides for testability', () => {
  test('honors active prop', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ShoppingViewToggle active="pantry" />
        </MemoryRouter>
      </I18nextProvider>
    );
    expect(screen.getByTestId('shopping-view-toggle-pantry').getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  test('calls onChange override instead of writing to URL', () => {
    let received: string | null = null;
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ShoppingViewToggle
            active="list"
            onChange={(next) => {
              received = next;
            }}
          />
        </MemoryRouter>
      </I18nextProvider>
    );
    fireEvent.click(screen.getByTestId('shopping-view-toggle-pantry'));
    expect(received).toBe('pantry');
  });
});

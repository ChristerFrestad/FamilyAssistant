// Tests for PantryView — covers loading/empty/error/data states and
// top-level wiring (mark-used dialog, delete, add). The hook itself is
// tested separately; here we mock fetch to drive the visible state.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n/config';
import { PantryView } from './PantryView';
import type { PantryItem as PantryItemType } from '../../pantry/pantryApi';

function makeItem(over: Partial<PantryItemType>): PantryItemType {
  return {
    productKey: 'melk',
    ingredientName: 'melk',
    ingredientNameNo: 'Melk',
    name: 'Melk',
    quantity: 1,
    total: 1,
    ratio: 1,
    isLow: false,
    unit: 'l',
    category: 'Meieri',
    expiresEst: null,
    lastPurchased: null,
    shelfDaysLearned: null,
    shelfDaysSampleCount: 0,
    shelfDaysSeed: null,
    ...over,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mountView() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <PantryView />
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('PantryView — loading state', () => {
  test('shows skeleton on initial mount', () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    mountView();
    expect(screen.getByTestId('pantry-skeleton')).toBeInTheDocument();
  });
});

describe('PantryView — empty state', () => {
  test('shows empty card when there are no items', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    mountView();
    await waitFor(() => expect(screen.queryByTestId('pantry-skeleton')).toBeNull());
    expect(screen.getByTestId('pantry-empty')).toBeInTheDocument();
  });

  test('does not show stats subtitle when total is zero', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    mountView();
    await waitFor(() => expect(screen.queryByTestId('pantry-skeleton')).toBeNull());
    expect(screen.queryByText(/går tomt snart/)).toBeNull();
  });
});

describe('PantryView — data state', () => {
  test('renders items grouped by category', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          makeItem({ productKey: 'melk', name: 'Melk', category: 'Meieri' }),
          makeItem({ productKey: 'smor', name: 'Smør', category: 'Meieri' }),
          makeItem({ productKey: 'pasta', name: 'Pasta', category: 'Tørrvarer' }),
        ],
      })
    );
    mountView();
    await waitFor(() => expect(screen.queryByTestId('pantry-skeleton')).toBeNull());
    expect(screen.getByTestId('pantry-groups')).toBeInTheDocument();
    expect(screen.getByText('Melk')).toBeInTheDocument();
    expect(screen.getByText('Smør')).toBeInTheDocument();
    expect(screen.getByText('Pasta')).toBeInTheDocument();
  });

  test('shows total count and low/expiring badges in header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          makeItem({ productKey: 'a', isLow: true }),
          makeItem({ productKey: 'b', isLow: false }),
        ],
      })
    );
    mountView();
    await waitFor(() => expect(screen.queryByTestId('pantry-skeleton')).toBeNull());
    expect(screen.getByText(/2 varer hjemme/)).toBeInTheDocument();
    expect(screen.getByText(/1 går tomt snart/)).toBeInTheDocument();
  });
});

describe('PantryView — error state', () => {
  test('renders error card with retry button on fetch failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    mountView();
    await waitFor(() => expect(screen.getByTestId('pantry-error')).toBeInTheDocument());
    const retry = screen.getByText(/prøv igjen/i);
    expect(retry).toBeInTheDocument();
  });

  test('retry triggers a fresh fetch', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    mountView();
    await waitFor(() => expect(screen.getByTestId('pantry-error')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/prøv igjen/i));
    await waitFor(() => expect(screen.getByTestId('pantry-empty')).toBeInTheDocument());
  });
});

describe('PantryView — mark used flow', () => {
  test('opening dialog and confirming submits to backend', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { items: [makeItem({ productKey: 'melk', quantity: 2 })] })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          productKey: 'melk',
          prevQty: 2,
          newQty: 1,
          delta: -1,
        })
      );
    mountView();
    await waitFor(() => expect(screen.queryByTestId('pantry-skeleton')).toBeNull());
    fireEvent.click(screen.getByTestId('pantry-mark-used'));
    await waitFor(() => expect(screen.getByTestId('use-dialog-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('use-dialog-input'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('use-dialog-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const correctCall = fetchMock.mock.calls[1];
    expect(correctCall?.[0]).toBe('/api/pantry/correct');
    const init = correctCall?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      productKey: 'melk',
      newQty: 1,
    });
  });
});

describe('PantryView — delete flow', () => {
  test('clicking delete sends DELETE request and removes the row', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [
            makeItem({ productKey: 'melk', name: 'Melk' }),
            makeItem({ productKey: 'smor', name: 'Smør' }),
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, productKey: 'melk' }));
    mountView();
    await waitFor(() => expect(screen.queryByTestId('pantry-skeleton')).toBeNull());
    const deleteButtons = screen.getAllByTestId('pantry-delete');
    expect(deleteButtons.length).toBeGreaterThan(0);
    const firstButton = deleteButtons[0];
    if (!firstButton) throw new Error('button missing');
    fireEvent.click(firstButton);
    await waitFor(() => {
      const items = screen.queryAllByTestId('pantry-item');
      expect(items).toHaveLength(1);
    });
  });
});

describe('PantryView — quick add', () => {
  test('quick-add submits POST with name and qty', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          item: {
            productKey: 'pasta',
            qtyRemaining: 1,
            totalSize: null,
            unit: 'pk',
            expiresEst: null,
            reason: 'manual',
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [makeItem({ productKey: 'pasta', name: 'Pasta', category: 'Tørrvarer' })],
        })
      );
    mountView();
    await waitFor(() => expect(screen.getByTestId('pantry-empty')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'pasta' } });
    fireEvent.click(screen.getByTestId('pantry-quick-add-submit'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const addCall = fetchMock.mock.calls[1];
    expect(addCall?.[0]).toBe('/api/pantry/add');
    expect(JSON.parse((addCall?.[1] as RequestInit).body as string)).toEqual({
      query: 'pasta',
      qty: 1,
    });
  });
});

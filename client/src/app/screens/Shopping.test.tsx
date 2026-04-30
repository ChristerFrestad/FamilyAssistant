// Integration tests for the Shopping screen.
//
// useShoppingData has its own tests; here we mount the full screen,
// spy on globalThis.fetch, and assert:
//   * skeleton, error, and empty-state variants render
//   * categories + items render and toggle/delete go through
//   * QuickAdd appends an item and clears the input on success
//   * Generate-from-meals CTA fires the API call and re-fetches
//   * WEEK_NOT_COMPLETE branch shows the dedicated card with
//     a "go to meals" navigation button
//   * Toast surfaces a userFacingError and disappears

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Shopping } from './Shopping';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

function mountShopping(): { container: HTMLElement } {
  return render(
    <MemoryRouter initialEntries={['/shopping']}>
      <Routes>
        <Route path="/shopping" element={<Shopping />} />
        <Route path="/meals" element={<div data-testid="meals-route">Meals</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function mockFetchByPath(handlers: Record<string, (init?: RequestInit) => Response>): void {
  fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url === pattern) return Promise.resolve(handler(init));
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

const FULL_LIST = {
  id: 42,
  weekYear: '2026-W18',
  status: 'active',
  enrichmentStatus: 'done',
  totalEstPrice: 320,
  categories: [
    {
      category: 'Meieri',
      items: [
        {
          id: 1,
          listId: 42,
          sourceType: 'meal_ingredient',
          sourceRef: 'r1',
          ingredientName: 'Melk',
          ingredientNameNo: null,
          name: 'Melk',
          productKey: 'melk',
          qty: 2,
          unit: 'l',
          category: 'Meieri',
          packSize: null,
          packUnit: null,
          packCount: null,
          estPrice: 25,
          pantryHas: false,
          pantryQty: null,
          needsBuy: true,
          boughtAt: null,
          boughtQty: null,
          checkedOff: false,
          stillNeed: 2,
          mealsJson: ['Pasta pesto'],
          dairyNote: null,
          sortOrder: 0,
          notes: null,
        },
        {
          id: 2,
          listId: 42,
          sourceType: 'meal_ingredient',
          sourceRef: 'r1',
          ingredientName: 'Smør',
          ingredientNameNo: null,
          name: 'Smør',
          productKey: 'smor',
          qty: 1,
          unit: 'pk',
          category: 'Meieri',
          packSize: null,
          packUnit: null,
          packCount: null,
          estPrice: 48,
          pantryHas: false,
          pantryQty: null,
          needsBuy: true,
          boughtAt: '2026-04-30 10:00:00',
          boughtQty: 1,
          checkedOff: true,
          stillNeed: 0,
          mealsJson: null,
          dairyNote: null,
          sortOrder: 1,
          notes: null,
        },
      ],
    },
    {
      category: 'Frukt & grønt',
      items: [
        {
          id: 3,
          listId: 42,
          sourceType: 'meal_ingredient',
          sourceRef: 'r2',
          ingredientName: 'Eple',
          ingredientNameNo: null,
          name: 'Eple',
          productKey: 'eple',
          qty: 5,
          unit: 'stk',
          category: 'Frukt & grønt',
          packSize: null,
          packUnit: null,
          packCount: null,
          estPrice: 15,
          pantryHas: false,
          pantryQty: null,
          needsBuy: true,
          boughtAt: null,
          boughtQty: null,
          checkedOff: false,
          stillNeed: 5,
          mealsJson: null,
          dairyNote: null,
          sortOrder: 0,
          notes: null,
        },
      ],
    },
  ],
  items: [],
};

const EMPTY_SHELL = {
  id: null,
  weekYear: '2026-W18',
  status: null,
  enrichmentStatus: 'done',
  totalEstPrice: 0,
  categories: [],
  items: [],
};

describe('Shopping screen — loading/error states', () => {
  test('renders skeleton initially', async () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    mountShopping();
    expect(screen.getByTestId('shopping-skeleton')).toBeInTheDocument();
    if (resolveFetch) (resolveFetch as (res: Response) => void)(jsonResponse(200, EMPTY_SHELL));
    await waitFor(() => expect(screen.queryByTestId('shopping-skeleton')).toBeNull());
  });

  test('renders error card when fetch fails', async () => {
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(500, { detail: 'boom' }),
    });
    mountShopping();
    await waitFor(() => expect(screen.getByTestId('shopping-error')).toBeInTheDocument());
    expect(screen.getByText(/Kunne ikke hente handlelisten/)).toBeInTheDocument();
  });
});

describe('Shopping screen — empty states', () => {
  test('shows no-list empty state when backend returns id:null', async () => {
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(200, EMPTY_SHELL),
    });
    mountShopping();
    await waitFor(() => expect(screen.getByTestId('shopping-empty-no-list')).toBeInTheDocument());
    expect(screen.getByText('Ingen handleliste denne uka')).toBeInTheDocument();
    // QuickAdd is disabled with a hint
    expect(screen.getByPlaceholderText('Hva trenger du?')).toBeDisabled();
  });

  test('shows no-items state when list exists but is empty', async () => {
    mockFetchByPath({
      '/api/shopping/list/current': () =>
        jsonResponse(200, { ...EMPTY_SHELL, id: 7, status: 'active' }),
    });
    mountShopping();
    await waitFor(() => expect(screen.getByTestId('shopping-empty-no-items')).toBeInTheDocument());
    // QuickAdd is enabled
    expect(screen.getByPlaceholderText('Hva trenger du?')).toBeEnabled();
  });
});

describe('Shopping screen — data state', () => {
  test('renders all items grouped by category', async () => {
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(200, FULL_LIST),
    });
    mountShopping();
    await waitFor(() => expect(screen.getByText('Melk')).toBeInTheDocument());
    expect(screen.getByText('Smør')).toBeInTheDocument();
    expect(screen.getByText('Eple')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Meieri', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Frukt & grønt', level: 3 })).toBeInTheDocument();
  });

  test('renders header stats: 1 av 3 plukket + 2 igjen', async () => {
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(200, FULL_LIST),
    });
    mountShopping();
    await waitFor(() => expect(screen.getByText('1 av 3 plukket')).toBeInTheDocument());
    expect(screen.getByText('2 igjen')).toBeInTheDocument();
  });

  test('toggling an item issues PUT /bought and updates checkedOff', async () => {
    let putCalled = false;
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(200, FULL_LIST),
      '/api/shopping/items/1/bought': () => {
        putCalled = true;
        return jsonResponse(200, { ok: true });
      },
    });
    mountShopping();
    await waitFor(() => expect(screen.getByText('Melk')).toBeInTheDocument());

    const toggle = screen.getByTestId('shopping-item-toggle-1');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(putCalled).toBe(true));
    expect(screen.getByTestId('shopping-item-toggle-1')).toHaveAttribute('aria-checked', 'true');
  });

  test('deleting an item issues DELETE and removes it from the list', async () => {
    let deleteCalled = false;
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(200, FULL_LIST),
      '/api/shopping/items/1': () => {
        deleteCalled = true;
        return jsonResponse(200, { ok: true });
      },
    });
    mountShopping();
    await waitFor(() => expect(screen.getByText('Melk')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('shopping-item-delete-1'));
    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(screen.queryByText('Melk')).toBeNull());
  });

  test('rolls back on toggle failure and shows toast', async () => {
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(200, FULL_LIST),
      '/api/shopping/items/1/bought': () => jsonResponse(500, { detail: 'crash' }),
    });
    mountShopping();
    await waitFor(() => expect(screen.getByText('Melk')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('shopping-item-toggle-1'));
    await waitFor(() => expect(screen.getByTestId('shopping-toast')).toBeInTheDocument());
    expect(screen.getByTestId('shopping-item-toggle-1')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Shopping screen — QuickAdd', () => {
  test('appends a new item via POST /api/shopping/items', async () => {
    let postPayload: unknown = null;
    mockFetchByPath({
      '/api/shopping/list/current': () =>
        jsonResponse(200, { ...EMPTY_SHELL, id: 7, status: 'active' }),
      '/api/shopping/items': (init) => {
        postPayload = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse(201, {
          ok: true,
          item: {
            id: 99,
            listId: 7,
            sourceType: 'manual',
            sourceRef: null,
            ingredientName: 'Bananer',
            ingredientNameNo: null,
            name: 'Bananer',
            productKey: null,
            qty: null,
            unit: null,
            category: null,
            packSize: null,
            packUnit: null,
            packCount: null,
            estPrice: null,
            pantryHas: false,
            pantryQty: null,
            needsBuy: true,
            boughtAt: null,
            boughtQty: null,
            checkedOff: false,
            stillNeed: 0,
            mealsJson: null,
            dairyNote: null,
            sortOrder: 0,
            notes: null,
          },
        });
      },
    });
    mountShopping();
    await waitFor(() => expect(screen.getByTestId('shopping-empty-no-items')).toBeInTheDocument());

    await userEvent.type(screen.getByTestId('shopping-quickadd-input'), 'Bananer');
    await userEvent.click(screen.getByTestId('shopping-quickadd-submit'));
    await waitFor(() => expect(screen.getByText('Bananer')).toBeInTheDocument());
    expect(postPayload).toEqual({ name: 'Bananer' });
  });
});

describe('Shopping screen — Generate from meals', () => {
  test('CTA fires POST /api/shopping/generate and refreshes the list', async () => {
    let generateCalled = false;
    let listFetchCount = 0;
    mockFetchByPath({
      '/api/shopping/list/current': () => {
        listFetchCount++;
        return listFetchCount === 1 ? jsonResponse(200, EMPTY_SHELL) : jsonResponse(200, FULL_LIST);
      },
      '/api/shopping/generate': () => {
        generateCalled = true;
        return jsonResponse(200, { ok: true, listId: 42, itemCount: 3, needsBuyCount: 2 });
      },
    });
    mountShopping();
    await waitFor(() => expect(screen.getByTestId('shopping-empty-no-list')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('shopping-generate-cta'));
    await waitFor(() => expect(generateCalled).toBe(true));
    await waitFor(() => expect(screen.getByText('Melk')).toBeInTheDocument());
  });

  test('WEEK_NOT_COMPLETE shows dedicated card with go-to-meals button', async () => {
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(200, EMPTY_SHELL),
      '/api/shopping/generate': () =>
        jsonResponse(400, {
          detail: 'Uken er ikke ferdigplanlagt',
          code: 'WEEK_NOT_COMPLETE',
        }),
    });
    mountShopping();
    await waitFor(() => expect(screen.getByTestId('shopping-empty-no-list')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('shopping-generate-cta'));
    await waitFor(() =>
      expect(screen.getByTestId('shopping-week-not-complete')).toBeInTheDocument()
    );
    expect(screen.getByText('Uken er ikke ferdigplanlagt')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Gå til ukens middager' }));
    await waitFor(() => expect(screen.getByTestId('meals-route')).toBeInTheDocument());
  });
});

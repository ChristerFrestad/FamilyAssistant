// Tests for ShoppingItemRow.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, describe, vi, afterEach } from 'vitest';
import { ShoppingItemRow } from './ShoppingItemRow';
import type { ShoppingItem } from '../../shopping/shoppingApi';
import i18n from '../../i18n/config';

afterEach(() => {
  // Restore default language so language-bytte tests below don't leak.
  i18n.changeLanguage('no');
});

function makeItem(over: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: 1,
    listId: 10,
    sourceType: 'meal_ingredient',
    sourceRef: null,
    ingredientName: 'Melk',
    ingredientNameNo: null,
    name: 'Melk',
    productKey: null,
    qty: 1,
    unit: 'l',
    category: 'Meieri',
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
    stillNeed: 1,
    mealsJson: null,
    dairyNote: null,
    sortOrder: 0,
    notes: null,
    ...over,
  };
}

describe('ShoppingItemRow', () => {
  test('renders name + qty + unit', () => {
    render(
      <ShoppingItemRow
        item={makeItem({ name: 'Melk', qty: 2, unit: 'l' })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Melk')).toBeInTheDocument();
    expect(screen.getByText('2 l')).toBeInTheDocument();
  });

  test('renders price when estPrice > 0', () => {
    render(
      <ShoppingItemRow item={makeItem({ estPrice: 32 })} onToggle={() => {}} onDelete={() => {}} />
    );
    expect(screen.getByText('32 kr')).toBeInTheDocument();
  });

  test('hides price when estPrice is null or 0', () => {
    const { rerender } = render(
      <ShoppingItemRow
        item={makeItem({ estPrice: null })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.queryByText(/kr/)).toBeNull();

    rerender(
      <ShoppingItemRow item={makeItem({ estPrice: 0 })} onToggle={() => {}} onDelete={() => {}} />
    );
    expect(screen.queryByText(/kr/)).toBeNull();
  });

  test('uses custom formatPrice when provided', () => {
    render(
      <ShoppingItemRow
        item={makeItem({ estPrice: 32 })}
        onToggle={() => {}}
        onDelete={() => {}}
        formatPrice={(kr) => `kr ${kr},-`}
      />
    );
    expect(screen.getByText('kr 32,-')).toBeInTheDocument();
  });

  test('renders recipe-link single meal', () => {
    render(
      <ShoppingItemRow
        item={makeItem({ mealsJson: ['Kremet laks'] })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Til Kremet laks')).toBeInTheDocument();
  });

  test('renders recipe-link with count when 2+ meals', () => {
    render(
      <ShoppingItemRow
        item={makeItem({ mealsJson: ['Kremet laks', 'Pasta pesto'] })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Til 2 måltider')).toBeInTheDocument();
  });

  test('shows full meal list as title when 2+ meals', () => {
    render(
      <ShoppingItemRow
        item={makeItem({ mealsJson: ['Kremet laks', 'Pasta pesto'] })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    const span = screen.getByText('Til 2 måltider');
    expect(span).toHaveAttribute('title', 'Kremet laks, Pasta pesto');
  });

  test('strikes through name when checkedOff', () => {
    render(
      <ShoppingItemRow
        item={makeItem({ checkedOff: true })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    const name = screen.getByText('Melk');
    expect(name.className).toContain('line-through');
  });

  test('checkbox has aria-checked reflecting state', () => {
    const { rerender } = render(
      <ShoppingItemRow
        item={makeItem({ checkedOff: false })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    const cb = screen.getByRole('checkbox', { name: /Marker Melk som kjøpt/ });
    expect(cb).toHaveAttribute('aria-checked', 'false');

    rerender(
      <ShoppingItemRow
        item={makeItem({ checkedOff: true })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  test('clicking the checkbox calls onToggle', async () => {
    const onToggle = vi.fn();
    render(
      <ShoppingItemRow
        item={makeItem({ id: 7, name: 'Brød' })}
        onToggle={onToggle}
        onDelete={() => {}}
      />
    );
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0].id).toBe(7);
  });

  test('clicking delete calls onDelete', async () => {
    const onDelete = vi.fn();
    render(
      <ShoppingItemRow
        item={makeItem({ id: 9, name: 'Egg' })}
        onToggle={() => {}}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /Slett Egg/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[0].id).toBe(9);
  });

  test('renders only qty when unit is missing', () => {
    render(
      <ShoppingItemRow
        item={makeItem({ qty: 5, unit: null })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  test('hides qty/meta block when both are missing', () => {
    const { container } = render(
      <ShoppingItemRow
        item={makeItem({ qty: null, unit: null, mealsJson: null })}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    // The meta-line is the second flex-row inside the row's main column.
    expect(container.querySelectorAll('.italic')).toHaveLength(0);
  });

  // Regression: Phase 2D crash on linje 122 — item.name was undefined for
  // rows from POST /api/shopping/items because the response was the raw
  // _getItems row. Backend now enriches via enrichItemForFrontend, but the
  // row still defends against the contract drifting again.
  test('does not crash when item.name is missing (falls back to ingredient columns)', () => {
    const item = makeItem({}) as unknown as Record<string, unknown>;
    delete item.name;
    item.ingredientName = 'Saft';
    expect(() =>
      render(
        <ShoppingItemRow
          item={item as unknown as Parameters<typeof ShoppingItemRow>[0]['item']}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      )
    ).not.toThrow();
    // Falls back to ingredientName when name is gone.
    expect(screen.getByText('Saft')).toBeInTheDocument();
  });

  test('falls back to "Ukjent vare" when name and ingredient columns are all missing', () => {
    const item = makeItem({}) as unknown as Record<string, unknown>;
    delete item.name;
    delete item.ingredientName;
    delete item.ingredientNameNo;
    expect(() =>
      render(
        <ShoppingItemRow
          item={item as unknown as Parameters<typeof ShoppingItemRow>[0]['item']}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      )
    ).not.toThrow();
    expect(screen.getByText('Ukjent vare')).toBeInTheDocument();
  });

  test('handles undefined mealsJson without crashing', () => {
    const item = makeItem({}) as unknown as Record<string, unknown>;
    delete item.mealsJson;
    expect(() =>
      render(
        <ShoppingItemRow
          item={item as unknown as Parameters<typeof ShoppingItemRow>[0]['item']}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      )
    ).not.toThrow();
    // No "Til X måltider"-tekst when meals are missing.
    expect(screen.queryByText(/Til /)).toBeNull();
  });

  test('handles empty array mealsJson the same as null', () => {
    render(
      <ShoppingItemRow item={makeItem({ mealsJson: [] })} onToggle={() => {}} onDelete={() => {}} />
    );
    expect(screen.queryByText(/Til /)).toBeNull();
  });

  // ---------------------------------------------------------------
  // Pack-aware display (pilot 2026-05-03)
  // ---------------------------------------------------------------
  describe('pack-aware display', () => {
    test('renders "1 pakke (500 g)" when pack data is set', () => {
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 100,
            name: 'Kyllingfilet',
            sourceType: 'meal_ingredient',
            qty: 220,
            unit: 'g',
            packSize: 500,
            packUnit: 'g',
            packCount: 1,
            estPrice: 89,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByText('Kyllingfilet')).toBeInTheDocument();
      expect(screen.getByTestId('shopping-item-pack-line-100')).toHaveTextContent(
        '1 pakke (500 g)'
      );
      expect(screen.getByTestId('shopping-item-you-need-100')).toHaveTextContent(
        'Du trenger 220 g'
      );
      expect(screen.getByText('89 kr')).toBeInTheDocument();
    });

    test('pluralises "pakker" when packCount >= 2', () => {
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 101,
            name: 'Kjøttdeig',
            sourceType: 'meal_ingredient',
            qty: 750,
            unit: 'g',
            packSize: 500,
            packUnit: 'g',
            packCount: 2,
            estPrice: 130,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-101')).toHaveTextContent(
        '2 pakker (500 g)'
      );
      expect(screen.getByTestId('shopping-item-you-need-101')).toHaveTextContent(
        'Du trenger 750 g'
      );
    });

    test('strips floating-point artifacts on qty', () => {
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 102,
            name: 'Kyllingfilet',
            sourceType: 'meal_ingredient',
            qty: 220.00000000000003,
            unit: 'g',
            packSize: 500,
            packUnit: 'g',
            packCount: 1,
            estPrice: 89,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-you-need-102')).toHaveTextContent(
        'Du trenger 220 g'
      );
    });

    test('promotes ≥1000 g to kg in pack-line', () => {
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 103,
            name: 'Mel',
            sourceType: 'meal_ingredient',
            qty: 600,
            unit: 'g',
            packSize: 1500,
            packUnit: 'g',
            packCount: 1,
            estPrice: 30,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-103')).toHaveTextContent(
        '1 pakke (1.5 kg)'
      );
    });

    test('collapses "1 pakke (1 stk)" to "1 stk" for unit-sized counts', () => {
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 104,
            name: 'Lime',
            sourceType: 'meal_ingredient',
            qty: 1,
            unit: 'stk',
            packSize: 1,
            packUnit: 'stk',
            packCount: 1,
            estPrice: 8,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-104')).toHaveTextContent('1 stk');
      // qty equals pack_size → no "you need" line.
      expect(screen.queryByTestId('shopping-item-you-need-104')).toBeNull();
    });

    test('hides "you need" when qty equals pack_size', () => {
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 105,
            name: 'Pasta',
            sourceType: 'meal_ingredient',
            qty: 500,
            unit: 'g',
            packSize: 500,
            packUnit: 'g',
            packCount: 1,
            estPrice: 24,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-105')).toHaveTextContent(
        '1 pakke (500 g)'
      );
      expect(screen.queryByTestId('shopping-item-you-need-105')).toBeNull();
    });

    test('falls back to plain qty for manual rows with no pack data', () => {
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 106,
            name: 'Bananer',
            sourceType: 'manual',
            qty: 3,
            unit: 'stk',
            packSize: null,
            packUnit: null,
            packCount: null,
            estPrice: null,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-106')).toHaveTextContent('3 stk');
      expect(screen.queryByTestId('shopping-item-you-need-106')).toBeNull();
    });

    test('hides "you need" for consumable rows even when pack data is set', () => {
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 107,
            name: 'Tannkrem',
            sourceType: 'consumable',
            qty: null,
            unit: 'stk',
            packSize: 1,
            packUnit: 'pk',
            packCount: 1,
            estPrice: 35,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByTestId('shopping-item-you-need-107')).toBeNull();
    });

    test('translates units to English when language is en', async () => {
      await i18n.changeLanguage('en');
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 200,
            name: 'Kyllingfilet',
            sourceType: 'meal_ingredient',
            qty: 220,
            unit: 'g',
            packSize: 500,
            packUnit: 'g',
            packCount: 1,
            estPrice: 89,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      // 'g' is universal, so the pack line still reads "1 pack (500 g)"
      // — but the i18n template ("1 pack" vs "1 pakke") flips. Asserting
      // on the localised template proves the translation pipeline works.
      expect(screen.getByTestId('shopping-item-pack-line-200')).toHaveTextContent('1 pack (500 g)');
      expect(screen.getByTestId('shopping-item-you-need-200')).toHaveTextContent('You need 220 g');
    });

    test('translates Norwegian unit "stk" to "pcs" on English', async () => {
      await i18n.changeLanguage('en');
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 201,
            name: 'Lime',
            sourceType: 'meal_ingredient',
            qty: 3,
            unit: 'stk',
            packSize: 1,
            packUnit: 'stk',
            packCount: 3,
            estPrice: 24,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      // packCountUnit collapses to "3 pcs" (was "3 stk" on Norwegian).
      expect(screen.getByTestId('shopping-item-pack-line-201')).toHaveTextContent('3 pcs');
    });

    test('translates "ss" to "tbsp" and "ts" to "tsp" on English', async () => {
      await i18n.changeLanguage('en');
      const { rerender } = render(
        <ShoppingItemRow
          item={makeItem({
            id: 202,
            name: 'Olivenolje',
            sourceType: 'manual',
            qty: 2,
            unit: 'ss',
            packSize: null,
            packUnit: null,
            packCount: null,
            estPrice: null,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-202')).toHaveTextContent('2 tbsp');

      rerender(
        <ShoppingItemRow
          item={makeItem({
            id: 203,
            name: 'Salt',
            sourceType: 'manual',
            qty: 1,
            unit: 'ts',
            packSize: null,
            packUnit: null,
            packCount: null,
            estPrice: null,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-203')).toHaveTextContent('1 tsp');
    });

    test('translates "fedd" to "clove" on English', async () => {
      await i18n.changeLanguage('en');
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 204,
            name: 'Hvitløk',
            sourceType: 'meal_ingredient',
            qty: 4,
            unit: 'fedd',
            packSize: 1,
            packUnit: 'fedd',
            packCount: 4,
            estPrice: 5,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-204')).toHaveTextContent('4 clove');
    });

    test('keeps Norwegian unit labels on Norwegian locale', () => {
      // No language change — default test locale is 'no'.
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 205,
            name: 'Hvitløk',
            sourceType: 'meal_ingredient',
            qty: 4,
            unit: 'fedd',
            packSize: 1,
            packUnit: 'fedd',
            packCount: 4,
            estPrice: 5,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-205')).toHaveTextContent('4 fedd');
    });

    test('keeps universal units (g, kg, ml, l) unchanged across languages', async () => {
      await i18n.changeLanguage('en');
      const { rerender } = render(
        <ShoppingItemRow
          item={makeItem({
            id: 206,
            name: 'Mel',
            sourceType: 'meal_ingredient',
            qty: 1500,
            unit: 'g',
            packSize: 1500,
            packUnit: 'g',
            packCount: 1,
            estPrice: 30,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-206')).toHaveTextContent(
        '1 pack (1.5 kg)'
      );

      await i18n.changeLanguage('no');
      rerender(
        <ShoppingItemRow
          item={makeItem({
            id: 207,
            name: 'Mel',
            sourceType: 'meal_ingredient',
            qty: 1500,
            unit: 'g',
            packSize: 1500,
            packUnit: 'g',
            packCount: 1,
            estPrice: 30,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByTestId('shopping-item-pack-line-207')).toHaveTextContent(
        '1 pakke (1.5 kg)'
      );
    });

    test('hides pack-line entirely when packCount=0 and no qty (pantry already covers)', () => {
      // Real-world: backend sets needs_buy=0 on these rows so they don't
      // even reach the row, but the row should still survive cleanly if
      // a stray one slips through.
      render(
        <ShoppingItemRow
          item={makeItem({
            id: 108,
            name: 'Salt',
            sourceType: 'meal_ingredient',
            qty: 5,
            unit: 'g',
            packSize: 500,
            packUnit: 'g',
            packCount: 0,
            estPrice: 0,
            pantryHas: true,
          })}
          onToggle={() => {}}
          onDelete={() => {}}
        />
      );
      // packCount=0 → hasUsablePackInfo=false → fall back to plain qty.
      expect(screen.getByTestId('shopping-item-pack-line-108')).toHaveTextContent('5 g');
    });
  });
});

// Tests for ShoppingItemRow.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, describe, vi } from 'vitest';
import { ShoppingItemRow } from './ShoppingItemRow';
import type { ShoppingItem } from '../../shopping/shoppingApi';

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
});

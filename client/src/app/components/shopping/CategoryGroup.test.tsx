// Tests for CategoryGroup.

import { render, screen } from '@testing-library/react';
import { test, expect, describe, afterEach } from 'vitest';
import { CategoryGroup } from './CategoryGroup';
import type { ShoppingItem } from '../../shopping/shoppingApi';
import i18n from '../../i18n/config';

afterEach(() => {
  // Reset language back to the test-suite default so language-bytte
  // tests below don't leak into other suites.
  i18n.changeLanguage('no');
});

function makeItem(over: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: 1,
    listId: 10,
    sourceType: 'meal_ingredient',
    sourceRef: null,
    ingredientName: 'Milk',
    ingredientNameNo: null,
    name: 'Milk',
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

describe('CategoryGroup', () => {
  test('renders heading + items + remaining count', () => {
    render(
      <CategoryGroup
        category="Meieri"
        items={[
          makeItem({ id: 1, name: 'Melk' }),
          makeItem({ id: 2, name: 'Smør', checkedOff: true }),
        ]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Meieri', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Melk')).toBeInTheDocument();
    expect(screen.getByText('Smør')).toBeInTheDocument();
    // 1 remaining (Smør is bought)
    expect(screen.getByText('1 igjen')).toBeInTheDocument();
  });

  test('renders price total when items have estPrice', () => {
    render(
      <CategoryGroup
        category="Frukt"
        items={[
          makeItem({ id: 1, name: 'Eple', estPrice: 15 }),
          makeItem({ id: 2, name: 'Banan', estPrice: 10 }),
        ]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('25 kr')).toBeInTheDocument();
  });

  test('hides price total when no items have estPrice', () => {
    const { container } = render(
      <CategoryGroup
        category="Frukt"
        items={[makeItem({ id: 1, estPrice: null })]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(container.textContent).not.toContain('kr');
  });

  test('uses formatPrice when provided', () => {
    render(
      <CategoryGroup
        category="Frukt"
        items={[makeItem({ id: 1, estPrice: 25 })]}
        onToggle={() => {}}
        onDelete={() => {}}
        formatPrice={(kr) => `kr ${kr},-`}
      />
    );
    // formatPrice is used both at category-header total and per-item price.
    expect(screen.getAllByText('kr 25,-').length).toBeGreaterThanOrEqual(1);
  });

  test('renders items as listitems', () => {
    render(
      <CategoryGroup
        category="Meieri"
        items={[makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  test('language switch updates the localised category heading', async () => {
    const { rerender } = render(
      <CategoryGroup
        category="other"
        items={[makeItem({ id: 1 })]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Annet', level: 3 })).toBeInTheDocument();

    await i18n.changeLanguage('en');
    rerender(
      <CategoryGroup
        category="other"
        items={[makeItem({ id: 1 })]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Other', level: 3 })).toBeInTheDocument();

    await i18n.changeLanguage('no');
    rerender(
      <CategoryGroup
        category="other"
        items={[makeItem({ id: 1 })]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Annet', level: 3 })).toBeInTheDocument();
  });

  test('localises known enum-key categories through i18n', () => {
    const { rerender } = render(
      <CategoryGroup
        category="other"
        items={[makeItem({ id: 1 })]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Annet', level: 3 })).toBeInTheDocument();

    rerender(
      <CategoryGroup
        category="dairy"
        items={[makeItem({ id: 1 })]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Meieri', level: 3 })).toBeInTheDocument();
  });

  test('passes through unknown category strings unchanged (seed-data compat)', () => {
    render(
      <CategoryGroup
        category="Frukt & grønt"
        items={[makeItem({ id: 1 })]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Frukt & grønt', level: 3 })).toBeInTheDocument();
  });

  test('skips bought items in remaining-price total', () => {
    const { container } = render(
      <CategoryGroup
        category="Meieri"
        items={[
          makeItem({ id: 1, estPrice: 25, checkedOff: false }),
          makeItem({ id: 2, estPrice: 30, checkedOff: true }),
        ]}
        onToggle={() => {}}
        onDelete={() => {}}
      />
    );
    // Category-header total = 25 (only un-bought). Per-item prices show 25 + 30
    // (struck through for bought). The header total is the first "kr" text in
    // the rendered output.
    const header = container.querySelector('header');
    expect(header?.textContent).toContain('25 kr');
    expect(header?.textContent).not.toContain('55 kr');
  });
});

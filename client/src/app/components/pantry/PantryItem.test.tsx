// Tests for PantryItem — covers defensive null-handling, progress-bar
// derivation, and action-button wiring.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n/config';
import { PantryItem } from './PantryItem';
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

function renderItem(over: Partial<PantryItemType>) {
  const onMarkUsed = vi.fn();
  const onDelete = vi.fn();
  const item = makeItem(over);
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ul>
        <PantryItem item={item} onMarkUsed={onMarkUsed} onDelete={onDelete} />
      </ul>
    </I18nextProvider>
  );
  return { ...utils, onMarkUsed, onDelete, item };
}

describe('PantryItem — rendering', () => {
  test('shows name', () => {
    renderItem({ name: 'Mel' });
    expect(screen.getByText('Mel')).toBeInTheDocument();
  });

  test('shows remaining/total/unit when all are present', () => {
    renderItem({ quantity: 0.5, total: 1, unit: 'l', name: 'Melk' });
    expect(screen.getByTestId('pantry-quantity').textContent).toMatch(/0,5.*1.*l/);
  });

  test('falls back to remainingNoTotal when total is null', () => {
    renderItem({ quantity: 2, total: null, unit: 'stk' });
    expect(screen.getByTestId('pantry-quantity').textContent).toMatch(/2.*stk/);
  });

  test('falls back to remainingNoUnit when unit is empty', () => {
    renderItem({ quantity: 3, total: null, unit: '' });
    expect(screen.getByTestId('pantry-quantity').textContent).toContain('3');
    expect(screen.getByTestId('pantry-quantity').textContent).toContain('igjen');
  });

  test('shows progress bar when total is known', () => {
    renderItem({ quantity: 0.5, total: 1 });
    const bar = screen.getByTestId('pantry-progress');
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });

  test('hides progress bar when total is null', () => {
    renderItem({ quantity: 2, total: null });
    expect(screen.queryByTestId('pantry-progress')).toBeNull();
  });

  test('caps progress bar at 100% when remaining > total (edge case)', () => {
    renderItem({ quantity: 5, total: 1 });
    const bar = screen.getByTestId('pantry-progress');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  test('shows low-stock badge when isLow is true', () => {
    renderItem({ isLow: true, ratio: 0.1 });
    expect(screen.getByTestId('pantry-low-badge')).toBeInTheDocument();
  });

  test('hides low-stock badge when isLow is false', () => {
    renderItem({ isLow: false, ratio: 0.5 });
    expect(screen.queryByTestId('pantry-low-badge')).toBeNull();
  });
});

describe('PantryItem — progress-bar tone', () => {
  test('uses coral for ratio < 0.20', () => {
    renderItem({ quantity: 0.1, total: 1, ratio: 0.1 });
    const fill = screen.getByTestId('pantry-progress').querySelector('div');
    expect(fill?.className).toContain('bg-coral');
  });

  test('uses amber for ratio in [0.20, 0.40)', () => {
    renderItem({ quantity: 0.3, total: 1, ratio: 0.3 });
    const fill = screen.getByTestId('pantry-progress').querySelector('div');
    expect(fill?.className).toContain('bg-amber');
  });

  test('uses mint for ratio >= 0.40', () => {
    renderItem({ quantity: 0.5, total: 1, ratio: 0.5 });
    const fill = screen.getByTestId('pantry-progress').querySelector('div');
    expect(fill?.className).toContain('bg-mint');
  });
});

describe('PantryItem — actions', () => {
  test('calls onMarkUsed with item when mark-used pressed', () => {
    const { onMarkUsed, item } = renderItem({});
    fireEvent.click(screen.getByTestId('pantry-mark-used'));
    expect(onMarkUsed).toHaveBeenCalledWith(item);
  });

  test('calls onDelete with productKey when delete pressed', () => {
    const { onDelete } = renderItem({ productKey: 'melk' });
    fireEvent.click(screen.getByTestId('pantry-delete'));
    expect(onDelete).toHaveBeenCalledWith('melk');
  });

  test('mark-used button has accessible label with item name', () => {
    renderItem({ name: 'Smør' });
    const btn = screen.getByTestId('pantry-mark-used');
    expect(btn.getAttribute('aria-label')).toContain('Smør');
  });

  test('delete button has accessible label with item name', () => {
    renderItem({ name: 'Smør' });
    const btn = screen.getByTestId('pantry-delete');
    expect(btn.getAttribute('aria-label')).toContain('Smør');
  });
});

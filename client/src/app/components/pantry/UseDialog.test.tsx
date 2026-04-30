// Tests for UseDialog — covers quick-buttons, validation, submit
// wiring, cancel behaviour, and reset on item change.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n/config';
import { UseDialog } from './UseDialog';
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

function renderDialog(item: PantryItemType | null) {
  const onClose = vi.fn();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <UseDialog item={item} onClose={onClose} onConfirm={onConfirm} />
    </I18nextProvider>
  );
  return { ...utils, onClose, onConfirm };
}

describe('UseDialog — visibility', () => {
  test('does not render the form when item is null', () => {
    renderDialog(null);
    expect(screen.queryByTestId('use-dialog-input')).toBeNull();
  });

  test('renders form fields when item is provided', () => {
    renderDialog(makeItem({ quantity: 1 }));
    expect(screen.getByTestId('use-dialog-input')).toBeInTheDocument();
    expect(screen.getByTestId('use-dialog-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('use-dialog-cancel')).toBeInTheDocument();
  });

  test('shows item name and remaining in description', () => {
    renderDialog(makeItem({ name: 'Smør', quantity: 0.5, unit: 'pk' }));
    // The subtitle paragraph contains both name and unit; assert the
    // rendered text directly to avoid matching the amount label that
    // also includes the unit in parentheses.
    const subtitle = screen.getByText(/Smør.*0,5.*pk/);
    expect(subtitle).toBeInTheDocument();
  });
});

describe('UseDialog — quick-buttons', () => {
  test('Alt sets input to remaining', () => {
    renderDialog(makeItem({ quantity: 1 }));
    fireEvent.click(screen.getByTestId('use-dialog-all'));
    expect((screen.getByTestId('use-dialog-input') as HTMLInputElement).value).toBe('1');
  });

  test('1/2 sets input to half of remaining', () => {
    renderDialog(makeItem({ quantity: 2 }));
    fireEvent.click(screen.getByTestId('use-dialog-half'));
    expect((screen.getByTestId('use-dialog-input') as HTMLInputElement).value).toBe('1');
  });

  test('1/4 sets input to quarter of remaining', () => {
    renderDialog(makeItem({ quantity: 4 }));
    fireEvent.click(screen.getByTestId('use-dialog-quarter'));
    expect((screen.getByTestId('use-dialog-input') as HTMLInputElement).value).toBe('1');
  });

  test('1/4 rounds to one decimal', () => {
    renderDialog(makeItem({ quantity: 1 }));
    fireEvent.click(screen.getByTestId('use-dialog-quarter'));
    // 1/4 = 0.25 → rounded to 0.3 (Norwegian decimal display)
    expect((screen.getByTestId('use-dialog-input') as HTMLInputElement).value).toBe('0,3');
  });
});

describe('UseDialog — validation', () => {
  test('blocks submit when amount > remaining', () => {
    renderDialog(makeItem({ quantity: 1, unit: 'l' }));
    fireEvent.change(screen.getByTestId('use-dialog-input'), { target: { value: '2' } });
    expect(screen.getByTestId('use-dialog-validation')).toBeInTheDocument();
    expect((screen.getByTestId('use-dialog-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  test('blocks submit when amount is 0 or negative', () => {
    renderDialog(makeItem({ quantity: 1 }));
    fireEvent.change(screen.getByTestId('use-dialog-input'), { target: { value: '0' } });
    expect((screen.getByTestId('use-dialog-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  test('blocks submit when input is non-numeric', () => {
    renderDialog(makeItem({ quantity: 1 }));
    fireEvent.change(screen.getByTestId('use-dialog-input'), { target: { value: 'abc' } });
    expect((screen.getByTestId('use-dialog-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  test('accepts comma decimal separator', () => {
    renderDialog(makeItem({ quantity: 2 }));
    fireEvent.change(screen.getByTestId('use-dialog-input'), { target: { value: '0,5' } });
    expect(screen.queryByTestId('use-dialog-validation')).toBeNull();
    expect((screen.getByTestId('use-dialog-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  test('shows validation message with unit when present', () => {
    renderDialog(makeItem({ quantity: 1, unit: 'l' }));
    fireEvent.change(screen.getByTestId('use-dialog-input'), { target: { value: '5' } });
    expect(screen.getByTestId('use-dialog-validation').textContent).toMatch(/l/);
  });
});

describe('UseDialog — submit', () => {
  test('calls onConfirm with item and amount on submit', async () => {
    const item = makeItem({ quantity: 2, productKey: 'melk' });
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nextProvider i18n={i18n}>
        <UseDialog item={item} onClose={onClose} onConfirm={onConfirm} />
      </I18nextProvider>
    );
    fireEvent.change(screen.getByTestId('use-dialog-input'), { target: { value: '0,5' } });
    fireEvent.click(screen.getByTestId('use-dialog-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalledWith(item, 0.5);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('calls onClose when cancel pressed', () => {
    const item = makeItem({ quantity: 1 });
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <UseDialog item={item} onClose={onClose} onConfirm={onConfirm} />
      </I18nextProvider>
    );
    fireEvent.click(screen.getByTestId('use-dialog-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('UseDialog — reset on item change', () => {
  test('resets input to new item remaining when item changes', () => {
    const first = makeItem({ productKey: 'melk', quantity: 1 });
    const second = makeItem({ productKey: 'pasta', quantity: 5 });
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <UseDialog item={first} onClose={vi.fn()} onConfirm={vi.fn()} />
      </I18nextProvider>
    );
    expect((screen.getByTestId('use-dialog-input') as HTMLInputElement).value).toBe('1');

    rerender(
      <I18nextProvider i18n={i18n}>
        <UseDialog item={second} onClose={vi.fn()} onConfirm={vi.fn()} />
      </I18nextProvider>
    );
    expect((screen.getByTestId('use-dialog-input') as HTMLInputElement).value).toBe('5');
  });
});

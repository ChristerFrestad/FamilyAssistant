// Tests for QuickAddPantry — covers validation, submit wiring, and
// reset on success.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n/config';
import { QuickAddPantry } from './QuickAddPantry';

function renderInput(onAdd = vi.fn().mockResolvedValue({ productKey: 'melk' })) {
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <QuickAddPantry onAdd={onAdd} />
    </I18nextProvider>
  );
  return { ...utils, onAdd };
}

describe('QuickAddPantry — validation', () => {
  test('disables submit when name is empty', () => {
    renderInput();
    const submit = screen.getByTestId('pantry-quick-add-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  test('enables submit when name has content', () => {
    renderInput();
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'melk' } });
    expect((screen.getByTestId('pantry-quick-add-submit') as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  test('disables submit when qty is non-positive', () => {
    renderInput();
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'melk' } });
    fireEvent.change(screen.getByTestId('pantry-quick-add-qty'), { target: { value: '0' } });
    expect((screen.getByTestId('pantry-quick-add-submit') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  test('disables submit when qty is non-numeric', () => {
    renderInput();
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'melk' } });
    fireEvent.change(screen.getByTestId('pantry-quick-add-qty'), { target: { value: 'abc' } });
    expect((screen.getByTestId('pantry-quick-add-submit') as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});

describe('QuickAddPantry — submit', () => {
  test('passes name + qty to onAdd', async () => {
    const { onAdd } = renderInput();
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'melk' } });
    fireEvent.change(screen.getByTestId('pantry-quick-add-qty'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('pantry-quick-add-submit'));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith({ query: 'melk', qty: 2 });
  });

  test('passes unit when provided', async () => {
    const { onAdd } = renderInput();
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'melk' } });
    fireEvent.change(screen.getByTestId('pantry-quick-add-qty'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('pantry-quick-add-unit'), { target: { value: 'l' } });
    fireEvent.click(screen.getByTestId('pantry-quick-add-submit'));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith({ query: 'melk', qty: 1, unit: 'l' });
  });

  test('accepts comma-separated qty', async () => {
    const { onAdd } = renderInput();
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'melk' } });
    fireEvent.change(screen.getByTestId('pantry-quick-add-qty'), { target: { value: '0,5' } });
    fireEvent.click(screen.getByTestId('pantry-quick-add-submit'));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith({ query: 'melk', qty: 0.5 });
  });

  test('resets inputs on success', async () => {
    const { onAdd } = renderInput();
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'melk' } });
    fireEvent.change(screen.getByTestId('pantry-quick-add-qty'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('pantry-quick-add-submit'));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    await waitFor(() => {
      expect((screen.getByTestId('pantry-quick-add-name') as HTMLInputElement).value).toBe('');
    });
    expect((screen.getByTestId('pantry-quick-add-qty') as HTMLInputElement).value).toBe('1');
  });

  test('keeps inputs when submission rejects', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <I18nextProvider i18n={i18n}>
        <QuickAddPantry onAdd={onAdd} />
      </I18nextProvider>
    );
    fireEvent.change(screen.getByTestId('pantry-quick-add-name'), { target: { value: 'melk' } });
    fireEvent.click(screen.getByTestId('pantry-quick-add-submit'));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    // The promise rejected; submit handler should have surfaced — name kept
    await waitFor(() => {
      expect((screen.getByTestId('pantry-quick-add-name') as HTMLInputElement).value).toBe('melk');
    });
  });
});

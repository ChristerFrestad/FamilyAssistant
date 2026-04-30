// Tests for QuickAddInput.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, describe, vi } from 'vitest';
import { QuickAddInput } from './QuickAddInput';

describe('QuickAddInput', () => {
  test('renders input + submit button', () => {
    render(<QuickAddInput onAdd={async () => 1} enabled={true} />);
    expect(screen.getByPlaceholderText('Hva trenger du?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Legg til' })).toBeInTheDocument();
  });

  test('submit button is disabled when input is empty', () => {
    render(<QuickAddInput onAdd={async () => 1} enabled={true} />);
    expect(screen.getByRole('button', { name: 'Legg til' })).toBeDisabled();
  });

  test('submit button enables when input has text', async () => {
    render(<QuickAddInput onAdd={async () => 1} enabled={true} />);
    await userEvent.type(screen.getByPlaceholderText('Hva trenger du?'), 'melk');
    expect(screen.getByRole('button', { name: 'Legg til' })).toBeEnabled();
  });

  test('calls onAdd with trimmed value on submit', async () => {
    const onAdd = vi.fn().mockResolvedValue(99);
    render(<QuickAddInput onAdd={onAdd} enabled={true} />);
    await userEvent.type(screen.getByPlaceholderText('Hva trenger du?'), '  melk  ');
    await userEvent.click(screen.getByRole('button', { name: 'Legg til' }));
    expect(onAdd).toHaveBeenCalledWith('melk');
  });

  test('clears input on successful add', async () => {
    const onAdd = vi.fn().mockResolvedValue(99);
    render(<QuickAddInput onAdd={onAdd} enabled={true} />);
    const input = screen.getByPlaceholderText('Hva trenger du?') as HTMLInputElement;
    await userEvent.type(input, 'melk');
    await userEvent.click(screen.getByRole('button', { name: 'Legg til' }));
    expect(input.value).toBe('');
  });

  test('keeps input value on failed add (returns null)', async () => {
    const onAdd = vi.fn().mockResolvedValue(null);
    render(<QuickAddInput onAdd={onAdd} enabled={true} />);
    const input = screen.getByPlaceholderText('Hva trenger du?') as HTMLInputElement;
    await userEvent.type(input, 'melk');
    await userEvent.click(screen.getByRole('button', { name: 'Legg til' }));
    expect(input.value).toBe('melk');
  });

  test('disabled state disables input + button + shows hint', () => {
    render(
      <QuickAddInput
        onAdd={async () => 1}
        enabled={false}
        disabledHint="Generer en handleliste først"
      />
    );
    expect(screen.getByPlaceholderText('Hva trenger du?')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Legg til' })).toBeDisabled();
    expect(screen.getByText('Generer en handleliste først')).toBeInTheDocument();
  });

  test('Enter submits the form', async () => {
    const onAdd = vi.fn().mockResolvedValue(99);
    render(<QuickAddInput onAdd={onAdd} enabled={true} />);
    const input = screen.getByPlaceholderText('Hva trenger du?');
    await userEvent.type(input, 'melk{Enter}');
    expect(onAdd).toHaveBeenCalledWith('melk');
  });

  test('does not submit when input only has whitespace', async () => {
    const onAdd = vi.fn();
    render(<QuickAddInput onAdd={onAdd} enabled={true} />);
    const input = screen.getByPlaceholderText('Hva trenger du?');
    await userEvent.type(input, '   {Enter}');
    expect(onAdd).not.toHaveBeenCalled();
  });
});

// Tests for DeleteAccountButton — verifies confirm-dialog gating,
// owner-blocked state, success-callback wiring, and concurrency guard.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { DeleteAccountButton } from './DeleteAccountButton';

const baseProps = {
  label: 'Slett konto',
  confirmText: 'Du har 30 dager på å angre.',
};

describe('DeleteAccountButton — confirm gate', () => {
  test('does NOT call onDelete when user cancels the confirm dialog', () => {
    const onDelete = vi.fn().mockResolvedValue({ ok: true });
    const onSuccess = vi.fn();
    render(
      <DeleteAccountButton
        {...baseProps}
        onDelete={onDelete}
        onSuccess={onSuccess}
        confirmFn={() => false}
      />
    );
    fireEvent.click(screen.getByTestId('settings-delete-button'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test('calls onDelete + onSuccess when user confirms', async () => {
    const response = { ok: true as const, hardDeleteAt: '2026-05-31', graceDays: 30 };
    const onDelete = vi.fn().mockResolvedValue(response);
    const onSuccess = vi.fn();
    render(
      <DeleteAccountButton
        {...baseProps}
        onDelete={onDelete}
        onSuccess={onSuccess}
        confirmFn={() => true}
      />
    );
    fireEvent.click(screen.getByTestId('settings-delete-button'));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(response));
  });

  test('does NOT call onSuccess when onDelete returns null', async () => {
    const onDelete = vi.fn().mockResolvedValue(null);
    const onSuccess = vi.fn();
    render(
      <DeleteAccountButton
        {...baseProps}
        onDelete={onDelete}
        onSuccess={onSuccess}
        confirmFn={() => true}
      />
    );
    fireEvent.click(screen.getByTestId('settings-delete-button'));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('DeleteAccountButton — owner blocking', () => {
  test('disables button when ownerBlocked is true', () => {
    const onDelete = vi.fn();
    render(
      <DeleteAccountButton
        {...baseProps}
        onDelete={onDelete}
        onSuccess={vi.fn()}
        ownerBlocked
        ownerBlockedHint="Du må overføre eierskap først"
        confirmFn={() => true}
      />
    );
    const btn = screen.getByTestId('settings-delete-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test('renders ownerBlockedHint when ownerBlocked is true', () => {
    render(
      <DeleteAccountButton
        {...baseProps}
        onDelete={vi.fn()}
        onSuccess={vi.fn()}
        ownerBlocked
        ownerBlockedHint="Du må overføre eierskap først"
      />
    );
    expect(screen.getByTestId('settings-delete-owner-hint').textContent).toContain(
      'Du må overføre eierskap først'
    );
  });

  test('does NOT call onDelete when ownerBlocked even if user clicks', () => {
    const onDelete = vi.fn();
    render(
      <DeleteAccountButton
        {...baseProps}
        onDelete={onDelete}
        onSuccess={vi.fn()}
        ownerBlocked
        confirmFn={() => true}
      />
    );
    fireEvent.click(screen.getByTestId('settings-delete-button'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  test('hides ownerBlockedHint when not ownerBlocked', () => {
    render(
      <DeleteAccountButton
        {...baseProps}
        onDelete={vi.fn()}
        onSuccess={vi.fn()}
        ownerBlockedHint="Du må overføre eierskap først"
      />
    );
    expect(screen.queryByTestId('settings-delete-owner-hint')).toBeNull();
  });
});

describe('DeleteAccountButton — concurrency guard', () => {
  test('blocks repeat clicks while delete is in flight', () => {
    let resolveDelete: (v: unknown) => void = () => {};
    const onDelete = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        })
    );
    render(
      <DeleteAccountButton
        {...baseProps}
        onDelete={onDelete}
        onSuccess={vi.fn()}
        confirmFn={() => true}
      />
    );
    fireEvent.click(screen.getByTestId('settings-delete-button'));
    fireEvent.click(screen.getByTestId('settings-delete-button'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    resolveDelete({ ok: true, hardDeleteAt: 'x', graceDays: 30 });
  });
});

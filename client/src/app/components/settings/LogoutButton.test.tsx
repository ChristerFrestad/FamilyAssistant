// Tests for LogoutButton — verifies confirm-flow, busy state, and
// happy-path / cancel-path / error-path behavior.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { LogoutButton } from './LogoutButton';

describe('LogoutButton — render', () => {
  test('renders with given label', () => {
    render(
      <LogoutButton
        onLogout={vi.fn()}
        label="Logg ut"
        confirmText="Vil du logge ut?"
        confirmFn={() => false}
      />
    );
    expect(screen.getByTestId('settings-logout-button').textContent).toContain('Logg ut');
  });
});

describe('LogoutButton — confirm flow', () => {
  test('calls onLogout when confirmed', async () => {
    const onLogout = vi.fn(async () => {});
    render(
      <LogoutButton
        onLogout={onLogout}
        label="Logg ut"
        confirmText="Vil du logge ut?"
        confirmFn={() => true}
      />
    );
    await userEvent.click(screen.getByTestId('settings-logout-button'));
    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  test('does NOT call onLogout when cancelled', async () => {
    const onLogout = vi.fn(async () => {});
    render(
      <LogoutButton
        onLogout={onLogout}
        label="Logg ut"
        confirmText="Vil du logge ut?"
        confirmFn={() => false}
      />
    );
    await userEvent.click(screen.getByTestId('settings-logout-button'));
    expect(onLogout).not.toHaveBeenCalled();
  });

  test('passes confirmText into confirmFn', async () => {
    const confirmFn = vi.fn(() => false);
    render(
      <LogoutButton
        onLogout={vi.fn()}
        label="Logg ut"
        confirmText="Vil du logge ut?"
        confirmFn={confirmFn}
      />
    );
    await userEvent.click(screen.getByTestId('settings-logout-button'));
    expect(confirmFn).toHaveBeenCalledWith('Vil du logge ut?');
  });
});

describe('LogoutButton — busy state', () => {
  test('disables button while logout is in flight', async () => {
    let resolve: () => void = () => {};
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    render(
      <LogoutButton
        onLogout={() => pending}
        label="Logg ut"
        confirmText="Vil du logge ut?"
        confirmFn={() => true}
      />
    );
    const btn = screen.getByTestId('settings-logout-button');
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    resolve();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  test('does not double-fire when clicked twice in quick succession', async () => {
    let resolve: () => void = () => {};
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    const onLogout = vi.fn(() => pending);
    render(
      <LogoutButton
        onLogout={onLogout}
        label="Logg ut"
        confirmText="Vil du logge ut?"
        confirmFn={() => true}
      />
    );
    const btn = screen.getByTestId('settings-logout-button');
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(onLogout).toHaveBeenCalledTimes(1);
    resolve();
  });
});

describe('LogoutButton — error path', () => {
  test('drops busy state when onLogout throws (no crash)', async () => {
    const onLogout = vi.fn(async () => {
      throw new Error('boom');
    });
    render(
      <LogoutButton
        onLogout={onLogout}
        label="Logg ut"
        confirmText="Vil du logge ut?"
        confirmFn={() => true}
      />
    );
    const btn = screen.getByTestId('settings-logout-button');
    await userEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

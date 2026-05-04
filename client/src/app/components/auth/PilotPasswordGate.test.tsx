// Tests for PilotPasswordGate.
//
// Mocks the pilotApi.submitPilotPassword function to assert the gate's
// reaction to each backend response shape (ok, wrong_password,
// rate_limited, pilot_disabled, network_error).

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { PilotPasswordGate } from './PilotPasswordGate';
import * as pilotApi from '../../auth/pilotApi';

describe('PilotPasswordGate — render', () => {
  test('renders title, input, submit', () => {
    render(<PilotPasswordGate onAuthenticated={vi.fn()} />);
    expect(screen.getByTestId('pilot-password-gate')).toBeInTheDocument();
    expect(screen.getByTestId('pilot-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('pilot-password-submit')).toBeInTheDocument();
  });
});

describe('PilotPasswordGate — submission flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('correct password fires onAuthenticated', async () => {
    vi.spyOn(pilotApi, 'submitPilotPassword').mockResolvedValue({ ok: true });
    const onAuth = vi.fn();
    render(<PilotPasswordGate onAuthenticated={onAuth} />);
    await userEvent.type(screen.getByTestId('pilot-password-input'), 'right-password');
    await userEvent.click(screen.getByTestId('pilot-password-submit'));
    await waitFor(() => expect(onAuth).toHaveBeenCalledTimes(1));
  });

  test('wrong password shows attemptsRemaining error and clears input', async () => {
    vi.spyOn(pilotApi, 'submitPilotPassword').mockResolvedValue({
      ok: false,
      code: 'wrong_password',
      attemptsRemaining: 3,
    });
    render(<PilotPasswordGate onAuthenticated={vi.fn()} />);
    const input = screen.getByTestId('pilot-password-input') as HTMLInputElement;
    await userEvent.type(input, 'wrong');
    await userEvent.click(screen.getByTestId('pilot-password-submit'));
    await waitFor(() => expect(screen.getByTestId('pilot-password-error')).toBeInTheDocument());
    expect(screen.getByTestId('pilot-password-error').textContent).toMatch(/3/);
    expect(input.value).toBe('');
  });

  test('rate-limited locks input and submit button', async () => {
    vi.spyOn(pilotApi, 'submitPilotPassword').mockResolvedValue({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 600,
    });
    render(<PilotPasswordGate onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByTestId('pilot-password-input'), 'wrong');
    await userEvent.click(screen.getByTestId('pilot-password-submit'));
    await waitFor(() => expect(screen.getByTestId('pilot-password-error')).toBeInTheDocument());
    expect(screen.getByTestId('pilot-password-input')).toBeDisabled();
    expect(screen.getByTestId('pilot-password-submit')).toBeDisabled();
  });

  test('attemptsRemaining=0 also locks the form', async () => {
    vi.spyOn(pilotApi, 'submitPilotPassword').mockResolvedValue({
      ok: false,
      code: 'wrong_password',
      attemptsRemaining: 0,
    });
    render(<PilotPasswordGate onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByTestId('pilot-password-input'), 'wrong');
    await userEvent.click(screen.getByTestId('pilot-password-submit'));
    await waitFor(() => expect(screen.getByTestId('pilot-password-input')).toBeDisabled());
  });

  test('pilot_disabled passes through (treats as authenticated)', async () => {
    vi.spyOn(pilotApi, 'submitPilotPassword').mockResolvedValue({
      ok: false,
      code: 'pilot_disabled',
    });
    const onAuth = vi.fn();
    render(<PilotPasswordGate onAuthenticated={onAuth} />);
    await userEvent.type(screen.getByTestId('pilot-password-input'), 'anything');
    await userEvent.click(screen.getByTestId('pilot-password-submit'));
    await waitFor(() => expect(onAuth).toHaveBeenCalled());
  });

  test('network_error shows a generic error and keeps form usable', async () => {
    vi.spyOn(pilotApi, 'submitPilotPassword').mockResolvedValue({
      ok: false,
      code: 'network_error',
    });
    render(<PilotPasswordGate onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByTestId('pilot-password-input'), 'whatever');
    await userEvent.click(screen.getByTestId('pilot-password-submit'));
    await waitFor(() => expect(screen.getByTestId('pilot-password-error')).toBeInTheDocument());
    expect(screen.getByTestId('pilot-password-input')).not.toBeDisabled();
  });
});

// Tests for the CopyButton form-control. Exercises both the
// happy-path (clipboard.writeText resolves) and the failure-path
// (it rejects), the cooldown-label-swap behavior, the
// click-during-cooldown timer-reset behavior, and the unmount
// cleanup so the reset timer never fires after the component is
// gone.
//
// We use fireEvent.click rather than userEvent.click because:
//   - userEvent v14 internally schedules between-action setTimeouts
//     that hang under vi.useFakeTimers, even with the
//     `advanceTimers` setup option in this codebase
//   - we still need fake timers to test the duration-based label
//     reset, and CopyButton's click handler is a single
//     fire-and-forget — fireEvent + waitFor for the async result
//     is the cleanest combination
//
// Clipboard mocking: jsdom does not implement navigator.clipboard.
// Object.assign installs a mock that the component picks up at
// click-time. afterEach deletes it so each test starts clean.

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { CopyButton } from './CopyButton';

let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  // Object.assign sidesteps the property-descriptor strictness that
  // bites Object.defineProperty when the prototype chain already
  // declares `clipboard`. The component reads navigator.clipboard
  // at click-time, so an own-property mock wins regardless of any
  // inherited shape.
  Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
});

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
});

test('renders the default "Kopier" label initially', () => {
  render(<CopyButton value="hello" />);
  expect(screen.getByRole('button', { name: 'Kopier' })).toBeInTheDocument();
});

test('clicking calls navigator.clipboard.writeText with the value', async () => {
  render(<CopyButton value="SESSION_SECRET_xxx" />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(writeTextMock).toHaveBeenCalledWith('SESSION_SECRET_xxx');
  });
});

test('label flips to copiedLabel after a successful copy', async () => {
  render(<CopyButton value="hello" />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Kopiert!' })).toBeInTheDocument();
  });
});

test('label resets to "Kopier" after the duration elapses', async () => {
  vi.useFakeTimers();
  try {
    render(<CopyButton value="hello" duration={2000} />);
    fireEvent.click(screen.getByRole('button'));
    // Allow the awaited clipboard promise to resolve so setCopied(true)
    // commits before we advance the timer. We have to switch back to
    // real timers briefly because awaiting a microtask under fake
    // timers does not flush by itself.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Kopiert!' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Kopier' })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('onCopySuccess fires after a successful copy', async () => {
  const onSuccess = vi.fn();
  render(<CopyButton value="hello" onCopySuccess={onSuccess} />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

test('onCopyError fires when clipboard.writeText rejects', async () => {
  const onError = vi.fn();
  const failure = new Error('Permission denied');
  writeTextMock.mockRejectedValueOnce(failure);
  render(<CopyButton value="hello" onCopyError={onError} />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(onError).toHaveBeenCalledTimes(1);
  });
  expect(onError).toHaveBeenCalledWith(failure);
  // The label must NOT flip to "Kopiert!" on failure — the user
  // would otherwise see false success feedback for an action that
  // did not actually happen.
  expect(screen.getByRole('button', { name: 'Kopier' })).toBeInTheDocument();
});

test('clicking during cooldown extends the cooldown rather than resetting early', async () => {
  vi.useFakeTimers();
  try {
    render(<CopyButton value="hello" duration={2000} />);
    const btn = screen.getByRole('button');

    // Click 1 at t=0 — copied=true, timer set to fire at t=2000.
    fireEvent.click(btn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(btn).toHaveTextContent('Kopiert!');

    // Advance to t=1000 — still in cooldown.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(btn).toHaveTextContent('Kopiert!');

    // Click 2 at t=1000 — pending timer cleared, new timer set to
    // fire at t=3000 (1000 + 2000).
    fireEvent.click(btn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(btn).toHaveTextContent('Kopiert!');

    // Advance to t=2100. Without the click-2 reset, the original
    // timer would have fired at t=2000 and the label would now
    // read "Kopier". With the reset, we are 1100 ms into the new
    // cooldown and the label still reads "Kopiert!".
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(btn).toHaveTextContent('Kopiert!');

    // Advance to t=3100 — past the new timer (t=3000). Label resets.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(btn).toHaveTextContent('Kopier');
  } finally {
    vi.useRealTimers();
  }
});

test('reset timer is cleaned up on unmount', async () => {
  vi.useFakeTimers();
  const clearTimeoutSpy: MockInstance = vi.spyOn(globalThis, 'clearTimeout');
  try {
    const { unmount } = render(<CopyButton value="hello" duration={5000} />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // After click the timer is pending — exactly one of vitest's
    // tracked timers is alive.
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    // The cleanup useEffect should have called clearTimeout.
    expect(vi.getTimerCount()).toBe(0);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  } finally {
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  }
});

test('custom labels and duration are respected', async () => {
  vi.useFakeTimers();
  try {
    render(<CopyButton value="x" label="Hent" copiedLabel="Hentet ✓" duration={500} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hent' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Hentet ✓' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('button', { name: 'Hent' })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

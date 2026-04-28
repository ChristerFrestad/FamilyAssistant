// Tests for Modal. Covers the controlled open/close lifecycle, the
// three close-paths (backdrop / Escape / X-button) plus their opt-out
// flags, the conditional header (title + description), the size and
// position branches, and the side-effects on document.body (scroll-
// lock, focus restoration).
//
// We use fireEvent rather than userEvent because:
//   - keydown handlers are registered on `document`, and userEvent
//     v14 dispatches keys via the focused element which is a child
//     of the dialog — bubbling reaches document but the userEvent
//     setup adds enough scheduler glue that it conflicts with the
//     fake-timer-driven tests for scroll-lock and focus-restore.
//   - clicks on the backdrop need to land on the backdrop element
//     specifically (the inner dialog stops propagation only via
//     the target/currentTarget check), and fireEvent.click on a
//     specific element is the cleanest way to express that.
//
// Animation timing: the component flips its internal isOpen state
// inside a requestAnimationFrame on mount, which under jsdom resolves
// via a microtask. `act(() => Promise.resolve())` flushes the rAF
// callback and the resulting state update so the entrance-animation
// classes settle before assertions run.

import { render, screen, fireEvent, act } from '@testing-library/react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { Modal } from './Modal';

// document.body.style.overflow leaks across tests if a prior test
// fails before the cleanup useEffect gets a chance to restore the
// previous value. Resetting in beforeEach makes failures isolated.
beforeEach(() => {
  document.body.style.overflow = '';
});

afterEach(() => {
  document.body.style.overflow = '';
});

test('renders into document.body via portal when open=true', () => {
  render(
    <Modal open={true} onClose={() => undefined}>
      <p>Body content</p>
    </Modal>
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toBeInTheDocument();
  // The portal target is document.body — confirm the dialog is a
  // descendant of body (rather than nested inside the test renderer
  // container).
  expect(document.body.contains(dialog)).toBe(true);
});

test('renders nothing when open=false and never opened before', () => {
  render(
    <Modal open={false} onClose={() => undefined}>
      <p>Hidden</p>
    </Modal>
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('clicking the backdrop calls onClose by default', () => {
  const onClose = vi.fn();
  render(
    <Modal open={true} onClose={onClose}>
      <p>Body</p>
    </Modal>
  );
  fireEvent.click(screen.getByTestId('modal-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('closeOnBackdrop=false ignores backdrop clicks', () => {
  const onClose = vi.fn();
  render(
    <Modal open={true} onClose={onClose} closeOnBackdrop={false}>
      <p>Body</p>
    </Modal>
  );
  fireEvent.click(screen.getByTestId('modal-backdrop'));
  expect(onClose).not.toHaveBeenCalled();
});

test('clicking inside the dialog does not call onClose', () => {
  const onClose = vi.fn();
  render(
    <Modal open={true} onClose={onClose}>
      <p>Body</p>
    </Modal>
  );
  // The dialog stops the click via the target/currentTarget check on
  // the backdrop. Clicking the inner content should be inert.
  fireEvent.click(screen.getByText('Body'));
  expect(onClose).not.toHaveBeenCalled();
});

test('Escape key calls onClose by default', async () => {
  const onClose = vi.fn();
  render(
    <Modal open={true} onClose={onClose}>
      <p>Body</p>
    </Modal>
  );
  // Wait for the rAF tick that flips isOpen=true so the keydown
  // listener is wired up.
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('closeOnEscape=false ignores Escape', async () => {
  const onClose = vi.fn();
  render(
    <Modal open={true} onClose={onClose} closeOnEscape={false}>
      <p>Body</p>
    </Modal>
  );
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
});

test('close button is shown by default and calls onClose', () => {
  const onClose = vi.fn();
  render(
    <Modal open={true} onClose={onClose}>
      <p>Body</p>
    </Modal>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lukk' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('showCloseButton=false hides the X button', () => {
  render(
    <Modal open={true} onClose={() => undefined} showCloseButton={false}>
      <p>Body</p>
    </Modal>
  );
  expect(screen.queryByRole('button', { name: 'Lukk' })).not.toBeInTheDocument();
});

test('renders title and description and wires aria-labelledby/describedby', () => {
  render(
    <Modal open={true} onClose={() => undefined} title="Settings" description="Tweak the app">
      <p>Body</p>
    </Modal>
  );
  const heading = screen.getByRole('heading', { name: 'Settings' });
  const description = screen.getByText('Tweak the app');
  const dialog = screen.getByRole('dialog');
  // The dialog's aria attributes should point at the actual elements,
  // not just be set to arbitrary truthy strings.
  expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
  expect(dialog.getAttribute('aria-describedby')).toBe(description.id);
});

test('position=center applies center container classes', () => {
  render(
    <Modal open={true} onClose={() => undefined}>
      <p>Body</p>
    </Modal>
  );
  expect(screen.getByTestId('modal-backdrop').className).toContain('items-center');
});

test('position=bottom applies bottom container classes', () => {
  render(
    <Modal open={true} onClose={() => undefined} position="bottom">
      <p>Body</p>
    </Modal>
  );
  const backdrop = screen.getByTestId('modal-backdrop');
  expect(backdrop.className).toContain('items-end');
  // Bottom-anchored sheets only round the top corners.
  expect(screen.getByRole('dialog').className).toContain('rounded-t-2xl');
});

test('size=lg applies the lg max-width and size=full applies full', () => {
  const { rerender } = render(
    <Modal open={true} onClose={() => undefined} size="lg">
      <p>Body</p>
    </Modal>
  );
  expect(screen.getByRole('dialog').className).toContain('max-w-lg');
  rerender(
    <Modal open={true} onClose={() => undefined} size="full">
      <p>Body</p>
    </Modal>
  );
  expect(screen.getByRole('dialog').className).toContain('max-w-2xl');
});

test('body scroll is locked while the modal is mounted', () => {
  render(
    <Modal open={true} onClose={() => undefined}>
      <p>Body</p>
    </Modal>
  );
  expect(document.body.style.overflow).toBe('hidden');
});

test('body scroll is restored after the exit animation completes', async () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(
      <Modal open={true} onClose={() => undefined}>
        <p>Body</p>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <Modal open={false} onClose={() => undefined}>
        <p>Body</p>
      </Modal>
    );
    // Through the exit animation the modal stays mounted and scroll
    // stays locked. Only after the 200 ms timeout flips shouldRender
    // does the cleanup useEffect restore the overflow value.
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => {
      vi.advanceTimersByTime(220);
    });
    expect(document.body.style.overflow).toBe('');
  } finally {
    vi.useRealTimers();
  }
});

test('focus returns to the trigger element when the modal closes', async () => {
  // A small wrapper that owns the open state so the test can drive
  // open/close transitions naturally and the trigger lives in the
  // same render tree as the modal.
  function Harness(): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button data-testid="trigger" type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Modal open={open} onClose={() => setOpen(false)}>
          <button data-testid="inside" type="button">
            Inside
          </button>
        </Modal>
      </>
    );
  }

  render(<Harness />);
  const trigger = screen.getByTestId('trigger');
  trigger.focus();
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);
  // Let the rAF tick + focus useEffect run.
  await act(async () => {
    await Promise.resolve();
  });
  // After opening, focus should have moved off the trigger and into
  // the dialog (the close button is the first focusable child).
  expect(document.activeElement).not.toBe(trigger);

  // Close via the X. The cleanup effect restores focus synchronously
  // before the exit animation finishes.
  fireEvent.click(screen.getByRole('button', { name: 'Lukk' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.activeElement).toBe(trigger);
});

test('Tab from the last focusable wraps to the first', () => {
  render(
    <Modal open={true} onClose={() => undefined}>
      <button data-testid="first">First</button>
      <button data-testid="second">Second</button>
    </Modal>
  );
  // The close button is always the first focusable inside the
  // dialog because it is rendered before children. The last
  // focusable is the second user-supplied button.
  const closeBtn = screen.getByRole('button', { name: 'Lukk' });
  const last = screen.getByTestId('second');
  last.focus();
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(closeBtn);
});

test('Shift+Tab from the first focusable wraps to the last', () => {
  render(
    <Modal open={true} onClose={() => undefined}>
      <button data-testid="first">First</button>
      <button data-testid="second">Second</button>
    </Modal>
  );
  const closeBtn = screen.getByRole('button', { name: 'Lukk' });
  const last = screen.getByTestId('second');
  closeBtn.focus();
  expect(document.activeElement).toBe(closeBtn);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
});

test('Tab in the middle of the focusable chain does not redirect focus', () => {
  // When focus is on a non-edge element, the trap handler runs but
  // takes neither branch — preventDefault is not called and the
  // browser would handle the Tab natively. We can't observe browser
  // Tab traversal in jsdom, but we can observe that activeElement
  // stays put (i.e. the handler did not steal focus to first or last).
  render(
    <Modal open={true} onClose={() => undefined}>
      <button data-testid="first">First</button>
      <button data-testid="middle">Middle</button>
      <button data-testid="last">Last</button>
    </Modal>
  );
  const middle = screen.getByTestId('middle');
  middle.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(middle);
});

test('removes event listeners on unmount', () => {
  const removeSpy = vi.spyOn(document, 'removeEventListener');
  const { unmount } = render(
    <Modal open={true} onClose={() => undefined}>
      <p>Body</p>
    </Modal>
  );
  unmount();
  // We register two `keydown` listeners (Escape + Tab-trap) — both
  // must be removed on unmount. The exact count is brittle because
  // React 18 strict mode can double-invoke effects, but the listener
  // type is stable.
  const keydownRemovals = removeSpy.mock.calls.filter(([event]) => event === 'keydown');
  expect(keydownRemovals.length).toBeGreaterThanOrEqual(2);
  removeSpy.mockRestore();
});

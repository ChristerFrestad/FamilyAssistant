// Modal / sheet overlay. One component covers two layouts:
//   - position="center" (default) — classic centered dialog used for
//                                   confirmations, settings, etc.
//   - position="bottom"            — bottom-sheet that slides up from
//                                    the viewport edge; right for
//                                    mobile-first flows where the
//                                    user's thumb already lives near
//                                    the bottom of the screen.
//
// Implementation choices (locked at start of Batch G):
//   - Custom <div role="dialog" aria-modal="true"> rather than the
//     native <dialog> element. Native ::backdrop styling is still
//     spotty across browsers, our glassmorphism + OKLCH tokens want
//     full control, and a sheet-position layout maps poorly onto the
//     native dialog model anyway. The cost is ~30 lines of manual
//     focus-trap and scroll-lock — acceptable.
//   - createPortal(content, document.body) — no dedicated portal-root
//     div. The dialog mounts as a direct child of <body> regardless
//     of where the JSX sits in the tree, which keeps z-index and
//     stacking-context predictable.
//   - Pure CSS animation via Tailwind transition utilities, gated by
//     an internal `isOpen` state that is flipped one rAF tick after
//     mount so the browser sees the "from" → "to" transition rather
//     than a single paint. Exit animation runs by setting isOpen
//     back to false; a 200 ms timeout then unmounts the portal. No
//     framer-motion or other animation library — keeps the bundle
//     dependency-free.
//
// Backdrop color note: `bg-black/40` is theme-agnostic on purpose.
// Our canvas tokens are full oklch() strings, which Tailwind cannot
// alpha-modify with the `/x` syntax — it only works on tokens
// expressed as r-g-b channel triplets. A theme-sensitive overlay
// (lighter dim in dark mode) would require a dedicated
// --backdrop-overlay token in tokens.css; deferred as a potential
// future polish, not a blocker for Batch G.
//
// Focus management:
//   - On open: capture document.activeElement as the trigger, then
//     focus the first focusable element inside the dialog (or the
//     dialog itself when it has no focusable children). aria-modal
//     keeps the rest of the page out of AT focus.
//   - On close: restore focus to the captured trigger via the
//     useEffect cleanup. Works whether close happens via X, backdrop,
//     Escape, or programmatic open=false.
//
// Tab focus-trap is hand-rolled because we are not using the native
// dialog. We listen for keydown on document, find the focusable list
// inside the dialog, and wrap from last-to-first / first-to-last when
// the user tabs past the boundary.
//
// Body scroll-lock is the standard `document.body.style.overflow =
// 'hidden'` pattern, with cleanup that restores the previous value
// (so a parent that already locked scrolling for another reason is
// not silently unlocked when this modal closes).

import { type MouseEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type ModalPosition = 'center' | 'bottom';
export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

export interface ModalProps {
  /** Whether the modal is currently visible. Controlled by the parent. */
  open: boolean;
  /**
   * Fires when the user requests to close the modal — backdrop click,
   * Escape key, or close-button. The parent decides whether to honor
   * the request by flipping `open` to false.
   */
  onClose: () => void;
  /** Modal body content. */
  children: ReactNode;
  /** Optional title rendered in the header. */
  title?: string;
  /** Optional descriptive text below the title. */
  description?: string;
  /** Layout style. Defaults to 'center'. */
  position?: ModalPosition;
  /** Max-width tier. Defaults to 'md'. */
  size?: ModalSize;
  /** When true (default), clicking the backdrop calls onClose. */
  closeOnBackdrop?: boolean;
  /** When true (default), pressing Escape calls onClose. */
  closeOnEscape?: boolean;
  /** When true (default), an X button is rendered in the top-right corner. */
  showCloseButton?: boolean;
  /** Caller-supplied additional classes on the dialog content panel. */
  className?: string;
}

// Animation duration in ms. Kept as a single source of truth so the
// CSS `duration-200` class and the unmount setTimeout below stay in
// sync — change one, change both.
const ANIMATION_DURATION_MS = 200;

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  // "full" is wider than lg but still capped — true full-screen would
  // bleed past the viewport padding and feel uncomfortable on
  // desktops. 2xl (~672 px) gives roomy forms without sprawl.
  full: 'max-w-2xl',
};

// How the panel aligns inside the backdrop wrapper. Center has a
// padding so the panel never touches the viewport edge on small
// screens; bottom has none because the sheet anchors to the edge by
// design.
const POSITION_CONTAINER: Record<ModalPosition, string> = {
  center: 'flex items-center justify-center p-4',
  bottom: 'flex items-end justify-center',
};

// Per-position panel rounding. Bottom sheets only round the top
// corners since they sit flush with the viewport edge; rounding the
// bottom would expose the backdrop in a thin sliver.
const POSITION_CONTENT: Record<ModalPosition, string> = {
  center: 'rounded-lg',
  bottom: 'rounded-t-2xl w-full',
};

// Entrance "from" classes — applied on first render before the rAF
// flip lets the browser transition to the "to" classes.
const ENTER_FROM: Record<ModalPosition, string> = {
  center: 'opacity-0 scale-95',
  bottom: 'opacity-0 translate-y-full',
};

// Entrance "to" classes (also serve as the steady-state look while
// the modal is open).
const ENTER_TO: Record<ModalPosition, string> = {
  center: 'opacity-100 scale-100',
  bottom: 'opacity-100 translate-y-0',
};

// CSS selector for "focusable" elements. Excludes disabled inputs and
// negative-tabindex elements (which are programmatically focusable
// but not in the tab sequence). Does NOT exclude the close button —
// that one should be tabbable.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  children,
  title,
  description,
  position = 'center',
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
}: ModalProps): JSX.Element | null {
  // shouldRender: keeps the portal alive through the exit animation.
  // Flips false `ANIMATION_DURATION_MS` after `open` goes false.
  const { t } = useTranslation('common');
  const [shouldRender, setShouldRender] = useState(open);
  // isOpen: drives the animation classes. Lags `open` by one rAF on
  // entrance so the browser sees the "from" frame.
  const [isOpen, setIsOpen] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Trigger element (whatever was focused when the modal opened) so
  // we can return focus on close.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const reactId = useId();
  const titleId = title ? `modal-${reactId}-title` : undefined;
  const descriptionId = description ? `modal-${reactId}-description` : undefined;

  // Mount + animate-in / animate-out. The two branches mirror each
  // other: on open we set shouldRender immediately (so the portal
  // mounts) then flip isOpen after one frame; on close we flip isOpen
  // immediately (so the exit transition starts) then unmount after
  // the animation completes.
  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const raf = requestAnimationFrame(() => setIsOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    setIsOpen(false);
    const timeout = window.setTimeout(() => setShouldRender(false), ANIMATION_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [open]);

  // Body scroll-lock while the modal occupies the viewport. We tie
  // this to `shouldRender`, not `open`, so scroll stays locked through
  // the exit animation — otherwise the page can shift visibly mid-
  // close. previousOverflow restoration matters because a parent may
  // have already locked overflow for unrelated reasons.
  useEffect(() => {
    if (!shouldRender) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [shouldRender]);

  // Focus management — capture the trigger element when the dialog
  // first appears, focus the first focusable inside it, and restore
  // focus to the trigger as soon as the parent flips `open` to false.
  //
  // Gating: depends on BOTH `open` and `shouldRender` because the
  // dialog is rendered (and therefore dialogRef.current is populated)
  // only when shouldRender is true, but the user-visible "I want to
  // close now" intent is `open=false`. Combining both lets us:
  //   - skip the very first effect tick after open=true (when the
  //     dialog has not been rendered yet),
  //   - claim focus on the second tick (after shouldRender flips to
  //     true and the dialog is in the DOM),
  //   - run the cleanup (which restores focus) the instant `open`
  //     goes false, instead of waiting 200 ms for the exit animation
  //     to finish — keyboard users feel the response immediately.
  useEffect(() => {
    if (!open || !shouldRender) return undefined;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (first) {
      first.focus();
    } else {
      dialog.focus();
    }
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [open, shouldRender]);

  // Escape handler — installed while the modal is open and Escape is
  // not opted out of. document-level listener so it works even when
  // focus is not on a child of the dialog.
  useEffect(() => {
    if (!open || !closeOnEscape) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, closeOnEscape, onClose]);

  // Tab focus-trap — wraps focus from last → first when tabbing
  // forward past the end, and first → last when shift-tabbing
  // backward past the start. No-op for dialogs with zero focusable
  // children (the dialog itself receives focus and stays put).
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (!shouldRender) return null;

  // Backdrop click should only fire when the click landed on the
  // backdrop element itself, not on the dialog or any of its
  // descendants. Comparing target === currentTarget is the cleanest
  // way to express that.
  const handleBackdropClick = (e: MouseEvent): void => {
    if (e.target === e.currentTarget && closeOnBackdrop) {
      onClose();
    }
  };

  const backdropCls = [
    'fixed inset-0 z-50 bg-black/40 backdrop-blur-md',
    'transition-opacity duration-200 ease-out',
    isOpen ? 'opacity-100' : 'opacity-0',
    POSITION_CONTAINER[position],
  ].join(' ');

  const contentCls = [
    'relative bg-canvas-1 shadow-high p-6 max-h-[90vh] overflow-y-auto',
    'transition-all duration-200 ease-out',
    POSITION_CONTENT[position],
    SIZE_CLASSES[size],
    isOpen ? ENTER_TO[position] : ENTER_FROM[position],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return createPortal(
    <div className={backdropCls} onClick={handleBackdropClick} data-testid="modal-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={contentCls}
      >
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('actions.close')}
            className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-text-2 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-1"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
        {(title || description) && (
          <header className={`${showCloseButton ? 'pr-10' : ''} mb-4`}>
            {title && (
              <h2 id={titleId} className="font-display text-card text-text-1">
                {title}
              </h2>
            )}
            {description && (
              <p id={descriptionId} className="font-body text-meta text-text-2 mt-1">
                {description}
              </p>
            )}
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

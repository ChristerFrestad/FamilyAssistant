// Convenience wrapper around Button that copies a string to the
// clipboard and flips its label to a "copied" state for a short
// cooldown. Used wherever the user needs a one-click copy of a
// generated value — SESSION_SECRET on the bootstrap wizard,
// magic-link CLI output, recipe URLs, etc.
//
// Internally renders a <Button>, so size and variant types are
// intentionally re-exported from Button to avoid drift between
// the two surfaces.
//
// Click-during-cooldown behavior:
//   The first click sets `copied=true` and starts a `duration`-ms
//   reset timer. A second click before the timer fires clears the
//   pending timer and starts a fresh one — so the label stays in
//   the "copied" state for at least `duration` ms after the most
//   recent click, never resetting half-way.
//
// Cleanup:
//   The reset timer is cleared on unmount so the component does
//   not setState on an unmounted instance (silent in React 18, but
//   leaks the timer reference until it fires).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, type ButtonSize, type ButtonVariant } from '../base/Button';

export interface CopyButtonProps {
  /** The string copied to the clipboard when the user clicks. */
  value: string;
  /** Default label when the button is idle. Defaults to "Kopier". */
  label?: string;
  /** Label shown for `duration` ms after a successful copy. Defaults to "Kopiert!". */
  copiedLabel?: string;
  /** Button size. Mirrors Button's scale. Defaults to 'md'. */
  size?: ButtonSize;
  /** Button variant. Mirrors Button's scale. Defaults to 'secondary'. */
  variant?: ButtonVariant;
  /** Fires after `navigator.clipboard.writeText` resolves. */
  onCopySuccess?: () => void;
  /** Fires when `navigator.clipboard.writeText` rejects (e.g. permissions). */
  onCopyError?: (error: Error) => void;
  /** Cooldown in milliseconds before the label resets. Defaults to 2000. */
  duration?: number;
  /** Caller-supplied classes appended to the underlying Button. */
  className?: string;
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  size = 'md',
  variant = 'secondary',
  onCopySuccess,
  onCopyError,
  duration = 2000,
  className,
}: CopyButtonProps): JSX.Element {
  const { t } = useTranslation('common');
  // Defaults flow through i18n so the button label respects the
  // active language. Callers can still override with an explicit
  // `label` / `copiedLabel` prop when the surrounding context wants
  // something more specific (e.g. "Hent token" for a one-time secret).
  const resolvedLabel = label ?? t('actions.copy');
  const resolvedCopiedLabel = copiedLabel ?? t('actions.copied');
  const [copied, setCopied] = useState(false);
  // useRef holds the active timer id across renders without
  // triggering re-renders when it changes — perfect for an
  // imperative-cleanup handle.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On unmount, drop the pending timer. Without this the timer
  // would still fire (silently — React 18 ignores setState on an
  // unmounted instance) but the closure references the unmounted
  // component for as long as the timer waits.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  async function handleClick(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Click-during-cooldown: clear the previous timer before
      // setting a new one, so the label stays "copied" for the
      // full `duration` ms after the most recent click.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, duration);
      onCopySuccess?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onCopyError?.(error);
    }
  }

  return (
    <Button variant={variant} size={size} onClick={handleClick} className={className}>
      {copied ? resolvedCopiedLabel : resolvedLabel}
    </Button>
  );
}

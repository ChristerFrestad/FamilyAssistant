// "Slett konto"-knapp for GDPR soft-delete.
//
// UX-flow (Christer-confirmed for pilot):
//   1. If the current user is owner of a family → button is disabled
//      with an inline hint "Du må overføre eierskap først". Backend
//      would 403 anyway; we forhåndssjekker for kjapp UX.
//   2. Otherwise → button is enabled. On click, native window.confirm
//      asks for explicit consent ("Du har 30 dager på å angre").
//   3. On confirm → onDelete handler from useSettingsData fires.
//      On success the parent (Settings.tsx) navigates to /v2/login.
//   4. On failure the parent's userFacingError toast surfaces.
//
// We deliberately use `window.confirm` instead of a custom Modal
// for pilot scope. A bespoke confirm-dialog is a Sprint 7 polish
// task once Resend lands and we redesign the GDPR-flow holistically.

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../base/Button';

export interface DeleteAccountButtonProps {
  /** Returns the delete-response on success, or null on failure. */
  onDelete: () => Promise<{ ok: true; hardDeleteAt: string; graceDays: number } | null>;
  /** Called after a successful delete so the parent can redirect. */
  onSuccess: (response: { ok: true; hardDeleteAt: string; graceDays: number }) => void;
  /** Already-translated button label. */
  label: string;
  /** Already-translated confirm-dialog text. */
  confirmText: string;
  /** Already-translated owner-blocked hint. Rendered when ownerBlocked is true. */
  ownerBlockedHint?: string;
  /**
   * When true the button is disabled because the current user is the
   * owner of a family with other members and must transfer ownership
   * first. Backend would 403; we forhåndssjekker.
   */
  ownerBlocked?: boolean;
  /** Optional confirm-handler override for testability (defaults to window.confirm). */
  confirmFn?: (text: string) => boolean;
}

export function DeleteAccountButton({
  onDelete,
  onSuccess,
  label,
  confirmText,
  ownerBlockedHint,
  ownerBlocked = false,
  confirmFn,
}: DeleteAccountButtonProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const ask = confirmFn ?? ((t: string): boolean => window.confirm(t));

  async function handleClick(): Promise<void> {
    if (busy || ownerBlocked) return;
    if (!ask(confirmText)) return;
    setBusy(true);
    try {
      const res = await onDelete();
      if (res) onSuccess(res);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        onClick={() => void handleClick()}
        disabled={ownerBlocked || busy}
        loading={busy}
        leftIcon={<Trash2 size={14} aria-hidden="true" />}
        className="text-coral-deep hover:bg-coral/10"
        data-testid="settings-delete-button"
      >
        {label}
      </Button>
      {ownerBlocked && ownerBlockedHint && (
        <p
          className="font-body text-meta text-text-3 text-right"
          data-testid="settings-delete-owner-hint"
        >
          {ownerBlockedHint}
        </p>
      )}
    </div>
  );
}

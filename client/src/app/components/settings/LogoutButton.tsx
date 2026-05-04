// "Logg ut"-knapp for v2 Settings.
//
// UX-flow (Christer-confirmed for pilot):
//   1. Always enabled — Settings is only reachable when authenticated.
//   2. On click, native window.confirm asks for explicit consent
//      ("Vil du logge ut?"). Pattern matches DeleteAccountButton:
//      a bespoke confirm-modal is a Sprint 7 polish task.
//   3. On confirm → onLogout handler (from AuthContext via Settings) fires.
//      AuthContext clears local user state; App.tsx redirects to /v2/login.
//   4. On failure (5xx) the button stops the busy spinner and stays.
//      Local state is still cleared inside AuthContext.logout for any
//      non-2xx response except 401 (which means the session was already
//      gone, so success is the right outcome). The pilot-scope toast
//      story is the same as DeleteAccountButton — we accept that a
//      transient 5xx looks like a successful logout from the user's
//      perspective.

import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../base/Button';

export interface LogoutButtonProps {
  /** Returns void on success; throws on non-401 errors. */
  onLogout: () => Promise<void>;
  /** Already-translated button label. */
  label: string;
  /** Already-translated confirm-dialog text. */
  confirmText: string;
  /** Optional confirm-handler override for testability (defaults to window.confirm). */
  confirmFn?: (text: string) => boolean;
}

export function LogoutButton({
  onLogout,
  label,
  confirmText,
  confirmFn,
}: LogoutButtonProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const ask = confirmFn ?? ((t: string): boolean => window.confirm(t));

  async function handleClick(): Promise<void> {
    if (busy) return;
    if (!ask(confirmText)) return;
    setBusy(true);
    try {
      await onLogout();
      // No success-callback — App.tsx redirects to /v2/login on
      // isAuthenticated=false, which AuthContext.logout has already set.
    } catch {
      // Surface as toast via Settings' userFacingError pattern would be
      // ideal; for pilot we silently let the busy state drop and
      // expect AuthContext to have cleared local state regardless.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => void handleClick()}
      disabled={busy}
      loading={busy}
      leftIcon={<LogOut size={14} aria-hidden="true" />}
      data-testid="settings-logout-button"
    >
      {label}
    </Button>
  );
}

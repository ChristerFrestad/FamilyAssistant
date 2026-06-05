// "Last ned mine data"-knapp for GDPR-eksport.
//
// Calls the parent-supplied onExport handler (which talks to
// /api/me/export via useSettingsData) and triggers a Blob download
// of the JSON payload. Uses URL.createObjectURL + a hidden anchor
// element so we don't need any third-party library.
//
// File-name format: familyassistant-export-YYYY-MM-DD.json. The
// date is taken from the local clock; we don't bother with the
// server's clock because this is a user-facing label, not data.
//
// Loading state is local to the button (spinner via Button's
// `loading` prop). Error surface is the parent's userFacingError
// toast — we just return early when onExport returns null.

import type { JSX } from 'react';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../base/Button';

export interface DataExportButtonProps {
  onExport: () => Promise<unknown | null>;
  /** Already-translated label. */
  label: string;
  /** Already-translated success-toast text (caller logs it; we don't surface). */
  ariaLabel?: string;
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function triggerDownload(payload: unknown, filename: string): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revocation by a tick so Safari can complete the navigation.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function DataExportButton({
  onExport,
  label,
  ariaLabel,
}: DataExportButtonProps): JSX.Element {
  const [busy, setBusy] = useState(false);

  async function handleClick(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await onExport();
      if (payload != null) {
        triggerDownload(payload, `familyassistant-export-${todayIso()}.json`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => void handleClick()}
      loading={busy}
      leftIcon={<Download size={14} aria-hidden="true" />}
      data-testid="settings-export-button"
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
    >
      {label}
    </Button>
  );
}

// Exported for unit-testing the helpers in isolation.
export const __testing = { todayIso, triggerDownload };

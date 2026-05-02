// Holdbarhet-badge for pantry items.
//
// Tilleggsoppdrag fra Christer (B5) — backend leverer expiresEst
// (ISO YYYY-MM-DD); when the field is set we show a compact status badge
// with color based on how close expiry is. When the field is null/undefined
// the component returns null (no visual noise for items without a date).
//
// Fargesystem (matcher design-tokens):
//   - amber  : "Expiring soon" — ≤ 7 days away
//   - coral  : "Expires tomorrow" / "Expires today" — ≤ 1 day, or "Expired" — past
//   - mint   : > 7 dager unna (ikke vist; vi viser kun warning-tilstander)
//
// Decision: we only show warnings. A badge for "Expires in 30 days"
// has negative value — it drowns critical signals in noise. Only ≤ 7
// days + expired trigger the badge.

import { useTranslation } from 'react-i18next';

export interface ExpiryBadgeProps {
  /** ISO YYYY-MM-DD or null. */
  expiresEst: string | null;
  /** Override "today" for testing. Defaults to current date. */
  now?: Date;
}

const DAY_MS = 86_400_000;

function calculateDaysUntil(expiresEst: string, now: Date): number | null {
  const expMs = Date.parse(expiresEst);
  if (!Number.isFinite(expMs)) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expMs);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - today.getTime()) / DAY_MS);
}

export function ExpiryBadge({
  expiresEst,
  now = new Date(),
}: ExpiryBadgeProps): JSX.Element | null {
  const { t } = useTranslation('pantry');
  if (!expiresEst) return null;

  const days = calculateDaysUntil(expiresEst, now);
  if (days === null) return null;

  // Hide for items > 7 days from expiry — we only surface warnings.
  if (days > 7) return null;

  let label: string;
  let toneClass: string;

  if (days < 0) {
    label = t('expiry.expired');
    toneClass = 'bg-coral/15 text-coral border-coral/25';
  } else if (days === 0) {
    label = t('expiry.expiresToday');
    toneClass = 'bg-coral/15 text-coral border-coral/25';
  } else if (days === 1) {
    label = t('expiry.expiresInOne');
    toneClass = 'bg-coral/15 text-coral border-coral/25';
  } else if (days < 3) {
    label = t('expiry.expiresInDays', { days });
    toneClass = 'bg-coral/15 text-coral border-coral/25';
  } else {
    // 3..7 days: amber warning.
    label = t('expiry.expiresInDays', { days });
    toneClass = 'bg-amber/15 text-amber border-amber/25';
  }

  return (
    <span
      className={[
        'inline-flex items-center rounded-pill border px-2 py-0.5',
        'font-mono text-[10px] tabular-nums',
        toneClass,
      ].join(' ')}
      data-testid="expiry-badge"
    >
      {label}
    </span>
  );
}

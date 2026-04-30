// Per-row pantry component.
//
// Renders one inventory line: name, quantity (remaining/total + unit),
// optional progress-bar (only when total is known), low-stock badge,
// expiry warning, and the two action buttons ("Marker brukt" + delete).
//
// Defensive null-handling per CLAUDE.md philosophy:
//   - unit missing  → fall back to remainingNoUnit
//   - total missing → hide progress-bar, show remainingNoTotal
//   - total < remaining (edge — should not happen but render defensively)
//     → render bar at 100%
//
// Color tokens for progress bar follow mockup's heuristic:
//   - ratio < 0.20  → coral (matches isLow flag)
//   - ratio < 0.40  → amber
//   - ratio >= 0.40 → mint

import { useTranslation } from 'react-i18next';
import { Trash2, MinusCircle } from 'lucide-react';
import { ExpiryBadge } from './ExpiryBadge';
import type { PantryItem as PantryItemType } from '../../pantry/pantryApi';

export interface PantryItemProps {
  item: PantryItemType;
  /** Open the "marker brukt" dialog for this item. */
  onMarkUsed: (item: PantryItemType) => void;
  /** Confirm-then-delete handled by the parent (no native confirm here). */
  onDelete: (productKey: string) => void;
}

function formatQuantity(value: number): string {
  // Use up to 1 decimal but trim trailing zeros (1 → "1", 0.5 → "0,5"). Norwegian
  // decimal separator. Display-only — the underlying number stays as-is.
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 10) / 10;
  return rounded.toString().replace('.', ',');
}

function progressTone(ratio: number | null): string {
  if (ratio === null) return 'bg-stroke-strong';
  if (ratio < 0.2) return 'bg-coral';
  if (ratio < 0.4) return 'bg-amber';
  return 'bg-mint';
}

export function PantryItem({ item, onMarkUsed, onDelete }: PantryItemProps): JSX.Element {
  const { t } = useTranslation('pantry');

  const hasUnit = Boolean(item.unit && item.unit.trim().length > 0);
  const hasTotal = item.total !== null && item.total > 0;

  // Bar width: cap at 100% even if remaining > total (edge case from
  // user-correction races). Floor at 0 to prevent negative widths from
  // floating-point underflow.
  const widthPct = (() => {
    if (!hasTotal || item.total === null) return null;
    const ratio = Math.min(1, Math.max(0, item.quantity / item.total));
    return Math.round(ratio * 100);
  })();

  const quantityLabel = (() => {
    const remaining = formatQuantity(item.quantity);
    if (hasTotal && item.total !== null && hasUnit) {
      return t('item.remainingOf', {
        remaining,
        total: formatQuantity(item.total),
        unit: item.unit,
      });
    }
    if (hasUnit) {
      return t('item.remainingNoTotal', { remaining, unit: item.unit });
    }
    return t('item.remainingNoUnit', { count: item.quantity, remaining });
  })();

  return (
    <li
      className="flex items-center gap-3 px-4 py-3"
      data-testid="pantry-item"
      data-product-key={item.productKey}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-body text-body text-text-1">{item.name}</span>
          {item.isLow && (
            <span
              className="inline-flex items-center rounded-pill border border-coral/25 bg-coral/15 px-2 py-0.5 font-mono text-[10px] text-coral"
              data-testid="pantry-low-badge"
            >
              {t('badge.low')}
            </span>
          )}
          <ExpiryBadge expiresEst={item.expiresEst} />
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {widthPct !== null && (
            <div
              className="flex-1 h-1.5 rounded-pill overflow-hidden max-w-[160px] bg-stroke-strong"
              role="progressbar"
              aria-label={item.name}
              aria-valuenow={widthPct}
              aria-valuemin={0}
              aria-valuemax={100}
              data-testid="pantry-progress"
            >
              <div
                className={`h-full rounded-pill ${progressTone(item.ratio)}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          )}
          <span
            className="font-mono text-meta text-text-3 tabular-nums"
            data-testid="pantry-quantity"
          >
            {quantityLabel}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onMarkUsed(item)}
        aria-label={t('actions.markUsedAria', { name: item.name })}
        className={[
          'inline-flex items-center gap-1.5 rounded-pill border border-stroke',
          'bg-surface px-3 py-1.5 font-body text-meta text-text-1',
          'hover:bg-surface-strong transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
        ].join(' ')}
        data-testid="pantry-mark-used"
      >
        <MinusCircle size={14} aria-hidden="true" />
        <span className="whitespace-nowrap">{t('actions.markUsed')}</span>
      </button>

      <button
        type="button"
        onClick={() => onDelete(item.productKey)}
        aria-label={t('actions.deleteAria', { name: item.name })}
        className={[
          'inline-flex items-center justify-center rounded-pill h-8 w-8',
          'text-text-3 hover:text-coral hover:bg-coral/10 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
        ].join(' ')}
        data-testid="pantry-delete"
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

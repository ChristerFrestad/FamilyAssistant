// One row in the shopping list. Renders the checkbox, name, qty/unit,
// optional recipe-link meta, optional price, and a delete button.
//
// State is owned by the parent (Shopping screen via useShoppingData).
// This component fires onToggle and onDelete callbacks; the parent
// handles the optimistic update.
//
// Accessibility:
//   - the entire row is a labelled checkbox via the visible <button>
//     with role='checkbox' + aria-checked
//   - delete is a separate <button> with an aria-label
//   - text shows strikethrough purely visually when bought, but the
//     aria-checked state is what assistive tech announces

import { useTranslation } from 'react-i18next';
import type { ShoppingItem } from '../../shopping/shoppingApi';

export interface ShoppingItemRowProps {
  item: ShoppingItem;
  onToggle: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  /**
   * Localised currency formatter. Falls back to a simple template
   * when not provided so the component stays renderable in tests
   * without setting up Intl.
   */
  formatPrice?: (kr: number) => string;
}

// Defensive helpers: every input is treated as potentially missing.
// Backend now returns mealsJson:[] consistently (see enrichItemForFrontend
// in shopping.repo.js), but legacy responses or a future contract drift
// could surface null/undefined here. We never want a missing field to
// crash the row.
function recipeLabel(
  meals: string[] | null | undefined,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const list = Array.isArray(meals) ? meals : [];
  if (list.length === 0) return '';
  if (list.length === 1) return t('shopping:item.recipeOne', { name: list[0] });
  return t('shopping:item.recipeMany', { count: list.length });
}

function recipeTooltip(meals: string[] | null | undefined): string | undefined {
  const list = Array.isArray(meals) ? meals : [];
  if (list.length === 0) return undefined;
  return list.join(', ');
}

function formatQty(qty: number | null, unit: string | null): string {
  if (qty == null && !unit) return '';
  if (qty != null && unit) return `${qty} ${unit}`;
  if (qty != null) return String(qty);
  return unit || '';
}

const ROW_BASE = [
  'flex items-center gap-3',
  'px-3 py-2.5',
  'border-b border-stroke last:border-b-0',
].join(' ');

const CHECKBOX_BASE = [
  'inline-flex items-center justify-center',
  'h-6 w-6 flex-shrink-0',
  'rounded-md',
  'border-2',
  'transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
].join(' ');

export function ShoppingItemRow({
  item,
  onToggle,
  onDelete,
  formatPrice,
}: ShoppingItemRowProps): JSX.Element {
  const { t } = useTranslation(['shopping', 'common']);
  // Defensive name fallback: backend now sets `name` via
  // enrichItemForFrontend, but in case the field ever drifts we
  // synthesise from the raw ingredient columns or fall back to a
  // localised "Ukjent vare" so the row never crashes.
  const displayName: string =
    item.name || item.ingredientNameNo || item.ingredientName || t('shopping:item.unknown');
  const checked = !!item.checkedOff;
  const qtyText = formatQty(item.qty ?? null, item.unit ?? null);
  const meta = recipeLabel(item.mealsJson, t);
  const metaTip = recipeTooltip(item.mealsJson);
  const showPrice = typeof item.estPrice === 'number' && item.estPrice > 0;
  const renderedPrice = showPrice
    ? formatPrice
      ? formatPrice(item.estPrice as number)
      : `${item.estPrice} kr`
    : null;

  return (
    <div className={ROW_BASE} data-testid={`shopping-item-${item.id}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={
          checked
            ? t('shopping:item.uncheckAria', { name: displayName })
            : t('shopping:item.checkAria', { name: displayName })
        }
        className={[
          CHECKBOX_BASE,
          checked ? 'border-mint bg-mint text-ink-contrast' : 'border-stroke bg-canvas-0',
        ].join(' ')}
        onClick={() => onToggle(item)}
        data-testid={`shopping-item-toggle-${item.id}`}
      >
        {checked && (
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m3 8 3.5 3.5L13 5" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={[
            'truncate font-body text-body',
            checked ? 'text-text-3 line-through' : 'text-text-1',
          ].join(' ')}
          title={displayName.length > 30 ? displayName : undefined}
        >
          {displayName}
        </div>
        {(qtyText || meta) && (
          <div className="flex items-center gap-1.5 truncate font-body text-meta text-text-3">
            {qtyText && <span>{qtyText}</span>}
            {qtyText && meta && <span aria-hidden="true">·</span>}
            {meta && (
              <span className="italic" title={metaTip}>
                {meta}
              </span>
            )}
          </div>
        )}
      </div>

      {renderedPrice && (
        <div
          className={[
            'flex-shrink-0 font-body text-meta tabular-nums',
            checked ? 'text-text-3 line-through' : 'text-text-2',
          ].join(' ')}
          aria-label={t('shopping:item.priceAria', { price: renderedPrice })}
        >
          {renderedPrice}
        </div>
      )}

      <button
        type="button"
        onClick={() => onDelete(item)}
        aria-label={t('shopping:item.deleteAria', { name: displayName })}
        className={[
          'inline-flex h-7 w-7 flex-shrink-0 items-center justify-center',
          'rounded-md text-text-3 hover:bg-canvas-2 hover:text-coral-deep',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
        ].join(' ')}
        data-testid={`shopping-item-delete-${item.id}`}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
        </svg>
      </button>
    </div>
  );
}

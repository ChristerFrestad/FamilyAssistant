// Segmented toggle that switches the Shopping screen between
// "Handleliste" (list) and "Hva har vi hjemme?" (pantry) sub-views.
//
// The active sub-view is encoded in the URL search-param `?view=`. Going
// through the URL keeps it bookmark-able and survives back-button —
// alternative (component-local useState) would lose the choice on every
// navigation away from /shopping.
//
// Default: when ?view is absent or unrecognised, list-view renders.
// This keeps deep-links to /v2/shopping pointing at the dominant flow.

import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, Refrigerator } from 'lucide-react';

export type ShoppingView = 'list' | 'pantry';

const VIEW_PARAM = 'view';

export function readShoppingView(searchParams: URLSearchParams): ShoppingView {
  const v = searchParams.get(VIEW_PARAM);
  return v === 'pantry' ? 'pantry' : 'list';
}

export interface ShoppingViewToggleProps {
  /** Override read for testability. Defaults to URL search-params via hook. */
  active?: ShoppingView;
  /** Override write for testability. Defaults to URL search-params via hook. */
  onChange?: (next: ShoppingView) => void;
}

export function ShoppingViewToggle({
  active: activeOverride,
  onChange: onChangeOverride,
}: ShoppingViewToggleProps = {}): JSX.Element {
  const { t } = useTranslation('pantry');
  const [searchParams, setSearchParams] = useSearchParams();
  const active = activeOverride ?? readShoppingView(searchParams);

  const setView = (next: ShoppingView): void => {
    if (onChangeOverride) {
      onChangeOverride(next);
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'list') {
      nextParams.delete(VIEW_PARAM);
    } else {
      nextParams.set(VIEW_PARAM, next);
    }
    setSearchParams(nextParams, { replace: false });
  };

  const tabClass = (selected: boolean): string =>
    [
      'flex-1 inline-flex items-center justify-center gap-1.5 rounded-pill',
      'py-2 px-3 font-body text-meta font-medium whitespace-nowrap transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
      selected ? 'bg-ink text-ink-contrast' : 'text-text-2 hover:bg-surface',
    ].join(' ');

  return (
    <div
      role="tablist"
      aria-label={t('viewToggle.list')}
      className="flex gap-1 rounded-pill border border-stroke bg-surface p-1"
      data-testid="shopping-view-toggle"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'list'}
        onClick={() => setView('list')}
        className={tabClass(active === 'list')}
        data-testid="shopping-view-toggle-list"
      >
        <ShoppingCart size={14} aria-hidden="true" />
        <span>{t('viewToggle.list')}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'pantry'}
        onClick={() => setView('pantry')}
        className={tabClass(active === 'pantry')}
        data-testid="shopping-view-toggle-pantry"
      >
        <Refrigerator size={14} aria-hidden="true" />
        <span>{t('viewToggle.pantry')}</span>
      </button>
    </div>
  );
}

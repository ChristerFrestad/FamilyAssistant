// Container for the Pantry sub-view of the Shopping screen.
//
// Owns the data lifecycle (usePantryData) and dialog state. Renders:
//   - header (title + summary stats)
//   - loading skeleton / empty state / error state / category groups
//   - quick-add input (sticky at bottom)
//   - "marker brukt"-dialog (modal)
//   - inline error toast
//
// The Shopping-screen's existing ErrorBoundary wraps this view as well —
// any uncaught render error in the children below surfaces through it.
//
// Sort order: items inside each category come pre-sorted by the backend
// (alphabetical 'nb' locale). Categories themselves render in the order
// they first appear in items[]. Pilot scope — no manual ordering yet.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Refrigerator } from 'lucide-react';
import { Card } from '../layout/Card';
import { Button } from '../base/Button';
import { PantryItem } from './PantryItem';
import { UseDialog } from './UseDialog';
import { QuickAddPantry } from './QuickAddPantry';
import { usePantryData } from '../../pantry/usePantryData';
import type { PantryItem as PantryItemType } from '../../pantry/pantryApi';

const TOAST_DISMISS_MS = 4000;

export function PantryView(): JSX.Element {
  const { t } = useTranslation(['pantry', 'common']);
  const {
    items,
    isLoading,
    error,
    userFacingError,
    stats,
    itemsByCategory,
    retry,
    markUsed,
    removeItem,
    addItem,
    clearUserFacingError,
  } = usePantryData();
  const [activeUseItem, setActiveUseItem] = useState<PantryItemType | null>(null);

  useEffect(() => {
    if (userFacingError === null) return undefined;
    const id = window.setTimeout(() => clearUserFacingError(), TOAST_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [userFacingError, clearUserFacingError]);

  const isEmpty = !isLoading && error === null && items.length === 0;

  const headerSubtitle = useMemo(() => {
    if (stats.total === 0) return null;
    const totalLabel = t('stats.total', { count: stats.total });
    const lowLabel = t('stats.lowAndExpiring', {
      lowCount: stats.lowCount,
      expiringCount: stats.expiringSoonCount,
    });
    return { totalLabel, lowLabel };
  }, [stats, t]);

  return (
    <section
      aria-labelledby="pantry-screen-heading"
      className="flex flex-col gap-4"
      data-testid="pantry-view"
    >
      <Card padding="md" shadow="low">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-cyan/15 text-cyan">
            <Refrigerator size={22} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="pantry-screen-heading"
              className="font-display text-display-sm text-text-1 truncate"
            >
              {headerSubtitle?.totalLabel ?? t('title')}
            </h2>
            {headerSubtitle && (
              <p className="font-body text-meta text-text-2">{headerSubtitle.lowLabel}</p>
            )}
          </div>
        </div>
      </Card>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          data-testid="pantry-skeleton"
          className="flex flex-col gap-3"
        >
          <span className="sr-only">{t('loading')}</span>
          {[0, 1, 2].map((i) => (
            <Card key={i} padding="md" shadow="low">
              <div className="flex flex-col gap-2">
                <div className="h-3 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
                <div className="h-4 w-3/4 animate-pulse rounded-pill bg-stroke-strong" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && error !== null && (
        <Card padding="md" shadow="low" data-testid="pantry-error">
          <div className="flex flex-col gap-3" role="alert">
            <h3 className="font-display text-card text-text-1">{t('error.title')}</h3>
            <p className="font-body text-body text-text-2">
              {t('errors.loadFailed', { defaultValue: '' })}
            </p>
            <Button type="button" variant="secondary" onClick={retry}>
              {t('error.retry')}
            </Button>
          </div>
        </Card>
      )}

      {isEmpty && (
        <Card padding="lg" data-testid="pantry-empty" className="flex flex-col items-center gap-3">
          <h3 className="font-display text-display-sm text-text-1">{t('empty.title')}</h3>
          <p className="max-w-sm text-center font-body text-body text-text-2">{t('empty.body')}</p>
        </Card>
      )}

      {!isLoading && error === null && itemsByCategory.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="pantry-groups">
          {itemsByCategory.map((group) => (
            <Card key={group.category} padding="none" shadow="low">
              <div className="flex items-center justify-between border-b border-stroke px-4 py-3">
                <span className="font-body text-meta font-medium text-text-1">
                  {group.category === 'other' ? t('shopping:categories.other') : group.category}
                </span>
                <span className="font-mono text-meta text-text-3 tabular-nums">
                  {group.items.length}
                </span>
              </div>
              <ul className="divide-y divide-stroke">
                {group.items.map((item) => (
                  <PantryItem
                    key={item.productKey}
                    item={item}
                    onMarkUsed={setActiveUseItem}
                    onDelete={(productKey) => void removeItem(productKey)}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <QuickAddPantry onAdd={(body) => addItem(body)} />

      <p className="font-body text-meta text-text-3 text-center" data-testid="pantry-footer">
        {t('footer')}
      </p>

      <UseDialog
        item={activeUseItem}
        onClose={() => setActiveUseItem(null)}
        onConfirm={(item, amountUsed) => markUsed(item, amountUsed)}
      />

      {userFacingError && (
        <div
          role="alert"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-pill bg-canvas-2 px-4 py-2 font-body text-meta text-text-1 shadow-mid"
          data-testid="pantry-toast"
        >
          <span>{userFacingError.message || t('errors.generic')}</span>
        </div>
      )}
    </section>
  );
}

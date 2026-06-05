// Phase 2D + 2E Shopping screen.
//
// Hosts two sub-views via segmented toggle (URL state ?view=):
//   - list   (default) — the shopping list itself (Phase 2D)
//   - pantry          — pantry sub-view rendering inventory (Phase 2E)
//
// The list-view surfaces (unchanged from Phase 2D):
//   - Header: title + compact statistics strip (bought/total +
//     remaining + remaining-price-sum when ≥1 item is Kassal-priced).
//   - Empty state: when no active list exists for the current week,
//     show "Generer fra ukens middager"-CTA. When an active list
//     exists but is empty, show a hint pointing at QuickAdd.
//   - Categories: kategori-grupperte items, with toggle (bought) +
//     delete on each row. Optimistic updates with rollback on
//     failure (handled by useShoppingData).
//   - QuickAdd: sticky bottom input. Disabled when no active list
//     exists; the disabled-hint suggests generating from meals.
//   - Toast: surfaces userFacingError from the hook for transient
//     feedback. Auto-clears on next successful op.
//   - WEEK_NOT_COMPLETE inline error: when /generate rejects with
//     this code, swap the empty-state copy for a hint pointing at
//     /v2/meals.
//
// The pantry-view is the PantryView container — see its file for the
// full surface (loading/empty/error/grouped items, marker-brukt
// dialog, quick-add).
//
// Routing: /v2/shopping is wired in App.tsx — this component just
// renders. Auth is handled by AuthGuard at the route level.
// ErrorBoundary at the route wraps both sub-views.

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { ShoppingHeader } from '../components/shopping/ShoppingHeader';
import { CategoryGroup } from '../components/shopping/CategoryGroup';
import { QuickAddInput } from '../components/shopping/QuickAddInput';
import { EmptyState } from '../components/shopping/EmptyState';
import { RegenerateDialog } from '../components/shopping/RegenerateDialog';
import { useShoppingData } from '../shopping/useShoppingData';
import { PantryView } from '../components/pantry/PantryView';
import { ShoppingViewToggle, readShoppingView } from '../components/pantry/ShoppingViewToggle';

const TOAST_DISMISS_MS = 4000;

export function Shopping(): JSX.Element {
  const [searchParams] = useSearchParams();
  const view = readShoppingView(searchParams);

  if (view === 'pantry') {
    return (
      <div className="flex flex-col gap-4 pb-2" data-testid="shopping-screen">
        <ShoppingViewToggle />
        <PantryView />
      </div>
    );
  }

  return <ShoppingListView />;
}

function ShoppingListView(): JSX.Element {
  const { t, i18n } = useTranslation(['shopping', 'common']);
  const navigate = useNavigate();
  const {
    list,
    isLoading,
    error,
    userFacingError,
    hasActiveList,
    flatItems,
    stats,
    retry,
    toggleBought,
    removeItem,
    addItem,
    generateFromMeals,
    clearUserFacingError,
  } = useShoppingData();

  const [generating, setGenerating] = useState(false);
  // Confirmation dialog for the always-visible regenerate CTA. The
  // EmptyState CTA (no-list variant) skips the dialog because there is
  // nothing to lose; this one opens it because the user may have manual
  // or bought items the merge will preserve, and they deserve a heads-up.
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);

  // Currency formatter. Uses Intl per i18n.language to avoid hardcoded
  // separators (AGENTS.md DEL 7.11). Norwegian uses NOK; en-US falls
  // back to a localized "kr" suffix to match the underlying data.
  const formatPrice = useMemo(() => {
    const lang = i18n.language || 'no';
    if (lang.startsWith('no') || lang.startsWith('nb')) {
      const fmt = new Intl.NumberFormat('nb-NO', {
        style: 'currency',
        currency: 'NOK',
        maximumFractionDigits: 0,
      });
      return (kr: number): string => fmt.format(kr).replace('NOK', 'kr').trim();
    }
    return (kr: number): string => `${kr} kr`;
  }, [i18n.language]);

  // Auto-clear the toast after 4s.
  useEffect(() => {
    if (userFacingError === null) return undefined;
    const id = window.setTimeout(() => clearUserFacingError(), TOAST_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [userFacingError, clearUserFacingError]);

  const handleGenerate = async (): Promise<void> => {
    setGenerating(true);
    try {
      await generateFromMeals();
    } finally {
      setGenerating(false);
    }
  };

  // Handler for the always-visible regenerate CTA. Opens the
  // confirmation dialog when an active list exists; otherwise behaves
  // like the EmptyState CTA and goes straight through.
  const handleRegenerateClick = (): void => {
    if (hasActiveList) {
      setRegenerateDialogOpen(true);
    } else {
      void handleGenerate();
    }
  };

  const handleRegenerateConfirm = async (): Promise<void> => {
    setRegenerateDialogOpen(false);
    await handleGenerate();
  };

  const isWeekIncomplete = userFacingError?.code === 'WEEK_NOT_COMPLETE';

  return (
    <section
      aria-labelledby="screen-heading"
      className="flex flex-col gap-4 pb-2"
      data-testid="shopping-screen"
    >
      <ShoppingViewToggle />
      <ShoppingHeader
        stats={stats}
        formatPrice={formatPrice}
        isEmpty={!hasActiveList || flatItems.length === 0}
      />

      {/* Always-visible regenerate CTA. Hidden during loading/error and
          while WEEK_NOT_COMPLETE is surfaced (that error renders its own
          "open meals" CTA). For the no-list state the EmptyState
          component already has the CTA, so we hide it here too — a
          single CTA per state keeps the affordance unambiguous. */}
      {!isLoading && error === null && !isWeekIncomplete && hasActiveList ? (
        <div className="flex justify-end" data-testid="shopping-regenerate-row">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRegenerateClick}
            loading={generating}
            data-testid="shopping-regenerate-cta"
          >
            {t('shopping:actions.regenerate')}
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="shopping-skeleton"
          className="flex flex-col gap-3"
        >
          <span className="sr-only">{t('common:status.loading')}</span>
          {[0, 1, 2].map((i) => (
            <Card key={i} padding="md" shadow="low">
              <div className="flex flex-col gap-3">
                <div className="h-3 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
                <div className="h-4 w-3/4 animate-pulse rounded-pill bg-stroke-strong" />
                <div className="h-4 w-2/3 animate-pulse rounded-pill bg-stroke-strong" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {!isLoading && error !== null ? (
        <Card padding="md" shadow="low" data-testid="shopping-error">
          <div className="flex flex-col gap-3" role="alert">
            <p className="font-body text-body text-text-2">{t('shopping:errors.loadFailed')}</p>
            <Button type="button" variant="secondary" onClick={retry}>
              {t('shopping:actions.retry')}
            </Button>
          </div>
        </Card>
      ) : null}

      {!isLoading && error === null && isWeekIncomplete ? (
        <Card
          padding="lg"
          className="flex flex-col items-center gap-3 text-center"
          data-testid="shopping-week-not-complete"
        >
          <h2 className="font-display text-display-sm text-text-1">
            {t('shopping:empty.weekNotCompleteTitle')}
          </h2>
          <p className="max-w-sm font-body text-body text-text-2">
            {t('shopping:empty.weekNotCompleteBody')}
          </p>
          <Button type="button" variant="primary" onClick={() => navigate('/meals')}>
            {t('shopping:actions.openMeals')}
          </Button>
        </Card>
      ) : null}

      {!isLoading && error === null && !isWeekIncomplete && !hasActiveList ? (
        <EmptyState variant="no-list" onGenerate={handleGenerate} generating={generating} />
      ) : null}

      {!isLoading && error === null && hasActiveList && flatItems.length === 0 ? (
        <EmptyState variant="no-items" />
      ) : null}

      {!isLoading && error === null && hasActiveList && flatItems.length > 0 ? (
        <div className="flex flex-col gap-3">
          {(list?.categories ?? []).map((cat) => (
            <CategoryGroup
              key={cat.category}
              category={cat.category}
              items={cat.items}
              onToggle={(item) => void toggleBought(item)}
              onDelete={(item) => void removeItem(item)}
              formatPrice={formatPrice}
            />
          ))}
        </div>
      ) : null}

      <QuickAddInput
        onAdd={async (name: string) => {
          const result = await addItem({ name });
          return result;
        }}
        enabled={hasActiveList}
        disabledHint={t('shopping:quickAdd.disabledHint')}
      />

      {userFacingError && !isWeekIncomplete && (
        <div
          role="alert"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-pill bg-canvas-2 px-4 py-2 font-body text-meta text-text-1 shadow-mid"
          data-testid="shopping-toast"
        >
          <span>{translateError(t, userFacingError)}</span>
        </div>
      )}

      {/* Hidden link kept for SR users who land here via /shopping after
          a backend redirect; the inline navigate above handles button
          clicks. Intentionally unused in the visible flow. */}
      <Link to="/meals" className="sr-only" aria-hidden="true" tabIndex={-1}>
        {t('shopping:actions.openMeals')}
      </Link>

      <RegenerateDialog
        open={regenerateDialogOpen}
        onClose={() => setRegenerateDialogOpen(false)}
        onConfirm={handleRegenerateConfirm}
        loading={generating}
      />
    </section>
  );
}

function translateError(
  t: ReturnType<typeof useTranslation>['t'],
  err: { message: string; code: string | null }
): string {
  switch (err.code) {
    case 'NO_ACTIVE_LIST':
      return t('shopping:errors.noActiveList');
    case 'WEEK_NOT_COMPLETE':
      return t('shopping:errors.weekNotComplete');
    default:
      return err.message || t('shopping:errors.generic');
  }
}

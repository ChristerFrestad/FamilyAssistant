// Generic four-state card for the dashboard sections.
//
// Renders one of:
//   * skeleton   — isLoading=true (initial fetch, or retry in flight)
//   * error      — error is non-null (with a Retry button if onRetry is set)
//   * empty      — data is non-null but empty (array.length === 0)
//   * data       — data is non-null and non-empty
//
// The card itself doesn't know what kind of items it shows; the
// caller passes a renderItem function. The "more N" tail is
// computed here so each consumer doesn't have to repeat the
// slice-and-count dance.

import type { JSX } from 'react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../layout/Card';
import { Button } from '../base/Button';

export interface DashboardCardProps<T> {
  /** Translated section heading shown at the top of the card. */
  title: string;
  /** Optional icon shown next to the title. Decorative only. */
  icon?: ReactNode;
  /** Source data. `null` = not yet loaded; `[]` = loaded-and-empty. */
  data: T[] | null;
  isLoading: boolean;
  error: Error | null;
  /** Render a single item. Receives the item only; key handled here. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Stable key extractor so React's reconciliation works correctly. */
  itemKey: (item: T, index: number) => string | number;
  /** Translated message shown when the data is loaded-and-empty. */
  emptyMessage: string;
  /**
   * Optional empty-state CTA — e.g. "Add a meal". Renders below the
   * empty message. The CTA is a navigation hint, not a data action.
   */
  emptyCta?: { label: string; onClick: () => void };
  /** Maximum number of items to render before showing a "+ N more" tail. */
  limit?: number;
  /**
   * Translation function for the "+ N more" tail. Receives the
   * remaining count, returns a translated label. Optional; if
   * omitted, the tail is suppressed.
   */
  formatMore?: (remaining: number) => string;
  /** Retry handler; shown only when error is non-null. */
  onRetry?: () => void;
}

/**
 * Three short skeleton lines matching the typical card body height.
 * Stays inline here (40 lines max per analysis §6 B-4) instead of
 * promoting to a generic Skeleton primitive — the dashboard is the
 * only consumer for now.
 */
function CardSkeleton(): JSX.Element {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">Laster...</span>
      <div className="h-3 w-3/4 animate-pulse rounded-pill bg-stroke-strong" />
      <div className="h-3 w-2/3 animate-pulse rounded-pill bg-stroke-strong" />
      <div className="h-3 w-1/2 animate-pulse rounded-pill bg-stroke-strong" />
    </div>
  );
}

export function DashboardCard<T>({
  title,
  icon,
  data,
  isLoading,
  error,
  renderItem,
  itemKey,
  emptyMessage,
  emptyCta,
  limit,
  formatMore,
  onRetry,
}: DashboardCardProps<T>): JSX.Element {
  const { t } = useTranslation(['dashboard', 'common']);

  // State priority: loading first, then error, then data/empty.
  // isLoading wins over a stale `data` from a previous fetch so a
  // retry visually resets the card.
  const showSkeleton = isLoading;
  const showError = !isLoading && error !== null;
  const showEmpty = !isLoading && error === null && data !== null && data.length === 0;
  const showData = !isLoading && error === null && data !== null && data.length > 0;

  const limited = data && limit ? data.slice(0, limit) : data;
  const remaining = data && limit ? Math.max(0, data.length - limit) : 0;

  return (
    <Card padding="md" shadow="low">
      <header className="mb-3 flex items-center gap-2">
        {icon ? (
          <span aria-hidden="true" className="text-text-2">
            {icon}
          </span>
        ) : null}
        <h2 className="font-display text-card text-text-1 leading-none">{title}</h2>
      </header>

      {showSkeleton ? <CardSkeleton /> : null}

      {showError ? (
        <div className="flex flex-col gap-3" role="alert">
          <p className="font-body text-body text-text-2">{t('dashboard:errors.generic')}</p>
          {onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry}>
              {t('dashboard:actions.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showEmpty ? (
        <div className="flex flex-col gap-3">
          <p className="font-body text-body text-text-2">{emptyMessage}</p>
          {emptyCta ? (
            <Button type="button" variant="secondary" onClick={emptyCta.onClick}>
              {emptyCta.label}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showData && limited ? (
        <ul className="flex flex-col gap-2">
          {limited.map((item, index) => (
            <li key={itemKey(item, index)}>{renderItem(item, index)}</li>
          ))}
          {remaining > 0 && formatMore ? (
            <li className="font-body text-meta text-text-3">{formatMore(remaining)}</li>
          ) : null}
        </ul>
      ) : null}
    </Card>
  );
}

// Page header for the Shopping screen: title + compact statistics
// strip (total / bought / remaining) plus optional remaining-price
// badge when at least one item carries a Kassal-enriched estPrice.
//
// Falls back to "Handleliste" for the title when no override is
// provided. Stats are rendered as plain text — the progress-ring
// from the mockup is intentionally deferred (see analysis B9).

import { useTranslation } from 'react-i18next';
import type { ShoppingStats } from '../../shopping/useShoppingData';

export interface ShoppingHeaderProps {
  stats: ShoppingStats;
  /** Localised currency formatter; falls back to `${kr} kr`. */
  formatPrice?: (kr: number) => string;
  /** When true, render the empty-state header (no stats, just the title). */
  isEmpty?: boolean;
}

export function ShoppingHeader({
  stats,
  formatPrice,
  isEmpty = false,
}: ShoppingHeaderProps): JSX.Element {
  const { t } = useTranslation(['shopping']);
  const showRemainingPrice = stats.remainingPriceSum > 0;
  const renderedPrice = showRemainingPrice
    ? formatPrice
      ? formatPrice(stats.remainingPriceSum)
      : `~${stats.remainingPriceSum} kr`
    : null;
  const partial = showRemainingPrice && stats.itemsWithPriceCount < stats.remaining;

  return (
    <header className="space-y-2" data-testid="shopping-header">
      <h1 className="font-display text-display-md text-text-1" id="screen-heading">
        {t('shopping:title')}
      </h1>
      {!isEmpty && stats.total > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-body text-meta text-text-2">
          <span>
            {t('shopping:stats.boughtOfTotal', {
              bought: stats.bought,
              total: stats.total,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>{t('shopping:stats.remaining', { count: stats.remaining })}</span>
          {renderedPrice && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="font-medium tabular-nums text-text-1"
                title={
                  partial
                    ? t('shopping:stats.priceCoverageHint', {
                        priced: stats.itemsWithPriceCount,
                        remaining: stats.remaining,
                      })
                    : undefined
                }
                data-testid="shopping-header-remaining-price"
              >
                {renderedPrice}
                {partial && (
                  <span className="ml-1 inline-flex" aria-hidden="true">
                    <svg
                      viewBox="0 0 16 16"
                      width="11"
                      height="11"
                      fill="currentColor"
                      className="text-text-3"
                    >
                      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm.75-4.25a.75.75 0 0 1-1.5 0V5a.75.75 0 0 1 1.5 0v2.75Z" />
                    </svg>
                  </span>
                )}
                {partial && (
                  <span className="sr-only">
                    {t('shopping:stats.priceCoverageHint', {
                      priced: stats.itemsWithPriceCount,
                      remaining: stats.remaining,
                    })}
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      )}
    </header>
  );
}

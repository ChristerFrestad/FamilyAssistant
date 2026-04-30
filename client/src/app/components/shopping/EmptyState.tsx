// Empty-state for the Shopping screen. Two variants:
//
//   - 'no-list'   — no active list exists for the current week.
//                   Primary CTA: "Generer fra ukens middager".
//                   Secondary path: QuickAdd (rendered by parent).
//   - 'no-items'  — list exists but is empty (e.g. user deleted
//                   everything). Just a hint pointing at the
//                   QuickAdd input.
//
// Variant 'week-not-complete' is rendered separately when the
// generate call rejects with WEEK_NOT_COMPLETE — the parent is
// responsible for that surface so this component does not need to
// know about generation failure paths.

import { useTranslation } from 'react-i18next';
import { Card } from '../layout/Card';
import { Button } from '../base/Button';

export type EmptyStateVariant = 'no-list' | 'no-items';

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** Called when the user activates the "Generate from meals" CTA. */
  onGenerate?: () => void | Promise<void>;
  /** Whether generation is currently running (disables the CTA). */
  generating?: boolean;
}

export function EmptyState({
  variant,
  onGenerate,
  generating = false,
}: EmptyStateProps): JSX.Element {
  const { t } = useTranslation(['shopping']);

  if (variant === 'no-list') {
    return (
      <Card
        padding="lg"
        className="flex flex-col items-center gap-3 text-center"
        data-testid="shopping-empty-no-list"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-mint/15 text-mint">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="20" r="1.5" />
            <circle cx="17" cy="20" r="1.5" />
            <path d="M3 4h2l2.4 11.5a1 1 0 0 0 1 .8h8.4a1 1 0 0 0 1-.8L20 8H6" />
          </svg>
        </div>
        <h2 className="font-display text-display-sm text-text-1">
          {t('shopping:empty.noListTitle')}
        </h2>
        <p className="max-w-sm font-body text-body text-text-2">{t('shopping:empty.noListBody')}</p>
        {onGenerate && (
          <Button
            variant="primary"
            size="md"
            onClick={() => void onGenerate()}
            loading={generating}
            data-testid="shopping-generate-cta"
          >
            {t('shopping:actions.generateFromMeals')}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card
      padding="lg"
      className="flex flex-col items-center gap-2 text-center"
      data-testid="shopping-empty-no-items"
    >
      <h2 className="font-display text-display-sm text-text-1">
        {t('shopping:empty.noItemsTitle')}
      </h2>
      <p className="max-w-sm font-body text-body text-text-2">{t('shopping:empty.noItemsBody')}</p>
    </Card>
  );
}

// Category section that wraps a list of ShoppingItemRow.
//
// Header shows category name + count of remaining (un-bought) items
// + sum of remaining prices when any item carries an estPrice. The
// dot-marker on the left mirrors the mockup's accent system: stable
// colour-mapping per category with a deterministic fallback.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../layout/Card';
import { Badge, type BadgeVariant } from '../display/Badge';
import { ShoppingItemRow } from './ShoppingItemRow';
import type { ShoppingItem } from '../../shopping/shoppingApi';

export interface CategoryGroupProps {
  category: string;
  items: ShoppingItem[];
  onToggle: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  formatPrice?: (kr: number) => string;
}

const ACCENTS: BadgeVariant[] = ['mint', 'coral', 'cyan', 'amber', 'rose'];

// Stable category → accent mapping. Hash via simple char-sum so the
// same category name always renders the same accent across screens.
function categoryAccent(name: string): BadgeVariant {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return ACCENTS[sum % ACCENTS.length] as BadgeVariant;
}

// Known enum-keys that get localised display text. Manual items default
// to 'other' on the backend; future migration of seed-data categories
// (currently Norwegian strings like 'Frukt & grønt') is tracked in
// design-gaps.md and would expand this set. Anything not in the set
// passes through unchanged so existing seed-data renders without
// regression while we migrate gradually.
const KNOWN_CATEGORY_KEYS = new Set([
  'other',
  'produce',
  'meat',
  'dairy',
  'pantry',
  'frozen',
  'beverage',
  'household',
]);

function isKnownCategoryKey(key: string): boolean {
  return KNOWN_CATEGORY_KEYS.has(key);
}

export function CategoryGroup({
  category,
  items,
  onToggle,
  onDelete,
  formatPrice,
}: CategoryGroupProps): JSX.Element {
  const { t } = useTranslation(['shopping']);
  const accent = useMemo(() => categoryAccent(category), [category]);
  const displayCategory = isKnownCategoryKey(category)
    ? t(`shopping:categories.${category}`)
    : category;

  let remaining = 0;
  let remainingPriceSum = 0;
  for (const it of items) {
    if (!it.checkedOff) {
      remaining++;
      if (typeof it.estPrice === 'number' && it.estPrice > 0) {
        remainingPriceSum += it.estPrice;
      }
    }
  }
  const showPrice = remainingPriceSum > 0;
  const renderedPrice = showPrice
    ? formatPrice
      ? formatPrice(remainingPriceSum)
      : `${Math.round(remainingPriceSum)} kr`
    : null;

  return (
    <Card padding="none" border={true} className="overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-stroke bg-canvas-1 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Badge variant={accent} dot />
          <h3 className="truncate font-body text-meta font-medium text-text-1">
            {displayCategory}
          </h3>
          <span className="font-body text-meta text-text-3">
            {t('shopping:category.remaining', { count: remaining })}
          </span>
        </div>
        {renderedPrice && (
          <div className="flex-shrink-0 font-body text-meta tabular-nums text-text-3">
            {renderedPrice}
          </div>
        )}
      </header>
      <div role="list">
        {items.map((it) => (
          <div role="listitem" key={it.id}>
            <ShoppingItemRow
              item={it}
              onToggle={onToggle}
              onDelete={onDelete}
              {...(formatPrice ? { formatPrice } : {})}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

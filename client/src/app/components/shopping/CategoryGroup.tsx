// Category section that wraps a list of ShoppingItemRow.
//
// Header shows category name + count of remaining (un-bought) items
// + sum of remaining prices when any item carries an estPrice. The
// dot-marker on the left mirrors the mockup's accent system: stable
// colour-mapping per category with a deterministic fallback.

import type { JSX } from 'react';
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
// to 'other' on the backend; seed-data + recipe-derived rows still arrive
// as Norwegian strings ('Kjøtt & fisk', 'Meieri', ...). The Norwegian
// strings are mapped to enum keys via NORWEGIAN_CATEGORY_TO_KEY below
// so they pick up the same i18n translations.
const KNOWN_CATEGORY_KEYS = new Set([
  'other',
  'produce',
  'meat',
  'dairy',
  'pantry',
  'frozen',
  'beverage',
  'household',
  // Added 2026-05-03 to cover Norwegian seed-data categories without
  // requiring a backend migration. When the seed-data category strings
  // are eventually replaced with enum-keys (see design-gaps.md), the
  // Norwegian-to-key map can shrink and these keys keep working.
  'bakery',
  'children',
  'personal_care',
  'kitchen',
  'dry_goods',
]);

// Maps Norwegian category strings used by seed.products[].category and
// shopping-list.service.CATEGORY_ORDER to enum keys for i18n. The
// backend has not migrated to enum-keys yet (tracked in design-gaps.md);
// this map lets the English UI show "Meat & fish" etc. without a
// migration.
const NORWEGIAN_CATEGORY_TO_KEY: Record<string, string> = {
  'Kjøtt & fisk': 'meat',
  Meieri: 'dairy',
  'Frukt & grønt': 'produce',
  'Brød & bakst': 'bakery',
  'Tørrvarer & annet': 'dry_goods',
  Drikkevarer: 'beverage',
  Husholdning: 'household',
  Barn: 'children',
  'Personlig pleie': 'personal_care',
  Kjøkken: 'kitchen',
};

function resolveCategoryKey(input: string): string | null {
  if (KNOWN_CATEGORY_KEYS.has(input)) return input;
  return NORWEGIAN_CATEGORY_TO_KEY[input] ?? null;
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
  const resolvedKey = resolveCategoryKey(category);
  const displayCategory = resolvedKey ? t(`shopping:categories.${resolvedKey}`) : category;

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

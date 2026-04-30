// Quick-add input for pantry — sticky-bottom input with name + qty +
// unit + submit button. Mirrors shopping QuickAddInput-pattern but is
// intentionally lighter: no autocomplete in pilot-MVP (post-pilot uses
// GET /api/pantry/suggest).
//
// Default qty = 1, default unit empty (backend resolves via product
// catalog or falls back to 'stk'). Name is required; the others are
// optional and pass straight to backend.

import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { PantryAddBody } from '../../pantry/pantryApi';

export interface QuickAddPantryProps {
  onAdd: (body: PantryAddBody) => Promise<unknown>;
}

export function QuickAddPantry({ onAdd }: QuickAddPantryProps): JSX.Element {
  const { t } = useTranslation('pantry');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmedName = name.trim();
  const qtyParsed = (() => {
    const cleaned = qty.replace(',', '.').trim();
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const ready = trimmedName.length > 0 && qtyParsed !== null && !submitting;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!ready || qtyParsed === null) return;
    setSubmitting(true);
    try {
      const body: PantryAddBody = {
        query: trimmedName,
        qty: qtyParsed,
      };
      const trimmedUnit = unit.trim();
      if (trimmedUnit) body.unit = trimmedUnit;
      const result = await onAdd(body);
      // Reset on success only. The parent (usePantryData.addItem) returns
      // null on failure and surfaces userFacingError; if a caller wires a
      // raw API call that throws instead, swallow here so we still keep
      // the form populated for retry.
      if (result != null) {
        setName('');
        setQty('1');
        setUnit('');
      }
    } catch {
      // Parent surfaces the error; keep inputs so the user can retry.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex items-center gap-2 rounded-pill border border-stroke bg-surface px-3 py-2"
      data-testid="pantry-quick-add"
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('quickAdd.namePlaceholder')}
        aria-label={t('quickAdd.namePlaceholder')}
        className="flex-1 min-w-0 bg-transparent font-body text-body text-text-1 focus:outline-none"
        data-testid="pantry-quick-add-name"
      />
      <input
        type="text"
        inputMode="decimal"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder={t('quickAdd.qtyPlaceholder')}
        aria-label={t('quickAdd.qtyPlaceholder')}
        className="w-14 bg-transparent font-mono text-meta text-text-2 tabular-nums focus:outline-none"
        data-testid="pantry-quick-add-qty"
      />
      <input
        type="text"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        placeholder={t('quickAdd.unitPlaceholder')}
        aria-label={t('quickAdd.unitPlaceholder')}
        className="w-14 bg-transparent font-body text-meta text-text-2 focus:outline-none"
        data-testid="pantry-quick-add-unit"
      />
      <button
        type="submit"
        disabled={!ready}
        aria-label={t('quickAdd.submit')}
        className={[
          'inline-flex items-center justify-center rounded-pill h-7 w-7',
          'bg-mint text-ink-contrast disabled:opacity-50 disabled:cursor-not-allowed',
          'hover:bg-mint-deep transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
        ].join(' ')}
        data-testid="pantry-quick-add-submit"
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </form>
  );
}

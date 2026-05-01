// "Marker brukt"-dialog (Christer-bekreftet B3, overstyrer mockup).
//
// Lar brukeren registrere hvor mye av en pantry-item de har brukt. Tre
// quick-buttons (1/4, 1/2, Alt) som setter input-feltet, pluss manuelt
// nummer-input. Validering: 0 < amount <= remaining. Submit disabled når
// validering feiler. Quick-button verdier rundes til 1 desimal.
//
// Komponenten er ren presentation; den vet ingenting om backend. Parent
// (PantryView) eier mutasjons-kallet og lukker dialogen ved suksess.

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../overlay/Modal';
import { Button } from '../base/Button';
import type { PantryItem as PantryItemType } from '../../pantry/pantryApi';

export interface UseDialogProps {
  /** When null the dialog is closed. */
  item: PantryItemType | null;
  onClose: () => void;
  onConfirm: (item: PantryItemType, amountUsed: number) => Promise<void> | void;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return roundOne(value).toString().replace('.', ',');
}

/** Parse input string into a number, accepting both '.' and ',' as decimal sep. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(',', '.').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function UseDialog({ item, onClose, onConfirm }: UseDialogProps): JSX.Element {
  const { t } = useTranslation('pantry');
  const open = item !== null;
  // Default amount = remaining ("Alt"). Reset when a new item opens.
  const [raw, setRaw] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (item) {
      setRaw(formatNumber(item.quantity));
      setSubmitting(false);
    }
  }, [item]);

  const remaining = item?.quantity ?? 0;
  const unit = item?.unit ?? '';
  const hasUnit = unit.trim().length > 0;
  const parsed = parseAmount(raw);

  const validation = useMemo(() => {
    if (parsed === null) return { ok: false, message: '' as string };
    if (parsed <= 0) {
      return { ok: false, message: t('useDialog.validation.tooLittle') };
    }
    if (parsed > remaining) {
      const message = hasUnit
        ? t('useDialog.validation.tooMuch', {
            remaining: formatNumber(remaining),
            unit,
          })
        : t('useDialog.validation.tooMuchNoUnit', { remaining: formatNumber(remaining) });
      return { ok: false, message };
    }
    return { ok: true, message: '' as string };
  }, [parsed, remaining, hasUnit, unit, t]);

  const subtitle = item
    ? hasUnit
      ? t('useDialog.subtitle', {
          name: item.name,
          remaining: formatNumber(remaining),
          unit,
        })
      : t('useDialog.subtitleNoUnit', {
          name: item.name,
          remaining: formatNumber(remaining),
        })
    : '';

  function handleQuick(fraction: 'quarter' | 'half' | 'all'): void {
    if (!item) return;
    let amount: number;
    if (fraction === 'quarter') amount = roundOne(remaining / 4);
    else if (fraction === 'half') amount = roundOne(remaining / 2);
    else amount = remaining;
    if (amount <= 0) amount = remaining;
    setRaw(formatNumber(amount));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!item || !validation.ok || parsed === null || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(item, parsed);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  // exactOptionalPropertyTypes: only forward `description` when
  // we have a non-empty one. Passing `description={undefined}` clashes
  // with Modal's `description?: string` typing under that flag.
  const descriptionProp = subtitle ? { description: subtitle } : {};

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('useDialog.title')}
      position="center"
      size="sm"
      {...descriptionProp}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        {item && (
          <>
            <div className="flex gap-2" role="group" aria-label={t('useDialog.amountLabel')}>
              <button
                type="button"
                onClick={() => handleQuick('quarter')}
                className="flex-1 rounded-pill border border-stroke bg-surface px-3 py-2 font-body text-meta hover:bg-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
                data-testid="use-dialog-quarter"
              >
                {t('useDialog.quickQuarter')}
              </button>
              <button
                type="button"
                onClick={() => handleQuick('half')}
                className="flex-1 rounded-pill border border-stroke bg-surface px-3 py-2 font-body text-meta hover:bg-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
                data-testid="use-dialog-half"
              >
                {t('useDialog.quickHalf')}
              </button>
              <button
                type="button"
                onClick={() => handleQuick('all')}
                className="flex-1 rounded-pill border border-stroke bg-surface px-3 py-2 font-body text-meta hover:bg-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
                data-testid="use-dialog-all"
              >
                {t('useDialog.quickAll')}
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-body text-meta text-text-2">
                {t('useDialog.amountLabel')}
                {hasUnit ? ` (${unit})` : ''}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                aria-invalid={!validation.ok}
                aria-describedby={!validation.ok ? 'use-dialog-validation' : undefined}
                className="rounded-md border border-stroke bg-canvas-0 px-3 py-2 font-body text-body text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
                data-testid="use-dialog-input"
                autoFocus
              />
              {!validation.ok && validation.message && (
                <span
                  id="use-dialog-validation"
                  className="font-body text-meta text-coral-deep"
                  data-testid="use-dialog-validation"
                  role="alert"
                >
                  {validation.message}
                </span>
              )}
            </label>

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                data-testid="use-dialog-cancel"
              >
                {t('useDialog.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!validation.ok || submitting}
                data-testid="use-dialog-confirm"
              >
                {t('useDialog.confirm')}
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

// Sprint 6 — MarkCookedDialog.
//
// Opens after the user taps "Marker tilberedt" on the MealHero. The
// dialog shows one editable row per recipe ingredient that has a
// pantry link, lets the user adjust amounts inline, uncheck rows to
// skip them, and ends with one of three terminal actions:
//   - Confirm  → POST apply-deduction with the edited rows
//   - Skip     → close dialog. Meal stays cooked, pantry unchanged
//   - Cancel   → POST unmark-eaten to roll status back, then close
//
// Pure presentation; the parent (Meals screen) owns fetching and
// mutation through usePantryDeduction. We render whatever the parent
// passes via the `state` prop.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../overlay/Modal';
import { Button } from '../base/Button';
import type {
  ApplyDeductionResponse,
  DeductionItem,
  MealDeductionSuggestion,
} from '../../meals/mealsApi';

export interface MarkCookedDialogState {
  open: boolean;
  loading: boolean;
  error: string | null;
  applying: boolean;
  applyError: string | null;
  mealId: number | null;
  suggestions: MealDeductionSuggestion[];
  /** Flash message shown after a successful apply / skip. */
  resultMessage: string | null;
  /** Optional summary of low-stock-trigger items added to shopping. */
  lowStockCount: number;
}

export interface MarkCookedDialogProps {
  state: MarkCookedDialogState;
  onConfirm: (items: DeductionItem[]) => Promise<ApplyDeductionResponse | null>;
  onSkip: () => void;
  onCancel: () => Promise<void> | void;
  onClose: () => void;
}

interface RowState {
  productKey: string;
  name: string;
  unit: string | null;
  remaining: number;
  amount: string;
  skipped: boolean;
  matched: boolean;
  optional: boolean;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return (Math.round(value * 10) / 10).toString().replace('.', ',');
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(',', '.').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function MarkCookedDialog({
  state,
  onConfirm,
  onSkip,
  onCancel,
  onClose,
}: MarkCookedDialogProps): JSX.Element {
  const { t } = useTranslation('meals');

  const initialRows = useMemo<RowState[]>(() => {
    return state.suggestions
      .filter((s) => s.productKey !== null)
      .map<RowState>((s) => ({
        productKey: s.productKey as string,
        name: s.name,
        unit: s.pantryUnit,
        remaining: s.pantryRemaining,
        amount: formatNumber(s.suggestedDeduction),
        // Default to checked when there's something to deduct, unchecked
        // when the suggestion is zero (e.g. nothing in pantry).
        skipped: !s.matched || s.suggestedDeduction <= 0,
        matched: s.matched,
        optional: s.optional,
      }));
  }, [state.suggestions]);

  const [rows, setRows] = useState<RowState[]>(initialRows);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const matchedCount = rows.filter((r) => r.matched).length;

  function setAmount(idx: number, value: string): void {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, amount: value } : r)));
  }

  function toggleSkip(idx: number): void {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, skipped: !r.skipped } : r)));
  }

  async function handleConfirm(): Promise<void> {
    const items: DeductionItem[] = [];
    for (const row of rows) {
      if (row.skipped) continue;
      if (!row.matched) continue;
      const parsed = parseAmount(row.amount);
      if (parsed === null) continue;
      if (parsed <= 0) continue;
      const clamped = Math.min(parsed, row.remaining);
      items.push({ productKey: row.productKey, amountToDeduct: clamped });
    }
    await onConfirm(items);
  }

  return (
    <Modal
      open={state.open}
      onClose={onClose}
      title={t('cookedDialog.title')}
      description={t('cookedDialog.description')}
      position="center"
      size="md"
    >
      {state.loading ? (
        <p
          role="status"
          aria-live="polite"
          className="font-body text-body text-text-2"
          data-testid="mark-cooked-loading"
        >
          {t('cookedDialog.loading')}
        </p>
      ) : null}

      {!state.loading && state.error ? (
        <p
          role="alert"
          className="font-body text-body text-coral-deep"
          data-testid="mark-cooked-load-error"
        >
          {state.error}
        </p>
      ) : null}

      {!state.loading && !state.error ? (
        <>
          {matchedCount === 0 ? (
            <p className="font-body text-body text-text-2" data-testid="mark-cooked-empty-matched">
              {t('cookedDialog.emptyMatched')}
            </p>
          ) : (
            <ul
              className="flex flex-col gap-3"
              data-testid="mark-cooked-row-list"
              aria-label={t('cookedDialog.amountLabel')}
            >
              {rows.map((row, idx) => (
                <Row
                  key={row.productKey}
                  row={row}
                  index={idx}
                  onAmountChange={(value) => setAmount(idx, value)}
                  onToggleSkip={() => toggleSkip(idx)}
                />
              ))}
            </ul>
          )}

          {state.applyError ? (
            <p
              role="alert"
              className="mt-3 font-body text-meta text-coral-deep"
              data-testid="mark-cooked-apply-error"
            >
              {state.applyError}
            </p>
          ) : null}

          {state.resultMessage ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 font-body text-meta text-mint-deep"
              data-testid="mark-cooked-result"
            >
              {state.resultMessage}
              {state.lowStockCount > 0 ? (
                <> {t('cookedDialog.lowStock', { count: state.lowStockCount })}</>
              ) : null}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onCancel()}
              disabled={state.applying}
              data-testid="mark-cooked-cancel"
            >
              {t('cookedDialog.cancel')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onSkip}
              disabled={state.applying}
              data-testid="mark-cooked-skip"
            >
              {t('cookedDialog.skip')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleConfirm()}
              disabled={state.applying || matchedCount === 0}
              data-testid="mark-cooked-confirm"
            >
              {t('cookedDialog.confirm')}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

interface RowProps {
  row: RowState;
  index: number;
  onAmountChange: (value: string) => void;
  onToggleSkip: () => void;
}

function Row({ row, index, onAmountChange, onToggleSkip }: RowProps): JSX.Element {
  const { t } = useTranslation('meals');
  const parsed = parseAmount(row.amount);
  const overage = parsed !== null && parsed > row.remaining;
  const negative = parsed !== null && parsed < 0;
  const haveLabel =
    row.unit && row.unit.trim().length > 0
      ? t('cookedDialog.have', { remaining: formatNumber(row.remaining), unit: row.unit })
      : t('cookedDialog.haveNoUnit', { remaining: formatNumber(row.remaining) });
  const inputId = `mark-cooked-row-${index}-amount`;
  const skipId = `mark-cooked-row-${index}-skip`;
  return (
    <li
      className="flex flex-col gap-1 rounded-md border border-stroke p-3"
      data-testid={`mark-cooked-row-${row.productKey}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-body text-body text-text-1">{row.name}</span>
          {row.matched ? (
            <span className="font-body text-meta text-text-3">{haveLabel}</span>
          ) : (
            <span className="font-body text-meta text-text-3">
              {t('cookedDialog.noPantryLink')}
            </span>
          )}
        </div>
        {row.matched ? (
          <label className="flex items-center gap-2 font-body text-meta text-text-2">
            <input
              id={skipId}
              type="checkbox"
              checked={row.skipped}
              onChange={onToggleSkip}
              data-testid={`mark-cooked-skip-${row.productKey}`}
            />
            {t('cookedDialog.skipRow')}
          </label>
        ) : null}
      </div>
      {row.matched && !row.skipped ? (
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            {t('cookedDialog.amountLabel')}
          </label>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            value={row.amount}
            onChange={(e) => onAmountChange(e.target.value)}
            aria-invalid={overage || negative}
            className="w-24 rounded-md border border-stroke bg-canvas-0 px-2 py-1 font-body text-body text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            data-testid={`mark-cooked-amount-${row.productKey}`}
          />
          {row.unit ? <span className="font-body text-meta text-text-2">{row.unit}</span> : null}
        </div>
      ) : null}
      {overage ? (
        <span className="font-body text-meta text-amber-deep">
          {t('cookedDialog.exceedsPantry')}
        </span>
      ) : null}
      {negative ? (
        <span className="font-body text-meta text-coral-deep" role="alert">
          {t('cookedDialog.validation.negative')}
        </span>
      ) : null}
    </li>
  );
}

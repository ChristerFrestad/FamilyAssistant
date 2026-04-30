// Sticky bottom input for adding new items to the shopping list.
//
// Single-field for pilot-MVP: the name. Qty + unit are deferred to
// the Sprint 6+ inline-edit flow tracked in design-gaps.md. Form-
// submit (Enter or button click) calls onAdd; the parent handles
// the API call and clears the field on success.
//
// Disabled when there is no active list — the parent surfaces a
// hint that says "generate from meals first".

import { type FormEvent, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../form/Input';
import { Button } from '../base/Button';

export interface QuickAddInputProps {
  /** Called with the trimmed name. Returns the saved item-id (or null on failure). */
  onAdd: (name: string) => Promise<unknown | null>;
  /** When false, the input is disabled and shows a hint. */
  enabled: boolean;
  /** Localised hint shown below the input when disabled. */
  disabledHint?: string;
  /** Whether to focus the input on mount (e.g. from empty-state). */
  autoFocus?: boolean;
}

export function QuickAddInput({
  onAdd,
  enabled,
  disabledHint,
  autoFocus = false,
}: QuickAddInputProps): JSX.Element {
  const { t } = useTranslation(['shopping', 'common']);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && enabled && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus, enabled]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || submitting || !enabled) return;
    setSubmitting(true);
    try {
      const result = await onAdd(trimmed);
      if (result != null) {
        setValue('');
        // Refocus so the user can enter the next item without lifting their hands.
        inputRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="sticky bottom-0 z-10 border-t border-stroke bg-canvas-0/95 px-4 pb-3 pt-3 backdrop-blur-sm"
      data-testid="shopping-quickadd"
    >
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('shopping:quickAdd.placeholder')}
          disabled={!enabled || submitting}
          aria-label={t('shopping:quickAdd.placeholder')}
          maxLength={200}
          className="flex-1"
          data-testid="shopping-quickadd-input"
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={!enabled || submitting || value.trim() === ''}
          loading={submitting}
          data-testid="shopping-quickadd-submit"
        >
          {t('shopping:quickAdd.submit')}
        </Button>
      </div>
      {!enabled && disabledHint && (
        <p className="mt-2 font-body text-meta text-text-3" role="status">
          {disabledHint}
        </p>
      )}
    </form>
  );
}

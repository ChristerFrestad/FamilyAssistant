// Inline-edit pattern for short text fields.
//
// Read-mode shows the value + an "Edit" button. Edit-mode swaps to an
// input + Save/Cancel buttons. Enter submits, Escape cancels, blur
// follows the parent's `submitOnBlur` preference (we default to false
// because pilot users expect explicit Save).
//
// Validation runs on the trimmed value with two checks:
//   - Empty (after trim) → "tooShort"
//   - Length > maxLength → "tooLong"
// The component never sends an API call itself; the parent's onSave
// returns a boolean indicating success, and we exit edit-mode when
// it does. On failure the input stays mounted so the user can fix
// the value without retyping.

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '../base/Button';

export interface InlineEditableTextProps {
  /** Current persisted value. */
  value: string;
  /** Returns true when the save succeeded so the row can exit edit-mode. */
  onSave: (next: string) => Promise<boolean> | boolean;
  /** Already-translated label for the edit-button (read-mode only). */
  editLabel: string;
  /** Already-translated label for the save-button. */
  saveLabel: string;
  /** Already-translated label for the cancel-button. */
  cancelLabel: string;
  /** aria-label for the input. */
  inputAriaLabel: string;
  /** Maximum character count. Defaults to 100 (matches family.name backend). */
  maxLength?: number;
  /** When true (default false), losing focus calls Save instead of Cancel. */
  submitOnBlur?: boolean;
  /** When true the row is read-only and the Edit button is hidden. */
  readOnly?: boolean;
  /** Optional already-translated read-only hint shown next to the value. */
  readOnlyHint?: string;
}

export function InlineEditableText({
  value,
  onSave,
  editLabel,
  saveLabel,
  cancelLabel,
  inputAriaLabel,
  maxLength = 100,
  submitOnBlur = false,
  readOnly = false,
  readOnlyHint,
}: InlineEditableTextProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEdit(): void {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  }

  function cancel(): void {
    setDraft(value);
    setEditing(false);
  }

  async function commit(): Promise<void> {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onSave(trimmed);
      if (ok) setEditing(false);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    void commit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2" data-testid="inline-editable-readmode">
        <span
          className="font-body text-body text-text-1 truncate"
          data-testid="inline-editable-value"
        >
          {value}
        </span>
        {readOnly && readOnlyHint && (
          <span className="font-body text-meta text-text-3">{readOnlyHint}</span>
        )}
        {!readOnly && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={startEdit}
            data-testid="inline-editable-edit"
          >
            {editLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2"
      data-testid="inline-editable-editmode"
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (submitOnBlur) void commit();
        }}
        onKeyDown={handleKeyDown}
        maxLength={maxLength}
        aria-label={inputAriaLabel}
        className="flex-1 min-w-0 rounded-md border border-stroke bg-canvas-0 px-3 py-1.5 font-body text-body text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
        data-testid="inline-editable-input"
      />
      <Button
        type="submit"
        variant="primary"
        size="sm"
        loading={submitting}
        disabled={submitting || draft.trim().length === 0 || draft.trim().length > maxLength}
        data-testid="inline-editable-save"
      >
        {saveLabel}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={cancel}
        disabled={submitting}
        data-testid="inline-editable-cancel"
      >
        {cancelLabel}
      </Button>
    </form>
  );
}

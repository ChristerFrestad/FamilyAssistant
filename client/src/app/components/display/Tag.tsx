// Larger sibling of Badge for category / filter / chip-style usage.
// Two modes:
//   - Default     — read-only pill with text content.
//   - Removable   — adds a real <button> with a × glyph for the
//                    user to dismiss the tag. The button is a real
//                    <button>, never a <span onClick>, so it is
//                    keyboard-focusable and announced as
//                    "removable" by assistive tech.
//
// Defensive rendering rule: the remove button only appears when
// BOTH `removable={true}` and `onRemove` are supplied. This means
// `<Tag removable />` without an onRemove is a silent no-op — no
// dead button in the DOM, no thrown error. Tests cover the rule.
//
// Accessibility: the remove button has `aria-label` defaulting to
// "Fjern". Override via `removeLabel` when more context helps the
// screen reader (e.g. `removeLabel="Fjern allergi: Nøtter"` for a
// dietary-restriction tag where the bare "Fjern" alone is too
// ambiguous in a list of removable controls).
//
// Variant text color follows Badge: `text-ink-contrast` on the
// accent surface — same theme-safe pattern Button proved out.

import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';

export type TagVariant = 'mint' | 'cyan' | 'amber' | 'coral' | 'rose';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /** Accent color. Defaults to 'cyan'. */
  variant?: TagVariant;
  /** Tag content. Required — a tag without text has no purpose. */
  children: ReactNode;
  /** When true, render the remove button. Requires `onRemove` to render. */
  removable?: boolean;
  /** Callback fired when the remove button is clicked. */
  onRemove?: () => void;
  /**
   * Aria-label text for the remove button. Defaults to "Fjern".
   * Override when children are non-text and the auto-derived label
   * would be ambiguous.
   */
  removeLabel?: string;
}

const VARIANT_CLASSES: Record<TagVariant, string> = {
  mint: 'bg-mint text-ink-contrast',
  cyan: 'bg-cyan text-ink-contrast',
  amber: 'bg-amber text-ink-contrast',
  coral: 'bg-coral text-ink-contrast',
  rose: 'bg-rose text-ink-contrast',
};

const BASE_CLASSES = [
  'inline-flex items-center gap-1.5',
  'rounded-md',
  'px-3 py-1',
  'font-body text-body',
].join(' ');

const REMOVE_BUTTON_CLASSES = [
  'inline-flex items-center justify-center',
  // Slightly tighter than the tag text so the button sits visually
  // balanced against the label height.
  'h-4 w-4 rounded-full',
  'text-ink-contrast',
  // Use bg-current at low opacity for the hover surface so it
  // tints with the variant accent rather than introducing a new
  // grey tone.
  'hover:bg-ink-contrast/20',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-contrast focus-visible:ring-offset-1',
].join(' ');

export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  {
    variant = 'cyan',
    children,
    removable = false,
    onRemove,
    removeLabel = 'Fjern',
    className,
    ...rest
  },
  ref
): JSX.Element {
  // Both flags must be set to render the remove button. removable
  // alone (without onRemove) is a no-op so consumers can toggle
  // the boolean from feature flags without first wiring a handler.
  const showRemove = removable && typeof onRemove === 'function';
  const cls = [BASE_CLASSES, VARIANT_CLASSES[variant], className].filter(Boolean).join(' ');

  return (
    <span ref={ref} className={cls} {...rest}>
      <span>{children}</span>
      {showRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className={REMOVE_BUTTON_CLASSES}
        >
          {/* U+00D7 multiplication sign — visually balanced against
              text-body without needing a custom SVG. */}
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
});

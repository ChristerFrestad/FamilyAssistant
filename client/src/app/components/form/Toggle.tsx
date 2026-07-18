// Switch-style boolean toggle. Built on a native <input
// type="checkbox" role="switch"> so the keyboard, focus, form
// submission, and aria-checked semantics come from the browser
// rather than being recreated by hand.
//
// Visual recipe (peer pattern):
//   <label>                          <-- relative container
//     <input class="peer sr-only" /> <-- real checkbox, hidden but focusable
//     <span class="track" />         <-- sibling of input; uses peer-checked: for color
//     <span class="thumb" />         <-- sibling of input; absolute-positioned;
//                                        uses peer-checked: for translate-x
//     <span>label / description</span>
//   </label>
//
// Both the track and the thumb are siblings of the input so they
// can use Tailwind's `peer-checked:` modifier to react to the
// input's state without any JSX conditional on `checked`. Tailwind
// `peer-X:` only cascades through the sibling combinator (`~`),
// not into descendants, so the thumb cannot be nested inside the
// track — it has to layer on top of it via absolute positioning.
//
// Sizes (sm/md/lg) match Button and Input so a Stack of mixed
// form controls stays vertically rhythmed.
//
// Disabled visuals come from the input's native :disabled state,
// reflected to track + thumb via peer-disabled:.
//
// Focus visuals: peer-focus-visible:ring-* on the track produces a
// visible mint ring on keyboard focus only — mouse clicks do not
// trigger the ring (matches the focus-visible UX in Button).

import type { JSX } from 'react';
import { type InputHTMLAttributes, forwardRef } from 'react';

export type ToggleSize = 'sm' | 'md' | 'lg';

// We replace `type` (we always want "checkbox"), `onChange` (our
// callback signature is simpler than the native event), and `size`
// (HTML's numeric character-width vs our padding scale, same
// trick as Input).
export interface ToggleProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'size'
> {
  /** Whether the toggle is on. Controlled. */
  checked: boolean;
  /** Fires with the new boolean state. */
  onChange: (checked: boolean) => void;
  /** Optional label rendered to the right of the switch. */
  label?: string;
  /** Optional secondary line under the label. */
  description?: string;
  /** Padding/text-size scale matching Button and Input. Defaults to 'md'. */
  size?: ToggleSize;
}

const TRACK_BASE = [
  'block rounded-full',
  'bg-stroke-strong peer-checked:bg-mint',
  'transition-colors duration-200 ease-out',
  'peer-disabled:opacity-50',
  'peer-focus-visible:ring-2 peer-focus-visible:ring-mint',
  'peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas-0',
].join(' ');

const TRACK_SIZE: Record<ToggleSize, string> = {
  sm: 'w-9 h-5',
  md: 'w-11 h-6',
  lg: 'w-14 h-7',
};

const THUMB_BASE = [
  'absolute top-0.5 left-0.5',
  'rounded-full',
  'bg-canvas-0 shadow-low',
  'transition-transform duration-200 ease-out',
  'peer-disabled:opacity-50',
  // The thumb sits on top of the track. Pointer events should pass
  // through to the label so a click anywhere triggers the native
  // checkbox toggle through the parent <label>.
  'pointer-events-none',
].join(' ');

// Translate distances are derived from track-width minus
// thumb-width minus 2x2 px padding, then converted to Tailwind
// translate-x units (4 px each):
//   sm: 36 - 16 - 4 = 16 px = translate-x-4
//   md: 44 - 20 - 4 = 20 px = translate-x-5
//   lg: 56 - 24 - 4 = 28 px = translate-x-7
const THUMB_SIZE: Record<ToggleSize, string> = {
  sm: 'h-4 w-4 peer-checked:translate-x-4',
  md: 'h-5 w-5 peer-checked:translate-x-5',
  lg: 'h-6 w-6 peer-checked:translate-x-7',
};

const LABEL_TEXT_SIZE: Record<ToggleSize, string> = {
  sm: 'text-meta',
  md: 'text-body',
  lg: 'text-body',
};

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  { checked, onChange, label, description, size = 'md', disabled, className, ...rest },
  ref
): JSX.Element {
  const wrapperCls = [
    'relative inline-flex items-center gap-3',
    disabled ? 'cursor-not-allowed' : 'cursor-pointer',
    'select-none',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={wrapperCls}>
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="peer sr-only"
        {...rest}
      />
      <span className={`${TRACK_BASE} ${TRACK_SIZE[size]}`} aria-hidden="true" />
      <span className={`${THUMB_BASE} ${THUMB_SIZE[size]}`} aria-hidden="true" />
      {label && (
        <span className="flex flex-col">
          <span className={`font-body text-text-1 ${LABEL_TEXT_SIZE[size]}`}>{label}</span>
          {description && <span className="font-body text-meta text-text-2">{description}</span>}
        </span>
      )}
    </label>
  );
});

// Base text-input. A thin wrapper around <input> that adds:
//   - default visual styling (canvas surface, hairline border, focus
//     ring) resolved through design tokens
//   - a size scale (sm | md | lg) matching Button so a Field that
//     pairs Input with Button stays vertically aligned at every size
//   - an error-state border driven by `aria-invalid`, so Field can
//     toggle the visual state by injecting the attribute via
//     cloneElement without Input needing to know about Field
//
// Input does NOT render its own label, hint, or error message. That
// is `Field`'s responsibility, and pairing them keeps each component
// single-purpose:
//
//   <Field label="E-post" hint="Vi sender bekreftelseslenke hit">
//     <Input type="email" placeholder="navn@eksempel.no" />
//   </Field>
//
// Standalone use is still supported — Input has no Field dependency
// — but the typical caller wires it through Field for the
// label/hint/error a11y plumbing.
//
// Background choice: bg-canvas-0 places the input on the deepest
// canvas tone. canvas-1 cards (the most common container in the
// app) end up rendering Input as a subtly recessed surface, which
// matches the form-input convention in the mockup. When Input is
// used standalone on a canvas-0 page, the border still defines the
// boundary even though the bg matches the page.

import { type InputHTMLAttributes, forwardRef } from 'react';

export type InputSize = 'sm' | 'md' | 'lg';

// Native <input> has a `size` HTML attribute (numeric, controls the
// rendered character width). We override the type to expose our own
// scale prop with the same name as Button's. Callers needing the
// native character-width behavior can reach for Tailwind's `w-*`
// utilities via `className` instead.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Padding and text-size scale. Defaults to 'md'. Matches Button. */
  size?: InputSize;
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-meta',
  md: 'px-3 py-2 text-body',
  lg: 'px-4 py-2.5 text-body',
};

// Static base classes shared across sizes and states. Kept as a
// constant so the generated Tailwind utility set is identical from
// render to render — important for tree-shake and for snapshot-style
// tests that compare class strings.
const BASE_CLASSES = [
  'block w-full',
  'rounded-md',
  'bg-canvas-0',
  'text-text-1',
  'placeholder:text-text-3',
  'border',
  'focus:outline-none',
  'focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-canvas-2',
].join(' ');

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', className, 'aria-invalid': ariaInvalid, ...rest },
  ref
): JSX.Element {
  // aria-invalid accepts boolean OR several string values per the
  // ARIA spec ('true', 'false', 'grammar', 'spelling'). Anything
  // truthy that is not the literal string 'false' indicates an
  // invalid state — including 'grammar' and 'spelling' which
  // describe specific kinds of invalidity but should still receive
  // the error visual.
  const isInvalid = Boolean(ariaInvalid) && ariaInvalid !== 'false';
  const borderClass = isInvalid ? 'border-rose' : 'border-stroke';
  const cls = [BASE_CLASSES, SIZE_CLASSES[size], borderClass, className].filter(Boolean).join(' ');

  return <input ref={ref} aria-invalid={ariaInvalid} className={cls} {...rest} />;
});

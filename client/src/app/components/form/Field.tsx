// Form-field wrapper that pairs a label, a single input element, and an
// optional hint or error message. Generates a unique id via React's
// `useId` and wires `htmlFor` on the label plus `aria-describedby` on
// the input so screen readers announce the helper text alongside the
// input value.
//
// Usage:
//
//   <Field label="E-post" hint="Vi sender bekreftelseslenke hit">
//     <input type="email" />
//   </Field>
//
// The component clones the child element to inject:
//   - id              — generated, unless the child already supplies one
//   - required        — propagated from the Field prop
//   - aria-describedby — points to the error message id, or the hint id
//                        when no error is set, or undefined when neither
//   - aria-invalid    — set to true when `error` is present
//
// Any single ReactElement that accepts those props works as a child:
// native <input>, <textarea>, <select>, or a future custom Input
// component. Non-element children (e.g. plain text) are passed through
// unchanged so the component degrades gracefully when used in a way it
// was not designed for.

import { useId, cloneElement, isValidElement, type ReactNode } from 'react';

// Subset of props that Field may inject into the wrapped child. All
// fields are optional because the consumer may opt out of any of them
// by setting an explicit value on the child element first.
//
// The explicit `| undefined` on each property is required because
// tsconfig has `exactOptionalPropertyTypes: true` — under that flag a
// bare `?: string` means "the key may be missing, but if present it
// must be a string". cloneElement's `Partial<P>` then forbids passing
// `undefined` as a value, which is exactly what we need to do when a
// hint or error is absent. Matching React's own InputHTMLAttributes
// convention (`?: T | undefined`) restores the assignable behavior.
interface InjectableInputProps {
  id?: string | undefined;
  required?: boolean | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | 'true' | 'false' | undefined;
}

export interface FieldProps {
  /** Label text rendered above the input. Required for accessibility. */
  label: string;
  /**
   * Optional helper text displayed below the input. Hidden when an
   * error is set so users see the error message instead of stale
   * guidance.
   */
  hint?: string;
  /**
   * Optional error message. Renders in the rose accent and overrides
   * the hint slot. Setting an error also flips `aria-invalid` on the
   * wrapped input.
   */
  error?: string;
  /**
   * Adds a visual asterisk after the label and propagates `required`
   * to the wrapped input unless the child already overrides it.
   */
  required?: boolean;
  /** The input element. Should be a single ReactElement. */
  children: ReactNode;
}

export function Field(props: FieldProps): JSX.Element {
  const { label, hint, error, required = false, children } = props;
  const reactId = useId();
  const inputId = `${reactId}-input`;
  const hintId = `${reactId}-hint`;
  const errorId = `${reactId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  // Resolve the id we will bind both label and input to. Honor an
  // existing id on the child so callers can override the generated one
  // (e.g. when a parent form needs a stable selector for its own
  // tests). Fall back to the generated `inputId` otherwise.
  const childIsElement = isValidElement<InjectableInputProps>(children);
  const childId = childIsElement ? (children.props.id ?? inputId) : inputId;

  const enhancedChild = childIsElement
    ? cloneElement(children, {
        id: childId,
        required: children.props.required ?? required,
        'aria-describedby': children.props['aria-describedby'] ?? describedBy,
        'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined),
      })
    : children;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={childId} className="font-body text-meta text-text-2">
        {label}
        {required && (
          <span className="text-rose ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {enhancedChild}
      {error ? (
        <p id={errorId} role="alert" className="font-body text-meta text-rose">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="font-body text-meta text-text-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

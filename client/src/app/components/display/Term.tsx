// Mono-styled wrapper for code, terminal output, and CLI snippets.
// Two variants:
//   - inline (default) — <code> with a tinted background pill,
//                         used inside flowing prose:
//                         "Run `npm install` to set up deps."
//   - block             — <pre> with full-width tinted block,
//                         horizontal-scroll on overflow, preserved
//                         whitespace. Used for multi-line snippets,
//                         CLI output, and SESSION_SECRET-style
//                         single-token values that need a copy
//                         button next to them.
//
// Term is intentionally NOT a tooltip-glossary — that is a separate
// concern (a future Glossary or DefinedTerm component). Term only
// styles content; it does not annotate it.
//
// Semantics: <code> for inline, <pre> for block. Both browsers
// (and screen readers) treat these as monospace literal content,
// which matches what we render visually.

import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';

export type TermVariant = 'inline' | 'block';
export type TermSize = 'sm' | 'md' | 'lg';

interface TermBaseProps {
  /** The code or terminal text to render. */
  children: ReactNode;
  /** Layout style. Defaults to 'inline'. */
  variant?: TermVariant;
  /** Padding/text-size scale. Defaults to 'md'. */
  size?: TermSize;
  /** Caller-supplied additional classes. */
  className?: string;
}

// We split the prop type by which underlying element renders so the
// passthrough props match the right HTML attribute set. inline ->
// HTMLElement (code is a generic inline element); block ->
// HTMLPreElement.
export type TermProps = TermBaseProps &
  (
    | ({ variant?: 'inline' } & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>)
    | ({ variant: 'block' } & Omit<HTMLAttributes<HTMLPreElement>, 'className' | 'children'>)
  );

const SIZE_CLASSES: Record<TermSize, string> = {
  sm: 'text-label',
  md: 'text-meta',
  lg: 'text-body',
};

const INLINE_BASE = 'font-mono bg-canvas-2 text-text-1 px-1.5 py-0.5 rounded-sm';
const BLOCK_BASE =
  'font-mono bg-canvas-2 text-text-1 p-3 rounded-md overflow-x-auto whitespace-pre';

// forwardRef is split per-variant because the underlying element
// type changes. We expose two named refs through a discriminated
// union so callers get accurate ref types.
export const Term = forwardRef<HTMLElement | HTMLPreElement, TermProps>(
  function Term(props, ref): JSX.Element {
    const { variant = 'inline', size = 'md', className, children, ...rest } = props;
    const sizeCls = SIZE_CLASSES[size];
    if (variant === 'block') {
      const cls = [BLOCK_BASE, sizeCls, className].filter(Boolean).join(' ');
      return (
        <pre ref={ref as React.Ref<HTMLPreElement>} className={cls} {...rest}>
          {children}
        </pre>
      );
    }
    const cls = [INLINE_BASE, sizeCls, className].filter(Boolean).join(' ');
    return (
      <code ref={ref as React.Ref<HTMLElement>} className={cls} {...rest}>
        {children}
      </code>
    );
  }
);

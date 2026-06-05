// Visualises every Button variant against every size, plus the
// disabled / loading states and the leftIcon / rightIcon slots. Each
// row groups one variant so the eye can compare sizes within a row,
// and the dim mono label makes it clear which row is which.
//
// The preview renders the actual `Button` from app/components/base, so
// theme changes propagate the moment the consumer toggles light /
// dark / system in the page header.

import type { JSX } from 'react';
import { Button, type ButtonVariant } from '../../../../app/components/base/Button';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost'];

export default function ButtonPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Button</h3>

      {/* Variant × size grid. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        {VARIANTS.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-3">
            <code className="font-mono text-label text-text-3 min-w-[6rem]">{variant}</code>
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant} size="md">
              Medium
            </Button>
            <Button variant={variant} size="lg">
              Large
            </Button>
          </div>
        ))}
      </div>

      {/* Disabled and loading states across the three variants. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <code className="font-mono text-label text-text-3 min-w-[6rem]">disabled</code>
          <Button variant="primary" disabled>
            Primary
          </Button>
          <Button variant="secondary" disabled>
            Secondary
          </Button>
          <Button variant="ghost" disabled>
            Ghost
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <code className="font-mono text-label text-text-3 min-w-[6rem]">loading</code>
          <Button variant="primary" loading>
            Primary
          </Button>
          <Button variant="secondary" loading>
            Secondary
          </Button>
          <Button variant="ghost" loading>
            Ghost
          </Button>
        </div>
      </div>

      {/* Icon slots. The icons are plain emoji nodes here; in app code
          they will typically come from a future Icon component. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <code className="font-mono text-label text-text-3 min-w-[6rem]">leftIcon</code>
          <Button leftIcon={<span aria-hidden="true">🏠</span>}>Hjem</Button>
          <Button variant="secondary" leftIcon={<span aria-hidden="true">⭐</span>}>
            Favoritter
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <code className="font-mono text-label text-text-3 min-w-[6rem]">rightIcon</code>
          <Button rightIcon={<span aria-hidden="true">→</span>}>Neste</Button>
          <Button variant="ghost" rightIcon={<span aria-hidden="true">↗</span>}>
            Åpne
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <code className="font-mono text-label text-text-3 min-w-[6rem]">both</code>
          <Button
            leftIcon={<span aria-hidden="true">⭐</span>}
            rightIcon={<span aria-hidden="true">→</span>}
          >
            Lagre og fortsett
          </Button>
        </div>
      </div>
    </div>
  );
}

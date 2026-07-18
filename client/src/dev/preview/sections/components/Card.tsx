// Visualises the Card surface variants, padding scale, and shadow
// scale. Each example uses simple text content so the visual focus
// stays on the surface itself rather than the children.

import type { JSX } from 'react';
import { Card } from '../../../../app/components/layout/Card';

export default function CardPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Card</h3>

      {/* Variants */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card variant="default">
          <code className="font-mono text-label text-text-3 block">variant=default</code>
          <p className="font-body text-meta text-text-1 mt-1">bg-surface</p>
        </Card>
        <Card variant="strong">
          <code className="font-mono text-label text-text-3 block">variant=strong</code>
          <p className="font-body text-meta text-text-1 mt-1">bg-surface-strong</p>
        </Card>
        <Card variant="glass">
          <code className="font-mono text-label text-text-3 block">variant=glass</code>
          <p className="font-body text-meta text-text-1 mt-1">bg-surface + backdrop-blur</p>
        </Card>
      </div>

      {/* Padding scale */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(['none', 'sm', 'md', 'lg'] as const).map((p) => (
          <Card key={p} padding={p}>
            <code className="font-mono text-label text-text-3 block">padding={p}</code>
            {p === 'none' && (
              <p className="font-body text-meta text-text-1 px-3 py-2">
                Children handle their own padding
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* Shadow scale */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 p-4 bg-canvas-2 rounded-lg">
        {(['none', 'low', 'mid', 'high'] as const).map((s) => (
          <Card key={s} shadow={s} variant="strong">
            <code className="font-mono text-label text-text-3 block">shadow={s}</code>
          </Card>
        ))}
      </div>

      {/* border=false */}
      <Card border={false} variant="default">
        <code className="font-mono text-label text-text-3 block">border=false</code>
        <p className="font-body text-meta text-text-1 mt-1">No hairline border</p>
      </Card>
    </div>
  );
}

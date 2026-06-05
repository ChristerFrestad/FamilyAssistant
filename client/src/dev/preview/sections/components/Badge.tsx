// Badge preview — every accent variant in both pill and dot mode.
// Pill examples use short Norwegian status copy so the preview
// reads the way a real screen would.

import type { JSX } from 'react';
import { Badge, type BadgeVariant } from '../../../../app/components/display/Badge';

const VARIANTS: BadgeVariant[] = ['mint', 'cyan', 'amber', 'coral', 'rose'];

const PILL_LABELS: Record<BadgeVariant, string> = {
  mint: 'Ferdig',
  cyan: 'Ny',
  amber: 'Venter',
  coral: 'Snart utgått',
  rose: 'Manglende',
};

export default function BadgePreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Badge</h3>

      {/* Pill variants */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">pill (default)</code>
        <div className="flex flex-wrap items-center gap-3">
          {VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {PILL_LABELS[v]}
            </Badge>
          ))}
        </div>
      </div>

      {/* Dot variants — typically used as a notification indicator
          stacked on top of an icon or avatar; here shown bare. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">dot mode</code>
        <div className="flex flex-wrap items-center gap-4">
          {VARIANTS.map((v) => (
            <div key={v} className="flex items-center gap-2">
              <Badge variant={v} dot />
              <code className="font-mono text-label text-text-3">{v}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

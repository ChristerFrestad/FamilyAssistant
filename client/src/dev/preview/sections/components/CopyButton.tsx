// CopyButton preview — interactive examples that actually copy
// to the user's clipboard so you can paste elsewhere and verify
// the value made it across. Variants and sizes mirror Button.

import type { JSX } from 'react';
import { CopyButton } from '../../../../app/components/form/CopyButton';
import { Term } from '../../../../app/components/display/Term';

export default function CopyButtonPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">CopyButton</h3>

      {/* Default usage — secondary variant + medium size, paired with a Term */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          default (secondary / md) — paired with a Term
        </code>
        <div className="flex flex-wrap items-center gap-3">
          <Term>SESSION_SECRET=nb-2026-04-28-X9k2pQrL7vH3mN8t</Term>
          <CopyButton value="SESSION_SECRET=nb-2026-04-28-X9k2pQrL7vH3mN8t" />
        </div>
      </div>

      {/* Variants */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">variants</code>
        <div className="flex flex-wrap items-center gap-3">
          <CopyButton value="primary-test" variant="primary" />
          <CopyButton value="secondary-test" variant="secondary" />
          <CopyButton value="ghost-test" variant="ghost" />
        </div>
      </div>

      {/* Sizes */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">sizes</code>
        <div className="flex flex-wrap items-center gap-3">
          <CopyButton value="small-test" size="sm" />
          <CopyButton value="medium-test" size="md" />
          <CopyButton value="large-test" size="lg" />
        </div>
      </div>

      {/* Custom labels */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          custom labels + 500ms cooldown
        </code>
        <CopyButton value="custom-test" label="Hent token" copiedLabel="Hentet ✓" duration={500} />
      </div>
    </div>
  );
}

// PageShell preview — three max-width tiers with dummy content
// inside a dashed-border so the shell boundary is visible. Compact
// is shown as its own row to demonstrate the py-4 vs py-8 swap.

import type { JSX } from 'react';
import { PageShell, type PageShellMaxWidth } from '../../../../app/components/layout/PageShell';

const TIERS: PageShellMaxWidth[] = ['sm', 'md', 'lg'];

function Filler({ label }: { label: string }): JSX.Element {
  return (
    <div className="border border-dashed border-stroke-strong rounded-md bg-canvas-1 p-4">
      <p className="font-body text-meta text-text-2">{label}</p>
    </div>
  );
}

export default function PageShellPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">PageShell</h3>

      <div className="bg-canvas-2 rounded-md p-2 space-y-2">
        {TIERS.map((tier) => (
          <PageShell key={tier} maxWidth={tier} className="bg-canvas-1 rounded-md">
            <Filler label={`maxWidth=${tier} (default py-8)`} />
          </PageShell>
        ))}

        <PageShell maxWidth="md" compact className="bg-canvas-1 rounded-md">
          <Filler label="compact=true (py-4) — typical for auth-flow density" />
        </PageShell>
      </div>
    </div>
  );
}

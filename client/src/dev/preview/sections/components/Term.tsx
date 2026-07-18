// Term preview — inline usage inside flowing prose, block usage for
// CLI snippets and tokens, all three sizes for both variants.

import type { JSX } from 'react';
import { Term, type TermSize } from '../../../../app/components/display/Term';

const SIZES: TermSize[] = ['sm', 'md', 'lg'];

export default function TermPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Term</h3>

      {/* Inline — shown in prose so the reader sees the visual fit */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          inline (default) — fits inside prose
        </code>
        <p className="font-body text-body text-text-1">
          Kjør <Term>npm install</Term> for å installere avhengigheter, og deretter{' '}
          <Term>npm run dev:client</Term> for å starte Vite-serveren på port <Term>7778</Term>.
        </p>
      </div>

      {/* Block — multiline CLI output / single-token values */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          block (variant=block) — multiline / wide tokens
        </code>
        <Term variant="block">
          {[
            '# Bootstrap-wizard ferdig.',
            "SESSION_SECRET='nb-2026-04-28-X9k2pQrL7vH3mN8t'",
            '',
            'Lagre verdien et trygt sted før du fortsetter.',
          ].join('\n')}
        </Term>
      </div>

      {/* Sizes — both variants */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">sizes (inline)</code>
        <div className="flex flex-wrap items-baseline gap-3">
          {SIZES.map((s) => (
            <div key={s} className="flex items-baseline gap-2">
              <Term size={s}>npm install</Term>
              <code className="font-mono text-label text-text-3">{s}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

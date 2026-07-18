import type { JSX } from 'react';
// Visual swatches for every color token mapped in tailwind.config.ts.
// Background swatches sit on top of bg-1 cards so even near-bg
// surfaces stay readable. Stroke tokens render as borders on
// dedicated demo boxes. Text tokens render as text samples.

type Swatch = {
  /** Tailwind utility class to apply, e.g. "bg-mint" */
  className: string;
  /** Token name as written in tokens.css, e.g. "--mint" */
  token: string;
};

const BG_SWATCHES: Swatch[] = [
  { className: 'bg-canvas-0', token: '--canvas-0' },
  { className: 'bg-canvas-1', token: '--canvas-1' },
  { className: 'bg-canvas-2', token: '--canvas-2' },
  { className: 'bg-surface', token: '--surface' },
  { className: 'bg-surface-strong', token: '--surface-strong' },
  { className: 'bg-mint', token: '--mint' },
  { className: 'bg-mint-deep', token: '--mint-deep' },
  { className: 'bg-cyan', token: '--cyan' },
  { className: 'bg-cyan-deep', token: '--cyan-deep' },
  { className: 'bg-amber', token: '--amber' },
  { className: 'bg-coral', token: '--coral' },
  { className: 'bg-rose', token: '--rose' },
  { className: 'bg-ink', token: '--ink' },
];

const TEXT_SWATCHES: Swatch[] = [
  { className: 'text-text-1', token: '--text-1' },
  { className: 'text-text-2', token: '--text-2' },
  { className: 'text-text-3', token: '--text-3' },
  { className: 'text-ink-contrast', token: '--ink-contrast' },
];

const STROKE_SWATCHES: Swatch[] = [
  { className: 'border-stroke', token: '--stroke' },
  { className: 'border-stroke-strong', token: '--stroke-strong' },
];

export default function Colors(): JSX.Element {
  return (
    <section id="colors" className="space-y-6">
      <h2 className="font-display text-display-md text-text-1">Colors</h2>

      <div>
        <h3 className="font-body text-meta tracking-wide text-text-2 uppercase mb-3">
          Background tokens
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {BG_SWATCHES.map((s) => (
            <div key={s.token} className="rounded-md overflow-hidden border border-stroke">
              <div className={`${s.className} h-20`} aria-label={`${s.token} swatch`} />
              <div className="bg-canvas-1 px-3 py-2">
                <code className="font-mono text-meta text-text-1">{s.token}</code>
                <div className="font-mono text-label text-text-3">{s.className}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-body text-meta tracking-wide text-text-2 uppercase mb-3">
          Text tokens
        </h3>
        <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-2">
          {TEXT_SWATCHES.map((s) => (
            <div key={s.token} className="flex items-baseline gap-3">
              <span className={`${s.className} font-body text-body`}>Sample text in {s.token}</span>
              <code className="font-mono text-label text-text-3">{s.className}</code>
            </div>
          ))}
          {/* ink-contrast on its own ink background so readability is */}
          {/* obvious; otherwise it would render as the same color as   */}
          {/* the page background.                                      */}
          <div className="bg-ink rounded-md p-3 mt-3">
            <span className="text-ink-contrast font-body text-body">
              Sample text in --ink-contrast on --ink background
            </span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-body text-meta tracking-wide text-text-2 uppercase mb-3">
          Stroke tokens
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {STROKE_SWATCHES.map((s) => (
            <div key={s.token} className={`rounded-md border-2 ${s.className} bg-canvas-1 p-4`}>
              <code className="font-mono text-meta text-text-1">{s.token}</code>
              <div className="font-mono text-label text-text-3">{s.className}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

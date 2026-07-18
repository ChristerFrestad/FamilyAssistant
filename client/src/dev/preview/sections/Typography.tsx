import type { JSX } from 'react';
// Visualises the three font families and the type scale. The pangram
// "The quick brown fox" exercises common ascender/descender shapes;
// a Norwegian sentence with æøå proves the Latin Extended subset
// renders correctly in each face.

const SAMPLE = 'The quick brown fox jumps over the lazy dog';
const SAMPLE_NO = 'Pa bygda spiser vi grøt med blåbær — og rømme.';

type SizeRow = {
  /** Tailwind utility for the size, e.g. "text-hero" */
  className: string;
  /** Token name as written in tokens.css */
  token: string;
};

const SIZES: SizeRow[] = [
  { className: 'text-hero', token: '--text-hero' },
  { className: 'text-screen', token: '--text-screen' },
  { className: 'text-display-md', token: '--text-display-md' },
  { className: 'text-card', token: '--text-card' },
  { className: 'text-day', token: '--text-day' },
  { className: 'text-body', token: '--text-body' },
  { className: 'text-meta', token: '--text-meta' },
  { className: 'text-label', token: '--text-label' },
];

const TRACKING_ROWS = [
  { className: 'tracking-tight', label: 'tracking-tight (-0.02em)' },
  { className: 'tracking-wide', label: 'tracking-wide (0.18em)' },
  { className: 'tracking-wider', label: 'tracking-wider (0.22em)' },
];

const LEADING_ROWS = [
  { className: 'leading-tight', label: 'leading-tight (1.05)' },
  { className: 'leading-snug', label: 'leading-snug (1.2)' },
  { className: 'leading-normal', label: 'leading-normal (1.4)' },
  { className: 'leading-relaxed', label: 'leading-relaxed (1.5)' },
];

const PARAGRAPH =
  'Aktiv ukesplan, handletur og gjøremål — alt på ett sted. ' +
  'FamilyAssistant samler middag, kalender og pantry til én delt opplevelse for hele familien.';

export default function Typography(): JSX.Element {
  return (
    <section id="typography" className="space-y-8">
      <h2 className="font-display text-display-md text-text-1">Typography</h2>

      <div>
        <h3 className="font-body text-meta tracking-wide text-text-2 uppercase mb-3">
          Font families
        </h3>
        <div className="space-y-4">
          <div className="bg-canvas-1 rounded-md border border-stroke p-4">
            <div className="font-mono text-label text-text-3 mb-1">font-display</div>
            <div className="font-display text-card text-text-1">{SAMPLE}</div>
            <div className="font-display text-card text-text-1">{SAMPLE_NO}</div>
            <div className="font-display italic text-card text-text-2 mt-1">
              Italic accent — i kveld spiser vi <em>laks</em>.
            </div>
          </div>

          <div className="bg-canvas-1 rounded-md border border-stroke p-4">
            <div className="font-mono text-label text-text-3 mb-1">font-body</div>
            <div className="font-body text-body text-text-1">{SAMPLE}</div>
            <div className="font-body text-body text-text-1">{SAMPLE_NO}</div>
            <div className="font-body italic text-body text-text-2 mt-1">
              Italic accent — italic body
            </div>
          </div>

          <div className="bg-canvas-1 rounded-md border border-stroke p-4">
            <div className="font-mono text-label text-text-3 mb-1">font-mono</div>
            <div className="font-mono text-body text-text-1">{SAMPLE}</div>
            <div className="font-mono text-body text-text-1">{SAMPLE_NO}</div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-body text-meta tracking-wide text-text-2 uppercase mb-3">
          Type scale (font-display)
        </h3>
        <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
          {SIZES.map((row) => (
            <div key={row.token} className="flex items-baseline gap-4">
              <code className="font-mono text-label text-text-3 min-w-[8rem]">{row.token}</code>
              <span className={`font-display ${row.className} text-text-1`}>FamilyAssistant</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-body text-meta tracking-wide text-text-2 uppercase mb-3">
          Letter-spacing (tracking)
        </h3>
        <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
          {TRACKING_ROWS.map((row) => (
            <div key={row.className}>
              <code className="font-mono text-label text-text-3 block mb-1">{row.label}</code>
              <div className={`font-body text-body text-text-1 uppercase ${row.className}`}>
                {SAMPLE}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-body text-meta tracking-wide text-text-2 uppercase mb-3">
          Line-height (leading)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {LEADING_ROWS.map((row) => (
            <div key={row.className} className="bg-canvas-1 rounded-md border border-stroke p-4">
              <code className="font-mono text-label text-text-3 block mb-2">{row.label}</code>
              <p className={`font-body text-body text-text-1 ${row.className}`}>{PARAGRAPH}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import type { JSX } from 'react';
// Border-radius scale visualisation. Each box has the same
// dimensions so the radius is the only varying property.

type RadiusRow = {
  cls: string;
  token: string;
  /** Resolved value, for designer reference. */
  px: string;
};

const RADII: RadiusRow[] = [
  { cls: 'rounded-sm', token: '--radius-sm', px: '6 px' },
  { cls: 'rounded-md', token: '--radius-md', px: '12 px' },
  { cls: 'rounded-lg', token: '--radius-lg', px: '16 px' },
  { cls: 'rounded-xl', token: '--radius-xl', px: '22 px' },
  { cls: 'rounded-2xl', token: '--radius-2xl', px: '28 px' },
  { cls: 'rounded-3xl', token: '--radius-3xl', px: '44 px' },
  { cls: 'rounded-pill', token: '--radius-pill', px: '999 px' },
];

export default function Radius(): JSX.Element {
  return (
    <section id="radius" className="space-y-4">
      <h2 className="font-display text-display-md text-text-1">Border radius</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {RADII.map((r) => (
          <div
            key={r.token}
            className={`${r.cls} bg-mint border border-stroke h-24 flex items-end p-3`}
          >
            <div>
              <code className="font-mono text-label text-ink block">{r.token}</code>
              <code className="font-mono text-label text-ink block">{r.px}</code>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

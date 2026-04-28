// Shadow scale visualisation. Each card uses surface-strong + a
// thicker bottom margin so the shadow does not get clipped by the
// next row. shadow-glow is theme-dependent: muted in light, neon
// mint in dark — toggle the preview's theme to see both states.

type ShadowRow = {
  cls: string;
  token: string;
  description: string;
};

const SHADOWS: ShadowRow[] = [
  {
    cls: 'shadow-low',
    token: '--shadow-low',
    description: 'Toast, transient surfaces',
  },
  {
    cls: 'shadow-mid',
    token: '--shadow-mid',
    description: 'Dropdowns, context menus',
  },
  {
    cls: 'shadow-high',
    token: '--shadow-high',
    description: 'Device frame, modals (dev-only structures)',
  },
  {
    cls: 'shadow-glow',
    token: '--shadow-glow',
    description: 'Hero meal card, selected accent surfaces',
  },
];

export default function Shadows(): JSX.Element {
  return (
    <section id="shadows" className="space-y-4">
      <h2 className="font-display text-display-md text-text-1">Shadows</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 p-4 bg-canvas-2 rounded-lg">
        {SHADOWS.map((s) => (
          <div
            key={s.token}
            className={`bg-surface-strong border border-stroke rounded-lg p-4 ${s.cls}`}
          >
            <code className="font-mono text-meta text-text-1 block">{s.token}</code>
            <code className="font-mono text-label text-text-3 block">{s.cls}</code>
            <p className="font-body text-meta text-text-2 mt-2">{s.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

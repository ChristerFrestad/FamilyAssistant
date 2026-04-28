import Animations from './sections/Animations';
import Colors from './sections/Colors';
import Radius from './sections/Radius';
import Shadows from './sections/Shadows';
import Spacing from './sections/Spacing';
import ThemeToggle from './sections/ThemeToggle';
import Typography from './sections/Typography';

// Single-page preview of the design system. All sections render on
// one long page; the sticky nav bar at the top jumps to each
// section's hash anchor. This is a dev-only tool — never imported
// from app/ code, never bundled into prod.

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: '#colors', label: 'Colors' },
  { href: '#typography', label: 'Typography' },
  { href: '#spacing', label: 'Spacing' },
  { href: '#radius', label: 'Radius' },
  { href: '#shadows', label: 'Shadows' },
  { href: '#animations', label: 'Animations' },
];

export default function PreviewPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas-0 text-text-1 font-body">
      <header className="sticky top-0 z-10 bg-surface-strong border-b border-stroke backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-card text-text-1 leading-tight">
              Familieassistenten v2 — design preview
            </h1>
            <p className="font-mono text-label text-text-3">dev-only · /v2/dev.html</p>
          </div>
          <ThemeToggle />
        </div>
        <nav className="max-w-5xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="font-body text-meta text-text-2 rounded-pill px-3 py-1 border border-stroke"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-12">
        <Colors />
        <Typography />
        <Spacing />
        <Radius />
        <Shadows />
        <Animations />
      </main>

      <footer className="max-w-5xl mx-auto px-4 py-12">
        <p className="font-mono text-label text-text-3">
          Source-of-truth for tokens: client/src/app/styles/tokens.css. Architecture notes in
          design/2026-04-redesign/extracted/locked-decisions.md section 4.5.
        </p>
      </footer>
    </div>
  );
}

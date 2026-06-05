// AppShell preview — exercises the full chrome (header, side-nav,
// bottom-nav, user-menu) without booting the real app. Each card
// below mounts AppShell at a different fake route so reviewers can
// see the active-state highlighting on multiple nav items.
//
// We wrap each instance in MemoryRouter so the AppShell's nested
// react-router consumers (Link, useLocation) work. The dev preview
// page itself is NOT inside a BrowserRouter (see dev-main.tsx), so
// each AppShell instance owns its own router.
//
// The "mobile" preview uses a max-width wrapper to force the
// BottomNav into view at jsdom-style breakpoints — the actual
// responsive behavior happens via real CSS media queries when the
// browser viewport is below 768 px.

import type { JSX } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../../app/components/layout/AppShell';

function PageBody({ label }: { label: string }): JSX.Element {
  return (
    <div className="space-y-3">
      <h1 className="font-display text-display-md text-text-1">{label}</h1>
      <p className="font-body text-body text-text-2">
        Demo-innhold inne i AppShell. Klikk i nav-en for å se aktiv-tilstanden flytte seg. UserMenu
        åpner seg ved klikk på avatar i header.
      </p>
    </div>
  );
}

export default function AppShellPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">AppShell</h3>

      <div className="bg-canvas-1 rounded-md border border-stroke p-2 space-y-2">
        <code className="font-mono text-label text-text-3 block px-2 pt-1">
          /dashboard — desktop bredde (SideNav synlig)
        </code>
        {/* Constrained-height wrapper so the preview does not eat the
            entire scroll-area. AppShell still renders its own
            min-h-screen — we just clip the visible portion. */}
        <div className="overflow-hidden rounded-sm border border-stroke" style={{ height: 540 }}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppShell>
              <PageBody label="Dashboard (preview)" />
            </AppShell>
          </MemoryRouter>
        </div>
      </div>

      <div className="bg-canvas-1 rounded-md border border-stroke p-2 space-y-2">
        <code className="font-mono text-label text-text-3 block px-2 pt-1">
          /meals — Meals-fanen aktiv
        </code>
        <div className="overflow-hidden rounded-sm border border-stroke" style={{ height: 420 }}>
          <MemoryRouter initialEntries={['/meals']}>
            <AppShell>
              <PageBody label="Måltider (preview)" />
            </AppShell>
          </MemoryRouter>
        </div>
      </div>

      <div className="bg-canvas-1 rounded-md border border-stroke p-2 space-y-2">
        <code className="font-mono text-label text-text-3 block px-2 pt-1">
          /settings — Settings-rad i SideNav aktiv
        </code>
        <div className="overflow-hidden rounded-sm border border-stroke" style={{ height: 420 }}>
          <MemoryRouter initialEntries={['/settings']}>
            <AppShell>
              <PageBody label="Innstillinger (preview)" />
            </AppShell>
          </MemoryRouter>
        </div>
      </div>
    </div>
  );
}

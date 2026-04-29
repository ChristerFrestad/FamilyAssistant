// AppShell — the single layout that wraps every authenticated screen
// in the v2 frontend. Composition:
//
//   <AppShell>
//     <header>
//       <Logo /> <SideNav-trigger? /> <ThemeToggle /> <LanguageSwitcher /> <UserMenu />
//     </header>
//     <div class="flex">
//       <SideNav />        (md+ only)
//       <main>{children}</main>
//     </div>
//     <BottomNav />        (mobile only)
//   </AppShell>
//
// Semantic HTML: <header>, <nav> (inside SideNav/BottomNav), <main>
// — each with the ARIA label appropriate for the locale. The main
// region carries `id="main-content"` so the skip-link in the header
// can target it.
//
// Why one shell rather than per-screen layouts:
//   - Consistent header surface across every screen
//   - Single place to wire bottom-padding so content does not hide
//     behind the fixed BottomNav on mobile
//   - Centralizes the AuthGuard + Routes plumbing so screens stay
//     focused on their own data + UI
//
// The shell does NOT know about Routes — it only renders {children}.
// App.tsx wires <Routes> as the children. This keeps AppShell
// trivially testable: any single screen-component can be mounted
// inside it from a test without bringing react-router's full route
// table along.

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '../form/ThemeToggle';
import { LanguageSwitcher } from '../form/LanguageSwitcher';
import { UserMenu } from './UserMenu';
import { SideNav } from './SideNav';
import { BottomNav } from './BottomNav';

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): JSX.Element {
  const { t } = useTranslation('common');

  return (
    <div className="min-h-screen bg-canvas-0 text-text-1 font-body flex flex-col">
      {/* Skip-link — visually hidden until focused. Lets keyboard
          users jump past the header straight to <main> on each page
          load. WCAG 2.4.1 (Bypass Blocks). */}
      <a
        href="#main-content"
        className={[
          'sr-only focus:not-sr-only',
          'focus:fixed focus:top-2 focus:left-2 focus:z-50',
          'focus:bg-ink focus:text-ink-contrast focus:rounded-md focus:px-3 focus:py-2',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2',
        ].join(' ')}
      >
        {t('appShell.skipToContent')}
      </a>

      <header
        role="banner"
        className={[
          'sticky top-0 z-20 bg-surface-strong backdrop-blur',
          'border-b border-stroke',
        ].join(' ')}
      >
        <div className="mx-auto max-w-7xl flex items-center gap-3 px-4 py-3">
          <Link
            to="/dashboard"
            aria-label={t('appShell.logoLabel')}
            className={[
              'font-display text-card text-text-1 leading-tight',
              'hover:opacity-80 focus:outline-none',
              'focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0 rounded-md',
              'px-1',
            ].join(' ')}
          >
            Familieassistenten
          </Link>

          {/* Spacer pushes the header utilities to the right. */}
          <div className="flex-1" />

          {/* Header utilities — order matters: theme + language are
              global toggles, UserMenu is identity. Putting identity
              last (rightmost in LTR) matches the convention used by
              most web apps and the mockup. */}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <LanguageSwitcher />
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1 mx-auto w-full max-w-7xl">
        <SideNav />

        <main
          id="main-content"
          // pb-24 reserves vertical space for the fixed BottomNav on
          // mobile so content does not get clipped behind it. md:pb-8
          // unwinds the reservation on desktop where SideNav replaces
          // the bottom rail.
          className="flex-1 px-4 py-6 pb-24 md:pb-8 md:px-6"
        >
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

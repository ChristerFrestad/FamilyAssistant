// Mobile-only bottom navigation. Renders fixed at the bottom of the
// viewport when the screen is narrower than the `md` breakpoint
// (768 px). On wider screens it disappears entirely (`md:hidden`)
// because SideNav takes over.
//
// Visual contract — derived from the mockup's BottomNav at
// design/2026-04-redesign/source/Familieassistenten.html:2583:
//   - Icon-only by default; the active item shows its label next to
//     the icon. This keeps the bar compact (5 touch targets fit on
//     even a 320 px-wide viewport) while still telling the user
//     where they are.
//   - Active item gets bg-ink + text-ink-contrast; inactive items
//     get text-text-2 on the surface-strong background.
//   - The bar itself sits inside a rounded-pill container with the
//     `glass-strong` style — semi-transparent, blurred backdrop —
//     so content scrolling underneath shows through subtly.
//
// Active-route detection compares each item's `to` against the
// current pathname. We use `startsWith` rather than equality so a
// child route (`/meals/add`) still highlights the parent nav item
// (`/meals`). The dashboard exception is special-cased to equality
// because `/dashboard` should NOT match `/`.

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PRIMARY_NAV_ITEMS, type NavItem } from './nav-items';

export interface BottomNavProps {
  /** Optional class on the wrapper. */
  className?: string;
}

function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/dashboard') {
    return pathname === '/dashboard' || pathname === '/';
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function BottomNav({ className }: BottomNavProps): JSX.Element {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();

  return (
    <nav
      aria-label={t('nav.primary')}
      className={[
        'fixed bottom-0 inset-x-0 z-30 px-3 pb-4 pt-2 md:hidden',
        // Subtle gradient so content scrolling underneath fades out
        // toward the bar's edge rather than abruptly clipping. Pure
        // CSS — no JS scroll listener.
        'bg-gradient-to-t from-canvas-0 via-canvas-0/80 to-transparent',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ul
        className={[
          'mx-auto flex max-w-md items-center gap-1 rounded-pill',
          'bg-surface-strong border border-stroke shadow-mid p-1.5',
        ].join(' ')}
      >
        {PRIMARY_NAV_ITEMS.map((item) => {
          const active = isActive(item, pathname);
          const label = t(item.i18nKey);
          return (
            <li key={item.id} className={active ? 'flex-shrink-0' : 'flex-1 min-w-0'}>
              {/* We use plain <Link> + a manual aria-current rather
                  than <NavLink> because the dashboard link must
                  highlight on both `/dashboard` and `/`, and
                  NavLink's built-in matcher would overwrite our
                  aria-current with its own pathname-equality
                  result. The custom isActive() above lifts that
                  constraint and keeps the matching logic in one
                  source of truth. */}
              <Link
                to={item.to}
                {...(active ? { 'aria-current': 'page' as const } : {})}
                aria-label={label}
                className={[
                  'flex items-center justify-center gap-1.5 rounded-pill',
                  'py-2.5 transition-colors whitespace-nowrap',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
                  active
                    ? 'bg-ink text-ink-contrast px-3'
                    : 'text-text-2 hover:bg-surface w-full px-1',
                ].join(' ')}
              >
                <item.Icon size={18} aria-hidden="true" />
                {/* Label only renders on the active item. Inactive
                    items expose their label via aria-label so screen
                    readers always announce the route name. */}
                {active && <span className="text-meta font-medium">{label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

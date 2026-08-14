// Desktop-only side navigation. Renders as a fixed-width vertical
// rail at the `md` breakpoint and above; hidden on narrower screens
// where BottomNav takes over.
//
// Layout note: SideNav lives *inside* AppShell's <aside>, not as a
// fixed-position overlay. Putting it in document flow lets the main
// content area shrink against it via flex, so the screen's content
// stays centered without manual margin-left calculations.
//
// The mockup at design/2026-04-redesign/source/Familieassistenten.html
// only sketches the mobile bottom-nav variant — it shows the desktop
// view as a centered phone-frame rather than a full responsive
// surface. The desktop SideNav is therefore a designed-here
// extension that follows the BottomNav's color/active-state rules:
// active item is solid ink on ink-contrast text, inactive items are
// text-text-2 on transparent. A hairline divider separates the
// primary nav from Settings (the secondary slot) so the visual
// hierarchy mirrors the mockup's mental model where Settings is
// reached out-of-band on mobile (via UserMenu) but joins the main
// rail on desktop where there is room.

import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DESKTOP_NAV_ITEMS, SECONDARY_NAV_ITEMS, type NavItem } from './nav-items';

export interface SideNavProps {
  /** Optional class on the wrapper. */
  className?: string;
}

function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/dashboard') {
    return pathname === '/dashboard' || pathname === '/';
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function NavRow({
  item,
  active,
  label,
}: {
  item: NavItem;
  active: boolean;
  label: string;
}): JSX.Element {
  // Plain Link + manual aria-current — see BottomNav for the
  // rationale (NavLink's built-in matcher overwrites aria-current
  // and cannot express the `/` -> `/dashboard` alias we need).
  return (
    <Link
      to={item.to}
      {...(active ? { 'aria-current': 'page' as const } : {})}
      className={[
        'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
        active
          ? 'bg-ink text-ink-contrast font-medium'
          : 'text-text-2 hover:bg-surface hover:text-text-1',
      ].join(' ')}
    >
      <item.Icon size={20} aria-hidden="true" />
      <span className="font-body text-body">{label}</span>
    </Link>
  );
}

export function SideNav({ className }: SideNavProps): JSX.Element {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();

  return (
    <nav
      aria-label={t('nav.primary')}
      className={[
        'hidden md:flex md:flex-col md:w-56 md:shrink-0',
        'p-3 gap-1',
        // Subtle right-side border so the rail reads as a sidebar
        // even when its background matches the main canvas.
        'border-r border-stroke',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ul className="flex flex-col gap-1">
        {DESKTOP_NAV_ITEMS.map((item) => {
          const active = isActive(item, pathname);
          return (
            <li key={item.id}>
              <NavRow item={item} active={active} label={t(item.i18nKey)} />
            </li>
          );
        })}
      </ul>

      {/* Settings sits at the bottom of the rail with a hairline divider
          above. mt-auto pushes it to the bottom of the flex column. */}
      <ul className="mt-auto flex flex-col gap-1 border-t border-stroke pt-3">
        {SECONDARY_NAV_ITEMS.map((item) => {
          const active = isActive(item, pathname);
          return (
            <li key={item.id}>
              <NavRow item={item} active={active} label={t(item.i18nKey)} />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Single source of truth for the AppShell navigation items.
// BottomNav (mobile) shows the first five entries; SideNav (desktop)
// shows all six including Settings. Keeping the list in one module
// avoids the failure mode where a route is added to one nav surface
// and silently dropped from the other.
//
// Each entry pairs:
//   - id          — stable identifier, used as React `key` and for
//                   active-route comparisons against the URL pathname
//   - to          — react-router pathname (relative to BrowserRouter
//                   basename="/v2"; we pass the leading slash so links
//                   stay absolute against the basename rather than
//                   composing relative to the current Route)
//   - i18nKey     — namespace+key for the visible label, looked up
//                   via `t(common:nav.<id>)` at render time
//   - Icon        — lucide-react icon component (default export)
//
// Icons are imported directly from lucide-react. Tree-shaking keeps
// the bundle tight: only the four-to-six icons we actually render
// land in the prod build, not the full ~1500-icon set.

import {
  Home,
  Users,
  Utensils,
  ShoppingCart,
  Calendar,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: 'dashboard' | 'family' | 'meals' | 'shopping' | 'calendar' | 'settings';
  to: string;
  i18nKey: string;
  Icon: LucideIcon;
}

export const PRIMARY_NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: 'dashboard', to: '/dashboard', i18nKey: 'nav.dashboard', Icon: Home },
  { id: 'family', to: '/family', i18nKey: 'nav.family', Icon: Users },
  { id: 'meals', to: '/meals', i18nKey: 'nav.meals', Icon: Utensils },
  { id: 'shopping', to: '/shopping', i18nKey: 'nav.shopping', Icon: ShoppingCart },
  { id: 'calendar', to: '/calendar', i18nKey: 'nav.calendar', Icon: Calendar },
];

// Settings sits below the main nav on desktop with a visible
// separator. Bottom-nav on mobile reaches Settings via the
// UserMenu instead, keeping the bottom-nav at five touch targets
// (the upper bound for ergonomic single-thumb reach on a phone).
export const SECONDARY_NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: 'settings', to: '/settings', i18nKey: 'nav.settings', Icon: SettingsIcon },
];

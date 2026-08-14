// Source of truth for AppShell navigation.
//
// Mobile BottomNav is locked at five items (thumb reach). Family
// lives in UserMenu on phones. Desktop SideNav has room for Family
// in the primary rail. Recipes stay off every primary rail.

import {
  Home,
  Users,
  CheckSquare,
  Utensils,
  ShoppingCart,
  Calendar,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: 'dashboard' | 'family' | 'chores' | 'meals' | 'shopping' | 'calendar' | 'settings';
  to: string;
  i18nKey: string;
  Icon: LucideIcon;
}

const dashboard: NavItem = {
  id: 'dashboard',
  to: '/dashboard',
  i18nKey: 'nav.dashboard',
  Icon: Home,
};
const family: NavItem = { id: 'family', to: '/family', i18nKey: 'nav.family', Icon: Users };
const chores: NavItem = { id: 'chores', to: '/chores', i18nKey: 'nav.chores', Icon: CheckSquare };
const meals: NavItem = { id: 'meals', to: '/meals', i18nKey: 'nav.meals', Icon: Utensils };
const shopping: NavItem = {
  id: 'shopping',
  to: '/shopping',
  i18nKey: 'nav.shopping',
  Icon: ShoppingCart,
};
const calendar: NavItem = {
  id: 'calendar',
  to: '/calendar',
  i18nKey: 'nav.calendar',
  Icon: Calendar,
};
const settings: NavItem = {
  id: 'settings',
  to: '/settings',
  i18nKey: 'nav.settings',
  Icon: SettingsIcon,
};

export const MOBILE_NAV_ITEMS: ReadonlyArray<NavItem> = [
  dashboard,
  chores,
  meals,
  shopping,
  calendar,
];

export const DESKTOP_NAV_ITEMS: ReadonlyArray<NavItem> = [
  dashboard,
  family,
  chores,
  meals,
  shopping,
  calendar,
];

// Settings sits below the main nav on desktop with a visible
// separator. Bottom-nav on mobile reaches Settings via the
// UserMenu instead, keeping the bottom-nav at five touch targets.
export const SECONDARY_NAV_ITEMS: ReadonlyArray<NavItem> = [settings];

// Header user-menu dropdown. Shows the current user's avatar +
// name in the trigger; clicking opens a small popover with two
// items: "My account" (route to /settings) and "Log out".
//
// Why a hand-rolled dropdown rather than a dependency:
//   - We need exactly two menu items + a header. A library that
//     can express dropdowns generically would more than double
//     the bundle for one button's worth of behavior.
//   - WAI-ARIA "menu" semantics are well-specified for this size
//     of component — we can implement aria-haspopup, aria-expanded,
//     role="menu", role="menuitem", and Escape/click-outside dismiss
//     in ~80 lines.
//
// Keyboard contract:
//   - Click avatar (or Space/Enter on keyboard) -> opens
//   - Escape closes and returns focus to the trigger
//   - Tab moves through menu items (native focus order works)
//   - Click outside closes the menu (mousedown listener)
//
// Click-outside handling uses `mousedown` rather than `click` so the
// menu closes before any click handler on the page can fire — this
// matches user expectation that the menu disappears the instant the
// user starts a click somewhere else.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { Avatar } from '../display/Avatar';
import { useAuth } from '../../auth/useAuth';

export interface UserMenuProps {
  /** Optional class on the wrapper. */
  className?: string;
}

export function UserMenu({ className }: UserMenuProps): JSX.Element | null {
  const { t } = useTranslation('common');
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on click outside. We listen on `mousedown` rather than
  // `click` so the menu closes before any other click handler runs.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Close on Escape. Also returns focus to the trigger so keyboard
  // users do not lose their place after dismissing the menu.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!user) return null;

  // The auth-context user shape uses `string | null` for name and
  // email (cf. AuthUser in app/auth/authApi.ts), but Avatar/aria
  // labels need a guaranteed string. Fall back to the email or a
  // dash so a half-populated user (just-created via magic-link
  // before they finish onboarding) still renders.
  const displayName = user.name?.trim() || user.email || '—';

  return (
    <div ref={wrapperRef} className={['relative', className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('userMenu.open')}
        className={[
          'flex items-center gap-2 rounded-pill p-1 pr-3',
          'hover:bg-surface focus:outline-none',
          'focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
        ].join(' ')}
      >
        <Avatar alt={displayName} {...(user.avatarUrl ? { src: user.avatarUrl } : {})} size="sm" />
        {/* Name hidden on narrow screens — avatar carries the
            identity and the dropdown reveals the full label. */}
        <span className="hidden sm:inline font-body text-meta text-text-1">{displayName}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('userMenu.label')}
          className={[
            'absolute right-0 mt-2 min-w-[12rem] z-50',
            'rounded-md border border-stroke bg-canvas-1 shadow-high',
            'p-1',
          ].join(' ')}
        >
          <div className="px-3 py-2 border-b border-stroke">
            <div className="font-body text-body text-text-1 truncate">{displayName}</div>
            {user.email && user.email !== displayName && (
              <div className="font-body text-meta text-text-3 truncate">{user.email}</div>
            )}
          </div>
          <Link
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={[
              'block rounded-sm px-3 py-2 font-body text-body text-text-1',
              'hover:bg-surface',
              'focus:outline-none focus-visible:bg-surface',
            ].join(' ')}
          >
            {t('userMenu.account')}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className={[
              'flex w-full items-center gap-2 rounded-sm px-3 py-2',
              'font-body text-body text-text-1 text-left',
              'hover:bg-surface',
              'focus:outline-none focus-visible:bg-surface',
            ].join(' ')}
          >
            <LogOut size={16} aria-hidden="true" />
            {t('userMenu.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

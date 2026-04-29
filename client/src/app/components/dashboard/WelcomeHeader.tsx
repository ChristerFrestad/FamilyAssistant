// WelcomeHeader — time-of-day greeting + subtitle for the dashboard.
//
// Greeting buckets (locked in analysis §1A):
//   04-11  morning
//   12-17  afternoon
//   18-03  evening
//
// Name resolution: useAuth().user.name. If the stored name looks
// like an email (heuristic: contains '@'), use the local-part
// before '@' as a fallback so a user who hasn't yet edited their
// profile sees "Hei Christer" instead of "Hei christer@frestad.com".
// Same heuristic as UserProfile.tsx.

import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/useAuth';

/** Pure helper exported for testing — pure function, no React deps. */
export function pickGreetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 4 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** Pure helper exported for testing. */
export function displayNameFromUser(name: string | null | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (trimmed === '') return '';
  // If it looks like an email, take the local-part. The dashboard
  // is the first surface a fresh post-onboarding user sees, so
  // landing on "Hei Christer" feels much warmer than the email.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    const local = trimmed.split('@')[0] ?? '';
    return capitaliseFirst(local);
  }
  return trimmed;
}

function capitaliseFirst(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

export interface WelcomeHeaderProps {
  /** Optional override for tests so we can pin the time of day. */
  now?: Date;
}

export function WelcomeHeader({ now }: WelcomeHeaderProps = {}): JSX.Element {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();

  const hour = (now ?? new Date()).getHours();
  const key = pickGreetingKey(hour);
  const name = displayNameFromUser(user?.name);
  const greeting = t(`welcome.${key}`, { name });

  return (
    <header className="space-y-1">
      <h1 className="font-display text-screen text-text-1 leading-tight">{greeting}</h1>
      <p className="font-body text-body text-text-2">{t('welcome.subtitle')}</p>
    </header>
  );
}

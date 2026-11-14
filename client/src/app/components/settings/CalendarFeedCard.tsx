import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../base/Button';

export function CalendarFeedCard({ isOwner }: { isOwner: boolean }): JSX.Element | null {
  const { t } = useTranslation('settings');
  const [active, setActive] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    void fetch('/api/calendar-feed', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load'))))
      .then((body: { active: boolean }) => setActive(body.active))
      .catch(() => setError(t('calendarFeed.loadFailed')));
  }, [isOwner, t]);

  if (!isOwner) return null;

  async function issue(): Promise<void> {
    setError(null);
    const res = await fetch('/api/calendar-feed', { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      setError(t('calendarFeed.createFailed'));
      return;
    }
    const body = (await res.json()) as { path: string };
    setPath(body.path);
    setActive(true);
  }

  async function revoke(): Promise<void> {
    const res = await fetch('/api/calendar-feed', { method: 'DELETE', credentials: 'include' });
    if (!res.ok) {
      setError(t('calendarFeed.revokeFailed'));
      return;
    }
    setActive(false);
    setPath(null);
  }

  const link = path ? `${window.location.origin}${path}` : '';

  return (
    <div className="flex flex-col gap-3" data-testid="calendar-feed">
      <h3 className="font-display text-card text-text-1">{t('calendarFeed.title')}</h3>
      <p className="font-body text-body text-text-2">{t('calendarFeed.help')}</p>
      <p className="font-body text-meta text-text-3">{t('calendarFeed.google')}</p>
      <p className="font-body text-meta text-text-3">{t('calendarFeed.homeAssistant')}</p>
      {path ? (
        <div className="flex flex-col gap-2" data-testid="calendar-feed-link">
          <p className="break-all font-mono text-meta">{link}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigator.clipboard.writeText(link)}
          >
            {t('calendarFeed.copy')}
          </Button>
          <p className="font-body text-meta text-text-2">{t('calendarFeed.once')}</p>
        </div>
      ) : (
        <p className="font-body text-meta text-text-2">
          {active ? t('calendarFeed.active') : t('calendarFeed.inactive')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" onClick={() => void issue()}>
          {active ? t('calendarFeed.regenerate') : t('calendarFeed.create')}
        </Button>
        {active ? (
          <Button type="button" variant="ghost" onClick={() => void revoke()}>
            {t('calendarFeed.revoke')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="font-body text-meta text-text-1">
          {error}
        </p>
      ) : null}
    </div>
  );
}

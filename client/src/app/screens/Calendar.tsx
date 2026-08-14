// Family calendar screen — local events plus Google/iCloud source chips.
//
// Layout:
//   1. Header — title + 30-day range (same window as Dashboard)
//   2. Event list grouped by date, or empty / error / skeleton
//   3. Add-event form for owner/adult
//
// Children get a read-only list. Auth 401 is handled by AuthGuard.

import type { FormEvent, JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { Field } from '../components/form/Field';
import { Input } from '../components/form/Input';
import { Tag } from '../components/display/Tag';
import { useAuthContext } from '../auth/AuthContext';
import { isoDate } from '../dashboard/dashboardApi';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarEvents,
  type CalendarEvent,
  type CreateCalendarEventBody,
} from '../calendar/calendarApi';
import {
  connectIcloud,
  disconnectCalendarIntegration,
  fetchCalendarIntegrations,
  startGoogleCalendar,
  type CalendarIntegration,
} from '../calendar/integrationsApi';

const RANGE_DAYS = 30;

function formatDayHeading(dateStr: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatRangeDate(dateStr: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function groupByDate(events: CalendarEvent[]): { date: string; events: CalendarEvent[] }[] {
  const groups: { date: string; events: CalendarEvent[] }[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last.date === event.date) {
      last.events.push(event);
    } else {
      groups.push({ date: event.date, events: [event] });
    }
  }
  return groups;
}

export function Calendar(): JSX.Element {
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const { user } = useAuthContext();
  const canManage = user?.role === 'owner' || user?.role === 'adult';

  const nowRef = useRef(new Date());
  const from = isoDate(0, nowRef.current);
  const to = isoDate(RANGE_DAYS, nowRef.current);
  const locale = i18n.language === 'en' ? 'en' : 'nb';

  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(from);
  const [startTime, setStartTime] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const [integrations, setIntegrations] = useState<CalendarIntegration[]>([]);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleDisabledReason, setGoogleDisabledReason] = useState<string | null>(null);
  const [icloudEmail, setIcloudEmail] = useState('');
  const [icloudPassword, setIcloudPassword] = useState('');
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchCalendarEvents(from, to, signal);
        if (signal?.aborted) return;
        setEvents(Array.isArray(res.events) ? res.events : []);
      } catch (err) {
        if (signal?.aborted) return;
        setEvents(null);
        setError(err instanceof Error ? err.message : t('calendar:errors.loadFailed'));
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [from, to, t]
  );

  const loadIntegrations = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!canManage) return;
      try {
        const res = await fetchCalendarIntegrations(signal);
        if (signal?.aborted) return;
        setIntegrations(Array.isArray(res.integrations) ? res.integrations : []);
        setGoogleConfigured(!!res.googleConfigured);
        setGoogleDisabledReason(
          res.googleConfigured ? null : t('calendar:integrations.googleDisabled')
        );
      } catch {
        if (signal?.aborted) return;
        setGoogleConfigured(false);
        setGoogleDisabledReason(t('calendar:integrations.googleDisabled'));
      }
    },
    [canManage, t]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    const ctrl = new AbortController();
    void loadIntegrations(ctrl.signal);
    return () => ctrl.abort();
  }, [loadIntegrations]);

  const groups = useMemo(() => groupByDate(events ?? []), [events]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setActionError(null);
    setSaving(true);
    const body: CreateCalendarEventBody = { title: trimmedTitle, date };
    if (startTime) body.startTime = startTime;
    if (location.trim()) body.location = location.trim();
    if (notes.trim()) body.notes = notes.trim();
    try {
      await createCalendarEvent(body);
      setTitle('');
      setStartTime('');
      setLocation('');
      setNotes('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('calendar:errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number): Promise<void> {
    if (!window.confirm(t('calendar:actions.confirmDelete'))) return;
    setActionError(null);
    try {
      await deleteCalendarEvent(id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('calendar:errors.deleteFailed'));
    }
  }

  async function handleIcloudConnect(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!icloudEmail.trim() || !icloudPassword) return;
    setActionError(null);
    setConnecting(true);
    try {
      await connectIcloud({ email: icloudEmail.trim(), appPassword: icloudPassword });
      setIcloudPassword('');
      await loadIntegrations();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('calendar:integrations.connectFailed'));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: number): Promise<void> {
    setActionError(null);
    try {
      await disconnectCalendarIntegration(id);
      await loadIntegrations();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t('calendar:integrations.disconnectFailed')
      );
    }
  }

  async function handleGoogleConnect(): Promise<void> {
    setActionError(null);
    try {
      const res = await startGoogleCalendar();
      if (res.url) window.location.assign(res.url);
    } catch (err) {
      setGoogleConfigured(false);
      setGoogleDisabledReason(
        err instanceof Error ? err.message : t('calendar:integrations.googleDisabled')
      );
    }
  }

  return (
    <section
      aria-labelledby="screen-heading"
      className="flex flex-col gap-6"
      data-testid="calendar-screen"
    >
      <header className="flex flex-col gap-1">
        <h1 id="screen-heading" className="font-display text-display-md text-text-1">
          {t('calendar:title')}
        </h1>
        <p className="font-body text-body text-text-2">{t('calendar:subtitle')}</p>
        <p className="font-body text-meta text-text-3" data-testid="calendar-range">
          {t('calendar:range', {
            from: formatRangeDate(from, locale),
            to: formatRangeDate(to, locale),
          })}
        </p>
      </header>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-3"
          data-testid="calendar-skeleton"
        >
          <span className="sr-only">{t('common:status.loading')}</span>
          {[0, 1].map((i) => (
            <Card key={i} padding="md" shadow="low">
              <div className="flex flex-col gap-3">
                <div className="h-4 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
                <div className="h-3 w-2/3 animate-pulse rounded-pill bg-stroke-strong" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {!isLoading && error !== null ? (
        <Card padding="md" shadow="low" data-testid="calendar-error">
          <div className="flex flex-col gap-3" role="alert">
            <h2 className="font-display text-card text-text-1">
              {t('calendar:errors.loadFailed')}
            </h2>
            <p className="font-body text-body text-text-2">{error}</p>
            <Button type="button" variant="secondary" onClick={() => void load()}>
              {t('common:status.tryAgain')}
            </Button>
          </div>
        </Card>
      ) : null}

      {!isLoading && error === null && events !== null && events.length === 0 ? (
        <Card
          padding="lg"
          className="flex flex-col items-center gap-2 text-center"
          data-testid="calendar-empty"
        >
          <h2 className="font-display text-display-sm text-text-1">{t('calendar:empty')}</h2>
        </Card>
      ) : null}

      {!isLoading && error === null && events !== null && events.length > 0 ? (
        <div className="flex flex-col gap-4" data-testid="calendar-events">
          {groups.map((group) => (
            <section
              key={group.date}
              className="flex flex-col gap-2"
              aria-labelledby={`day-${group.date}`}
            >
              <h2 id={`day-${group.date}`} className="font-display text-card text-text-1">
                {formatDayHeading(group.date, locale)}
              </h2>
              <ul className="flex flex-col gap-2">
                {group.events.map((event) => (
                  <li key={`${event.id}-${event.date}`}>
                    <Card padding="md" shadow="low" data-testid={`event-row-${event.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-2 font-body text-body text-text-1">
                            {event.title}
                            {event.source && event.source !== 'local' ? (
                              <Tag
                                variant={event.source === 'google' ? 'cyan' : 'amber'}
                                data-testid={`event-source-${event.id}`}
                              >
                                {event.source === 'google'
                                  ? t('calendar:source.google')
                                  : t('calendar:source.icloud')}
                              </Tag>
                            ) : null}
                          </span>
                          {event.startTime ? (
                            <span className="font-body text-meta text-text-2">
                              {event.startTime}
                            </span>
                          ) : event.allDay ? (
                            <span className="font-body text-meta text-text-2">
                              {t('calendar:fields.allDay')}
                            </span>
                          ) : null}
                          {event.location ? (
                            <span className="font-body text-meta text-text-3">
                              {event.location}
                            </span>
                          ) : null}
                          {event.notes ? (
                            <span className="font-body text-meta text-text-3">{event.notes}</span>
                          ) : null}
                        </div>
                        {canManage ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            data-testid={`event-delete-${event.id}`}
                            aria-label={t('calendar:actions.deleteEvent', { title: event.title })}
                            onClick={() => void handleDelete(event.id)}
                          >
                            {t('common:actions.delete')}
                          </Button>
                        ) : null}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      {actionError ? (
        <p
          className="font-body text-body text-rose-deep"
          role="alert"
          data-testid="calendar-action-error"
        >
          {actionError}
        </p>
      ) : null}

      {canManage ? (
        <Card padding="md" shadow="low" data-testid="calendar-add-form">
          <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
            <h2 className="font-display text-card text-text-1">{t('calendar:addEvent')}</h2>
            <Field label={t('calendar:fields.eventTitle')} required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={t('calendar:fields.date')} required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={t('calendar:fields.startTime')}>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label={t('calendar:fields.location')}>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label={t('calendar:fields.notes')}>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />
            </Field>
            <div>
              <Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>
                {t('calendar:addEvent')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {canManage ? (
        <Card padding="md" shadow="low" data-testid="calendar-integrations">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="font-display text-card text-text-1">
                {t('calendar:integrations.title')}
              </h2>
              <p className="font-body text-meta text-text-2">
                {t('calendar:integrations.subtitle')}
              </p>
            </div>

            {integrations.length === 0 ? (
              <p className="font-body text-meta text-text-3">{t('calendar:integrations.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {integrations.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3"
                    data-testid={`integration-row-${item.id}`}
                  >
                    <div className="min-w-0">
                      <p className="font-body text-body text-text-1">
                        {t('calendar:integrations.connectedAs', {
                          provider: item.provider,
                          email: item.accountEmail,
                        })}
                      </p>
                      {item.lastError ? (
                        <p className="font-body text-meta text-rose-deep">
                          {t('calendar:integrations.lastError', { error: item.lastError })}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDisconnect(item.id)}
                    >
                      {t('calendar:actions.disconnect')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <form className="flex flex-col gap-3" onSubmit={(e) => void handleIcloudConnect(e)}>
              <Field label={t('calendar:integrations.email')}>
                <Input
                  type="email"
                  value={icloudEmail}
                  onChange={(e) => setIcloudEmail(e.target.value)}
                  autoComplete="username"
                />
              </Field>
              <Field label={t('calendar:integrations.appPassword')}>
                <Input
                  type="password"
                  value={icloudPassword}
                  onChange={(e) => setIcloudPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={connecting}
                  disabled={!icloudEmail.trim() || !icloudPassword}
                >
                  {t('calendar:actions.connectIcloud')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!googleConfigured}
                  title={googleDisabledReason ?? undefined}
                  onClick={() => void handleGoogleConnect()}
                >
                  {t('calendar:actions.connectGoogle')}
                </Button>
              </div>
              {!googleConfigured && googleDisabledReason ? (
                <p className="font-body text-meta text-text-3" data-testid="google-disabled-reason">
                  {googleDisabledReason}
                </p>
              ) : null}
            </form>
          </div>
        </Card>
      ) : null}
    </section>
  );
}

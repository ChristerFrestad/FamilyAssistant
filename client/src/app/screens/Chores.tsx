// Chores week board — G1 primary nav screen.
//
// Layout matches Meals: eyebrow + h1, DayStrip, selected-day rows,
// week summary. Adult create is a desktop header button + mobile FAB.
// Child gets the same list without add / postpone / edit.

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { ChoresDayStrip } from '../components/chores/ChoresDayStrip';
import { ChoresWeekList } from '../components/chores/ChoresWeekList';
import { ChoreRow } from '../components/chores/ChoreRow';
import { AddChoreModal } from '../components/chores/AddChoreModal';
import { useAuthContext } from '../auth/AuthContext';
import { useChoresData } from '../chores/useChoresData';
import { completeChore, postponeChore, undoChore, type CurrentChore } from '../chores/choresApi';
import {
  choresOnDay,
  dayHasOverdue,
  dayHasPending,
  isVisibleThisWeek,
  pendingCountOnDay,
  sortChoresForDay,
} from '../chores/choreUtils';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(min-width: 768px)');
    const update = (): void => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Chores(): JSX.Element {
  const { t } = useTranslation(['chores', 'meals', 'common']);
  const { user } = useAuthContext();
  const isAdult = user?.role === 'owner' || user?.role === 'adult';
  const isDesktop = useIsDesktop();
  const {
    week,
    isLoading,
    error,
    familyUsers,
    selectedDayIndex,
    todayIndex,
    selectDay,
    retry,
    refresh,
  } = useChoresData();

  const [localChores, setLocalChores] = useState<CurrentChore[] | null>(null);
  const [animatingId, setAnimatingId] = useState<number | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDay, setModalDay] = useState<number | null>(null);

  useEffect(() => {
    setLocalChores(null);
  }, [week]);

  const chores = localChores ?? week?.chores ?? [];
  const visible = chores.filter(isVisibleThisWeek);
  const weekEmpty = !isLoading && error === null && week !== null && visible.length === 0;

  const shortDayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`meals:daysShort.${i}`));
  const longDayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`meals:daysLong.${i}`));
  const todayLabel = t('meals:todayLabel');

  const pendingByDay = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((i) => dayHasPending(visible, i)),
    [visible]
  );
  const overdueByDay = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((i) => dayHasOverdue(visible, i, todayIndex)),
    [visible, todayIndex]
  );
  const pendingCounts = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((i) => pendingCountOnDay(visible, i)),
    [visible]
  );

  const dayChores = sortChoresForDay(choresOnDay(visible, selectedDayIndex), todayIndex);
  const dayEmpty = !weekEmpty && week !== null && dayChores.length === 0;

  const openAdd = useCallback((day: number | null) => {
    setModalDay(day);
    setModalOpen(true);
  }, []);

  const handleComplete = useCallback(
    async (chore: CurrentChore): Promise<void> => {
      const snapshot = chores;
      setActionError(null);
      setAnimatingId(chore.choreId);
      setLocalChores(
        snapshot.map((c) => (c.choreId === chore.choreId ? { ...c, status: 'done' } : c))
      );
      try {
        await completeChore(chore.choreId, week?.weekYear);
        setLiveMessage(t('chores:live.completed', { task: chore.task }));
      } catch {
        setLocalChores(snapshot);
        setActionError(t('chores:errors.completeFailed'));
        setAnimatingId(null);
        return;
      }
      const delay = prefersReducedMotion() ? 0 : 180;
      window.setTimeout(() => setAnimatingId(null), delay);
    },
    [chores, t, week?.weekYear]
  );

  const handleUndo = useCallback(
    async (chore: CurrentChore): Promise<void> => {
      const snapshot = chores;
      setActionError(null);
      setAnimatingId(null);
      setLocalChores(
        snapshot.map((c) => (c.choreId === chore.choreId ? { ...c, status: 'pending' } : c))
      );
      try {
        await undoChore(chore.choreId, week?.weekYear);
        setLiveMessage(t('chores:live.undone', { task: chore.task }));
      } catch {
        setLocalChores(snapshot);
        setActionError(t('chores:errors.undoFailed'));
      }
    },
    [chores, t, week?.weekYear]
  );

  const handlePostpone = useCallback(
    async (chore: CurrentChore): Promise<void> => {
      setActionError(null);
      try {
        await postponeChore(chore.choreId, week?.weekYear);
        if (chore.effectiveDay === 4) {
          setLiveMessage(t('chores:live.postponedNextWeek', { task: chore.task }));
        } else {
          const dest = chore.effectiveDay + 1;
          setLiveMessage(
            t('chores:live.postponed', {
              task: chore.task,
              day: longDayLabels[dest] ?? '',
            })
          );
        }
        refresh();
      } catch {
        setActionError(t('chores:errors.postponeFailed'));
      }
    },
    [longDayLabels, refresh, t, week?.weekYear]
  );

  const handleCreated = useCallback(
    (defaultDay: number | null) => {
      if (defaultDay !== null) selectDay(defaultDay);
      else selectDay(todayIndex);
      refresh();
    },
    [refresh, selectDay, todayIndex]
  );

  return (
    <section aria-labelledby="chores-heading" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-body text-meta uppercase tracking-wider text-text-3">
              {t('chores:weekHeader.label')}
            </span>
            <h1 id="chores-heading" className="font-display text-display-md text-text-1">
              {t('chores:title')}
            </h1>
          </div>
          {isAdult ? (
            <Button
              type="button"
              variant="primary"
              className="hidden shrink-0 md:inline-flex"
              data-testid="chores-add"
              onClick={() => openAdd(null)}
            >
              {t('chores:actions.add')}
            </Button>
          ) : null}
        </div>
        {week?.weekYear ? (
          <p className="font-body text-meta text-text-2" data-testid="chores-week-year">
            {t('chores:weekHeader.week', { weekYear: week.weekYear })}
          </p>
        ) : null}
        {/* G2: chores-xp-slot — Ring + week goal. Do not render. */}
      </header>

      <div className="sr-only" aria-live="polite">
        {liveMessage}
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="chores-skeleton"
          className="flex flex-col gap-3"
        >
          <span className="sr-only">{t('common:status.loading')}</span>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-16 w-[72px] flex-shrink-0 animate-pulse rounded-lg bg-stroke-strong"
              />
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <Card key={i} padding="md" shadow="low">
              <div className="flex flex-col gap-3">
                <div className="h-3 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
                <div className="h-5 w-3/4 animate-pulse rounded-pill bg-stroke-strong" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {!isLoading && error !== null ? (
        <Card padding="md" shadow="low" data-testid="chores-error">
          <div className="flex flex-col gap-3" role="alert">
            <p className="font-body text-body text-text-2">{t('chores:errors.loadFailed')}</p>
            <Button type="button" variant="secondary" onClick={retry}>
              {t('chores:actions.retry')}
            </Button>
          </div>
        </Card>
      ) : null}

      {!isLoading && error === null && week !== null ? (
        <div className="flex flex-col gap-4" data-testid="chores-content">
          <ChoresDayStrip
            selectedIndex={selectedDayIndex}
            todayIndex={todayIndex}
            shortDayLabels={shortDayLabels}
            todayLabel={todayLabel}
            ariaLabel={t('chores:dayStripAria')}
            pendingByDay={pendingByDay}
            overdueByDay={overdueByDay}
            onSelect={selectDay}
          />

          {weekEmpty ? (
            <Card padding="md" shadow="low" data-testid="chores-empty">
              <h2 className="mb-1 font-display text-card text-text-1">
                {t('chores:empty.weekTitle')}
              </h2>
              <p className="font-body text-body text-text-2">{t('chores:empty.weekBody')}</p>
              {isAdult ? (
                <div className="mt-3">
                  <Button type="button" variant="primary" onClick={() => openAdd(null)}>
                    {t('chores:actions.add')}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}

          {dayEmpty ? (
            <Card padding="md" shadow="low" data-testid="chores-day-empty">
              <h2 className="mb-1 font-display text-card text-text-1">
                {t('chores:empty.dayTitle')}
              </h2>
              <p className="font-body text-body text-text-2">{t('chores:empty.dayBody')}</p>
              {isAdult ? (
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openAdd(selectedDayIndex)}
                  >
                    {t('chores:actions.addForDay')}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}

          {dayChores.length > 0 ? (
            <ul className="flex flex-col gap-3" data-testid="chores-day-list">
              {dayChores.map((chore) => (
                <li key={chore.choreId}>
                  <ChoreRow
                    chore={chore}
                    todayIndex={todayIndex}
                    role={user?.role}
                    userId={user?.id}
                    justCompleted={animatingId === chore.choreId}
                    longDayLabels={longDayLabels}
                    onComplete={(c) => void handleComplete(c)}
                    onUndo={(c) => void handleUndo(c)}
                    onPostpone={(c) => void handlePostpone(c)}
                  />
                </li>
              ))}
            </ul>
          ) : null}

          {actionError ? (
            <p
              className="font-body text-body text-rose-deep"
              role="alert"
              data-testid="chores-action-error"
            >
              {actionError}
            </p>
          ) : null}

          <ChoresWeekList
            selectedIndex={selectedDayIndex}
            todayIndex={todayIndex}
            longDayLabels={longDayLabels}
            todayLabel={todayLabel}
            sectionLabel={t('chores:weekList.heading')}
            emptyRowLabel={t('chores:weekList.emptyRow')}
            pendingLabel={(count) => t('chores:weekList.pending', { count })}
            pendingByDay={pendingCounts}
            overdueByDay={overdueByDay}
            onSelect={selectDay}
          />
        </div>
      ) : null}

      {isAdult ? (
        <button
          type="button"
          onClick={() => openAdd(null)}
          aria-label={t('chores:actions.add')}
          data-testid="chores-fab"
          className={[
            'fixed right-4 bottom-[5.5rem] z-20 md:hidden',
            'flex h-14 w-14 items-center justify-center rounded-full',
            'bg-mint text-ink-contrast shadow-mid',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint',
          ].join(' ')}
        >
          <Plus size={24} aria-hidden="true" />
        </button>
      ) : null}

      {isAdult ? (
        <AddChoreModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
          users={familyUsers}
          initialDay={modalDay}
          isDesktop={isDesktop}
        />
      ) : null}
    </section>
  );
}

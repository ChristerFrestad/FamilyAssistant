// Fase 2A Dashboard — first real "home" screen for the v2 SPA.
//
// Layout:
//   1. WelcomeHeader (time-of-day greeting + subtitle)
//   2. Grid of four DashboardCards (mobile: stacked; >= sm: 2x2)
//   3. QuickActions row (three CTAs)
//
// Data flow: useDashboardData fans out three parallel fetches to
// existing backend endpoints (Strategy A from analysis §3). Each
// card consumes one slice of the result and shows its own loading/
// empty/error state, with per-card retry granularity.
//
// Shopping is a count-summary card, not a per-item list, so we
// synthesize a single-element array containing `{ count }` and
// render that one line. The other three cards (meals, chores,
// events) render their actual list entries.

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { WelcomeHeader } from '../components/dashboard/WelcomeHeader';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { QuickActions } from '../components/dashboard/QuickActions';
import { TodayChoreRow } from '../components/dashboard/TodayChoreRow';
import { useDashboardData } from '../dashboard/useDashboardData';
import { useAuthContext } from '../auth/AuthContext';
import { completeChore, fetchChoreStats, undoChore } from '../chores/choresApi';
import type { CalendarEvent, TodayChore, TodayResponse } from '../dashboard/dashboardApi';

const CHORES_LIMIT = 3;
const EVENTS_LIMIT = 3;

// We render at most one meal card item (today's dinner) for now —
// data model is one-meal-per-day. The card title is plural so
// adding breakfast/lunch later doesn't require a new card.
const MEALS_LIMIT = 1;

interface ShoppingSummaryRow {
  count: number;
  totalEstPrice: number;
}

export function Dashboard(): JSX.Element {
  const { t } = useTranslation(['dashboard', 'common']);
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { today, shopping, upcoming, retryToday, retryShopping, retryUpcoming } =
    useDashboardData();
  const [weekXp, setWeekXp] = useState<number | null>(null);
  const [choreStatusById, setChoreStatusById] = useState<Record<number, string>>({});

  useEffect(() => {
    setChoreStatusById({});
  }, [today.data]);

  useEffect(() => {
    const week = today.data?.weekYear;
    if (!week) {
      setWeekXp(null);
      return undefined;
    }
    const ctrl = new AbortController();
    fetchChoreStats(week, ctrl.signal).then(
      (stats) => {
        if (ctrl.signal.aborted) return;
        if (!stats.enabled) {
          setWeekXp(null);
          return;
        }
        const total = (stats.byUser || []).reduce((sum, u) => sum + (Number(u.xp) || 0), 0);
        setWeekXp(total);
      },
      () => {
        if (!ctrl.signal.aborted) setWeekXp(null);
      }
    );
    return () => ctrl.abort();
  }, [today.data?.weekYear]);

  // Derived per-card data. Keep these as plain locals — the
  // mappings are O(N) over <=10 items and re-computing on each
  // render is cheaper than a useMemo cache.
  const mealItems: NonNullable<TodayResponse['meal']>[] = today.data?.meal ? [today.data.meal] : [];
  const choreItems: TodayChore[] = (today.data?.chores ?? []).map((chore) => {
    const override = choreStatusById[chore.choreId];
    return override ? { ...chore, status: override } : chore;
  });

  const handleComplete = useCallback(
    async (chore: TodayChore): Promise<void> => {
      const choreId = Number(chore.choreId);
      if (!Number.isFinite(choreId)) return;
      setChoreStatusById((prev) => ({ ...prev, [choreId]: 'done' }));
      try {
        await completeChore(choreId, today.data?.weekYear);
      } catch {
        setChoreStatusById((prev) => {
          const next = { ...prev };
          delete next[choreId];
          return next;
        });
      }
    },
    [today.data?.weekYear]
  );

  const handleUndo = useCallback(
    async (chore: TodayChore): Promise<void> => {
      const choreId = Number(chore.choreId);
      if (!Number.isFinite(choreId)) return;
      setChoreStatusById((prev) => ({ ...prev, [choreId]: 'pending' }));
      try {
        await undoChore(choreId, today.data?.weekYear);
      } catch {
        setChoreStatusById((prev) => ({ ...prev, [choreId]: 'done' }));
      }
    },
    [today.data?.weekYear]
  );

  // Shopping is a summary card. Convert the items[] into a single
  // synthesized "summary row" so DashboardCard's per-item renderer
  // can show the "X varer igjen" line. Empty → empty state with
  // CTA. Loading → null so the card shows the skeleton.
  let shoppingSummary: ShoppingSummaryRow[] | null;
  if (shopping.data) {
    shoppingSummary =
      shopping.data.items.length > 0
        ? [{ count: shopping.data.items.length, totalEstPrice: shopping.data.totalEstPrice }]
        : [];
  } else {
    shoppingSummary = null;
  }

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-6">
      <h1 id="dashboard-heading" className="sr-only">
        {t('dashboard:title')}
      </h1>

      <WelcomeHeader />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DashboardCard
          title={t('dashboard:sections.todaysMeals')}
          data={today.data ? mealItems : null}
          isLoading={today.isLoading}
          error={today.error}
          renderItem={renderMeal}
          itemKey={(_, index) => `meal-${index}`}
          emptyMessage={t('dashboard:empty.noMeals')}
          emptyCta={{
            label: t('dashboard:empty.addMeal'),
            onClick: () => navigate('/meals'),
          }}
          limit={MEALS_LIMIT}
          onRetry={retryToday}
        />

        <DashboardCard
          title={t('dashboard:sections.todaysChores')}
          data={today.data ? choreItems : null}
          isLoading={today.isLoading}
          error={today.error}
          renderItem={(chore) => (
            <TodayChoreRow
              chore={chore}
              role={user?.role}
              profileMemberId={user?.profileMemberId}
              onComplete={(c) => void handleComplete(c)}
              onUndo={(c) => void handleUndo(c)}
            />
          )}
          itemKey={(item) => `chore-${item.choreId}`}
          emptyMessage={t('dashboard:empty.noChores')}
          emptyCta={{
            label: t('dashboard:empty.addChore'),
            onClick: () => navigate('/chores'),
          }}
          limit={CHORES_LIMIT}
          formatMore={(n) => t('dashboard:more.chores', { count: n })}
          onRetry={retryToday}
          footer={weekXp != null ? t('dashboard:chores.weekXp', { xp: weekXp }) : undefined}
        />

        <DashboardCard<ShoppingSummaryRow>
          title={t('dashboard:sections.shoppingList')}
          data={shoppingSummary}
          isLoading={shopping.isLoading}
          error={shopping.error}
          renderItem={(row) => (
            <span className="font-body text-body text-text-1">
              {t('dashboard:shopping.itemsRemaining', { count: row.count })}
            </span>
          )}
          itemKey={() => 'shopping-summary'}
          emptyMessage={t('dashboard:empty.noShoppingItems')}
          emptyCta={{
            label: t('dashboard:empty.addShopping'),
            onClick: () => navigate('/shopping'),
          }}
          limit={1}
          onRetry={retryShopping}
        />

        <DashboardCard
          title={t('dashboard:sections.upcomingEvents')}
          data={upcoming.data}
          isLoading={upcoming.isLoading}
          error={upcoming.error}
          renderItem={renderEvent}
          itemKey={(item) => `event-${item.id}`}
          emptyMessage={t('dashboard:empty.noEvents')}
          emptyCta={{
            label: t('dashboard:empty.addEvent'),
            onClick: () => navigate('/calendar'),
          }}
          limit={EVENTS_LIMIT}
          formatMore={(n) => t('dashboard:more.events', { count: n })}
          onRetry={retryUpcoming}
        />
      </div>

      <QuickActions />
    </section>
  );
}

// ---------------------------------------------------------------------
// Per-card item renderers. Pulled out as plain functions so the JSX
// inside Dashboard stays scannable.
// ---------------------------------------------------------------------

function renderMeal(meal: NonNullable<TodayResponse['meal']>): JSX.Element {
  if (!meal.recipe) {
    return <span className="font-body text-body text-text-2">—</span>;
  }
  return (
    <div className="flex flex-col">
      <span className="font-body text-body text-text-1 line-clamp-2">{meal.recipe.name}</span>
      {meal.recipe.prepTime ? (
        <span className="font-body text-meta text-text-3">{meal.recipe.prepTime}</span>
      ) : null}
    </div>
  );
}

function formatEventDate(dateStr: string): string {
  // Parse YYYY-MM-DD as a local calendar date so we do not shift a
  // day when the host timezone is behind UTC (Date.parse of a date-
  // only string is UTC midnight).
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderEvent(event: CalendarEvent): JSX.Element {
  const dateLabel = formatEventDate(event.date);
  const timePart = event.startTime ? ` · ${event.startTime}` : '';
  return (
    <div className="flex flex-col">
      <span className="font-body text-body text-text-1 line-clamp-1">{event.title}</span>
      <span className="font-body text-meta text-text-3">
        {dateLabel}
        {timePart}
      </span>
    </div>
  );
}

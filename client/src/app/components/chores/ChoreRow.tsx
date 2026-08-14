// One chore card on the selected day. Complete is a real button with
// aria-pressed (not a checkbox) so the 180 ms brand-dot scale can
// live on a single element.

import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../layout/Card';
import { Button } from '../base/Button';
import { Badge } from '../display/Badge';
import { Avatar } from '../display/Avatar';
import type { CurrentChore } from '../../chores/choresApi';
import {
  canCompleteChore,
  canPostponeChore,
  frequencyBadgeVariant,
  frequencyI18nKey,
  isOverdue,
} from '../../chores/choreUtils';

export interface ChoreRowProps {
  chore: CurrentChore;
  todayIndex: number;
  role: string | undefined;
  userId: number | undefined;
  justCompleted: boolean;
  longDayLabels: string[];
  onComplete: (chore: CurrentChore) => void;
  onUndo: (chore: CurrentChore) => void;
  onPostpone: (chore: CurrentChore) => void;
}

export function ChoreRow({
  chore,
  todayIndex,
  role,
  userId,
  justCompleted,
  longDayLabels,
  onComplete,
  onUndo,
  onPostpone,
}: ChoreRowProps): JSX.Element {
  const { t } = useTranslation(['chores', 'meals']);
  const isAdult = role === 'owner' || role === 'adult';
  const done = chore.status === 'done';
  const overdue = isOverdue(chore, todayIndex);
  const settledDone = done && !justCompleted;
  const allowed = canCompleteChore(done ? { ...chore, status: 'pending' } : chore, role, userId);
  const showComplete = !done && allowed;
  const showUndo = done && allowed;
  const showControl = showComplete || showUndo;
  const showPostpone = canPostponeChore(chore, isAdult);
  const showAvatar = chore.assignedUserId != null || Boolean(chore.assignedName);

  const cardClass = overdue ? 'border-rose/30 bg-rose/10' : undefined;

  return (
    <Card
      padding="md"
      shadow="low"
      data-testid={`chore-row-${chore.choreId}`}
      {...(cardClass ? { className: cardClass } : {})}
    >
      <div className="flex items-start gap-3">
        {showControl ? (
          <button
            type="button"
            onClick={() => {
              if (done) onUndo(chore);
              else onComplete(chore);
            }}
            aria-pressed={done}
            aria-label={
              done
                ? t('chores:actions.completed', { task: chore.task })
                : t('chores:actions.complete', { task: chore.task })
            }
            data-testid={`chore-complete-${chore.choreId}`}
            className={[
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-md',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint',
              done && !showUndo ? 'cursor-default' : '',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'inline-block h-[22px] w-[22px] rounded-full border',
                done
                  ? 'border-[var(--brand-dot)] bg-[var(--brand-dot)]'
                  : 'border-stroke bg-transparent',
                justCompleted ? 'chore-complete-pop' : '',
              ].join(' ')}
            />
          </button>
        ) : (
          <span className="inline-block h-11 w-11 shrink-0" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={[
                'font-body text-body',
                settledDone ? 'text-text-3 line-through decoration-stroke-strong' : 'text-text-1',
              ].join(' ')}
            >
              {chore.icon ? (
                <span aria-hidden="true" className="mr-1.5">
                  {chore.icon}
                </span>
              ) : null}
              {chore.task}
            </p>
            {showAvatar ? (
              <Avatar alt={chore.assignedName ?? ''} size="sm" className="shrink-0" />
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={frequencyBadgeVariant(chore.frequency)}>
              {t(`chores:${frequencyI18nKey(chore.frequency)}`)}
            </Badge>
            {chore.assignedName ? (
              <span className="font-body text-meta text-text-2">{chore.assignedName}</span>
            ) : null}
            {overdue ? <Badge variant="rose">{t('chores:status.overdue')}</Badge> : null}
            {chore.status === 'postponed' && chore.effectiveDay >= 0 ? (
              <span className="font-body text-meta text-text-2">
                {t('chores:status.postponedTo', {
                  day: longDayLabels[chore.effectiveDay] ?? '',
                })}
              </span>
            ) : null}
          </div>

          {showPostpone || showUndo ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {showPostpone ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onPostpone(chore)}
                  data-testid={`chore-postpone-${chore.choreId}`}
                >
                  {t('chores:actions.postpone')}
                </Button>
              ) : null}
              {showUndo ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onUndo(chore)}
                  data-testid={`chore-undo-${chore.choreId}`}
                >
                  {t('chores:actions.undo')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

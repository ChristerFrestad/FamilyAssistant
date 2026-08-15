// Compact dashboard row for one of today's chores. Complete/undo is
// the same brand-dot control as ChoreRow (aria-pressed, not a
// checkbox). Postpone and frequency stay on the Chores screen.

import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { TodayChore } from '../../dashboard/dashboardApi';

export interface TodayChoreRowProps {
  chore: TodayChore;
  role: string | undefined;
  profileMemberId: number | null | undefined;
  onComplete: (chore: TodayChore) => void;
  onUndo: (chore: TodayChore) => void;
}

/** Child cannot complete another member's assigned chore. Adults can. */
export function canCompleteTodayChore(
  chore: Pick<TodayChore, 'assigneeMemberId'>,
  role: string | undefined,
  profileMemberId: number | null | undefined
): boolean {
  if (role === 'owner' || role === 'adult') return true;
  if (role !== 'child') return false;
  if (chore.assigneeMemberId == null) return true;
  return chore.assigneeMemberId === profileMemberId;
}

export function TodayChoreRow({
  chore,
  role,
  profileMemberId,
  onComplete,
  onUndo,
}: TodayChoreRowProps): JSX.Element {
  const { t } = useTranslation('chores');
  const done = chore.status === 'done';
  const allowed = canCompleteTodayChore(chore, role, profileMemberId);
  const showComplete = !done && allowed;
  const showUndo = done && allowed;
  const showControl = showComplete || showUndo;

  return (
    <div className="flex items-center gap-2">
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
              ? t('actions.completed', { task: chore.task })
              : t('actions.complete', { task: chore.task })
          }
          data-testid={`chore-complete-${chore.choreId}`}
          className={[
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-md',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint',
          ].join(' ')}
        >
          <span
            aria-hidden="true"
            className={[
              'inline-block h-[22px] w-[22px] rounded-full border',
              done
                ? 'border-[var(--brand-dot)] bg-[var(--brand-dot)]'
                : 'border-stroke bg-transparent',
            ].join(' ')}
          />
        </button>
      ) : (
        <span className="inline-block h-11 w-11 shrink-0" aria-hidden="true" />
      )}
      <span
        className={[
          'font-body text-body line-clamp-1',
          done ? 'text-text-3 line-through decoration-stroke-strong' : 'text-text-1',
        ].join(' ')}
      >
        {chore.icon ? <span aria-hidden="true">{chore.icon} </span> : null}
        {chore.task}
      </span>
    </div>
  );
}

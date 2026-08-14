// Adult-only create modal. Fields follow Calendar + InviteMemberModal
// language. Child never mounts this component.

import type { FormEvent, JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../overlay/Modal';
import { Button } from '../base/Button';
import { Field } from '../form/Field';
import { Input } from '../form/Input';
import { Avatar } from '../display/Avatar';
import type { FamilyUser } from '../../family/familyApi';
import { createChore, type ChoreFrequency } from '../../chores/choresApi';
import { CHORE_ICON_PRESET } from '../../chores/choreUtils';

const MAX_DETAILS = 240;
const FREQUENCIES: ChoreFrequency[] = ['ukentlig', '14_dager', 'etter_behov'];

export interface AddChoreModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (defaultDay: number | null) => void;
  users: FamilyUser[];
  /** Prefill default day when opened from "add for this day". */
  initialDay: number | null;
  isDesktop: boolean;
}

export function AddChoreModal({
  open,
  onClose,
  onCreated,
  users,
  initialDay,
  isDesktop,
}: AddChoreModalProps): JSX.Element {
  const { t } = useTranslation(['chores', 'common', 'meals']);
  const [task, setTask] = useState('');
  const [details, setDetails] = useState('');
  const [frequency, setFrequency] = useState<ChoreFrequency>('ukentlig');
  const [defaultDay, setDefaultDay] = useState<number | null>(initialDay);
  const [icon, setIcon] = useState<string>('✅');
  const [assigneeUserId, setAssigneeUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTask('');
      setDetails('');
      setFrequency('ukentlig');
      setDefaultDay(initialDay);
      setIcon('✅');
      setAssigneeUserId(null);
      setSaving(false);
      setSaveError(null);
      return;
    }
    setDefaultDay(initialDay);
  }, [open, initialDay]);

  const trimmedTask = task.trim();
  const taskValid = trimmedTask.length >= 2 && trimmedTask.length <= 80;
  const detailsTrimmed = details.trim();
  const detailsOver = detailsTrimmed.length > MAX_DETAILS;
  const needsDay = frequency !== 'etter_behov';
  const dayChosen = defaultDay !== null && defaultDay >= 0 && defaultDay <= 6;
  const submitDisabled = saving || !taskValid || detailsOver || (needsDay && !dayChosen);

  const shortDayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`meals:daysShort.${i}`));

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitDisabled) return;
    setSaving(true);
    setSaveError(null);
    const selectedUser = users.find((u) => u.id === assigneeUserId);
    try {
      await createChore({
        task: trimmedTask,
        details: detailsTrimmed.length > 0 ? detailsTrimmed : null,
        frequency,
        defaultDay: needsDay ? defaultDay : null,
        icon,
        assigneeMemberId: selectedUser?.profileMemberId ?? null,
      });
      onCreated(needsDay ? defaultDay : null);
      onClose();
    } catch {
      setSaveError(t('chores:errors.saveFailed'));
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={t('chores:addModal.title')}
      position={isDesktop ? 'center' : 'bottom'}
      size={isDesktop ? 'md' : 'full'}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <Field label={t('chores:fields.task')} required>
          <Input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            autoComplete="off"
            maxLength={80}
            data-testid="chores-field-task"
          />
        </Field>

        <Field label={t('chores:fields.details')} hint={t('chores:fields.detailsHint')}>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            maxLength={MAX_DETAILS * 2}
            className="block w-full rounded-md border border-stroke bg-canvas-0 px-3 py-2 font-body text-body text-text-1 placeholder:text-text-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0"
            data-testid="chores-field-details"
          />
        </Field>
        <p className="font-body text-meta text-text-3" aria-live="polite">
          {detailsTrimmed.length}/{MAX_DETAILS}
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-body text-meta text-text-2">
            {t('chores:fields.frequency')}
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {FREQUENCIES.map((value) => {
              const pressed = frequency === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setFrequency(value)}
                  data-testid={`chores-frequency-${value}`}
                  className={[
                    'rounded-lg border px-3 py-2 text-left font-body text-body transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                    pressed
                      ? 'border-mint bg-surface-strong text-text-1'
                      : 'border-stroke bg-surface text-text-2 hover:text-text-1',
                  ].join(' ')}
                >
                  {t(`chores:frequency.${value}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        {needsDay ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="font-body text-meta text-text-2">
              {t('chores:fields.defaultDay')}
            </legend>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((idx) => {
                const pressed = defaultDay === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => setDefaultDay(idx)}
                    data-testid={`chores-default-day-${idx}`}
                    className={[
                      'flex min-w-[72px] flex-col items-center gap-1 rounded-lg border px-3 py-2',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                      pressed
                        ? 'border-mint bg-surface-strong text-text-1'
                        : 'border-stroke bg-surface text-text-2',
                    ].join(' ')}
                  >
                    <span className="font-body text-meta uppercase tracking-wider">
                      {shortDayLabels[idx]}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="font-body text-meta text-text-2">{t('chores:fields.icon')}</legend>
          <div className="flex flex-wrap gap-2">
            {CHORE_ICON_PRESET.map((emoji) => {
              const pressed = icon === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={pressed}
                  aria-label={emoji}
                  onClick={() => setIcon(emoji)}
                  data-testid={`chores-icon-${emoji}`}
                  className={[
                    'flex h-11 w-11 items-center justify-center rounded-lg border text-lg',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                    pressed ? 'border-mint bg-surface-strong' : 'border-stroke bg-surface',
                  ].join(' ')}
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-body text-meta text-text-2">{t('chores:fields.assignee')}</legend>
          <div className="flex flex-col gap-1" role="radiogroup">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stroke px-3 py-2">
              <input
                type="radio"
                name="chore-assignee"
                checked={assigneeUserId === null}
                onChange={() => setAssigneeUserId(null)}
                data-testid="chores-assignee-anyone"
              />
              <span className="font-body text-body text-text-1">{t('chores:fields.anyone')}</span>
            </label>
            {users.map((user) => {
              const name = user.name?.trim() || user.email;
              return (
                <label
                  key={user.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-stroke px-3 py-2"
                >
                  <input
                    type="radio"
                    name="chore-assignee"
                    checked={assigneeUserId === user.id}
                    onChange={() => setAssigneeUserId(user.id)}
                    data-testid={`chores-assignee-${user.id}`}
                  />
                  <Avatar
                    alt={name}
                    {...(user.avatarUrl ? { src: user.avatarUrl } : {})}
                    size="sm"
                  />
                  <span className="font-body text-body text-text-1">{name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {saveError ? (
          <p className="font-body text-body text-rose-deep" role="alert">
            {saveError}
          </p>
        ) : null}

        <div className="flex flex-row-reverse items-center justify-start gap-2 pt-2">
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={submitDisabled}
            data-testid="chores-add-submit"
          >
            {t('chores:addModal.submit')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={saving}
            data-testid="chores-add-cancel"
          >
            {t('common:actions.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

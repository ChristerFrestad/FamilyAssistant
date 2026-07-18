// Sprint 9 / PR #119 — Pending invitations list shown under the family
// roster on the v2 Family screen.
//
// Owner-only surface; tapping into /api/family/invitations to render a
// table with email, sent-relative-time, expires-relative-time, and two
// row-level actions (resend + revoke). The list is fed from a parent-
// controlled `invitations` array so the parent owns the optimistic
// refresh after create/resend/revoke. We expose `onChanged` to bubble
// resend/revoke completions back up; the parent then re-fetches.
//
// Empty state is rendered when invitations.length === 0 — small icon
// + the localised empty hint. Loading + error states are owned by the
// parent (it knows the request lifecycle) and rendered around this
// component.

import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '../layout/Card';
import { Button } from '../base/Button';
import {
  resendInvitation,
  revokeInvitation,
  FamilyInvitationsApiError,
  type Invitation,
} from '../../family/familyInvitationsApi';

export interface PendingInvitationsListProps {
  invitations: Invitation[];
  onChanged: (event: { kind: 'resent' | 'revoked'; email: string | null }) => void;
  onError: (message: string) => void;
}

export function PendingInvitationsList({
  invitations,
  onChanged,
  onError,
}: PendingInvitationsListProps): JSX.Element {
  const { t } = useTranslation('family');
  const [busyId, setBusyId] = useState<number | null>(null);

  if (invitations.length === 0) {
    return (
      <Card padding="md" shadow="low" data-testid="pending-invitations-empty">
        <p className="font-body text-meta text-text-3">{t('family:invitations.pending.empty')}</p>
      </Card>
    );
  }

  async function handleResend(inv: Invitation): Promise<void> {
    const confirmation = window.confirm(
      t('family:invitations.pending.confirmResend', { email: inv.invitedEmail ?? '' })
    );
    if (!confirmation) return;
    setBusyId(inv.id);
    try {
      await resendInvitation(inv.id);
      onChanged({ kind: 'resent', email: inv.invitedEmail });
    } catch (err) {
      onError(deriveErrorMessage(err, t));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevoke(inv: Invitation): Promise<void> {
    const confirmation = window.confirm(
      t('family:invitations.pending.confirmRevoke', { email: inv.invitedEmail ?? '' })
    );
    if (!confirmation) return;
    setBusyId(inv.id);
    try {
      await revokeInvitation(inv.id);
      onChanged({ kind: 'revoked', email: inv.invitedEmail });
    } catch (err) {
      onError(deriveErrorMessage(err, t));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card padding="md" shadow="low" data-testid="pending-invitations-list">
      <div className="flex flex-col gap-3">
        <h3 className="font-display text-card text-text-1">
          {t('family:invitations.pending.title')}
        </h3>
        <ul className="flex flex-col divide-y divide-stroke" role="list">
          {invitations.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`pending-invitation-row-${inv.id}`}
            >
              <div className="flex flex-col gap-0.5">
                <p className="font-body text-body text-text-1">{inv.invitedEmail ?? '—'}</p>
                <p className="font-body text-meta text-text-3">
                  {t('family:invitations.pending.columns.sent')}:{' '}
                  {formatRelative(inv.createdAt, t, 'past')} •{' '}
                  {t('family:invitations.pending.columns.expires')}:{' '}
                  {formatRelative(inv.expiresAt, t, 'future')}
                </p>
              </div>
              <div className="flex flex-row gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleResend(inv)}
                  loading={busyId === inv.id}
                  disabled={busyId !== null}
                  data-testid={`pending-invitation-resend-${inv.id}`}
                >
                  {t('family:invitations.pending.actions.resend')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRevoke(inv)}
                  disabled={busyId !== null}
                  data-testid={`pending-invitation-revoke-${inv.id}`}
                >
                  {t('family:invitations.pending.actions.revoke')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function deriveErrorMessage(err: unknown, t: TFunction<'family'>): string {
  if (err instanceof FamilyInvitationsApiError) {
    if (err.code === 'INVITATION_REVOKED' || err.code === 'INVITATION_ACCEPTED') {
      return t('family:invitations.validation.generic');
    }
  }
  return t('family:invitations.validation.generic');
}

// Cheap relative-time formatter — we are inside a single locale at any
// given time, so we feed `t()` the right key per bucket. The full
// Intl.RelativeTimeFormat would give better grammar (e.g. "i går", "i
// dag") but pulls another ~3 KB; for an internal admin list the bucketed
// version is good enough and keeps the bundle dependency-free.
function formatRelative(iso: string, t: TFunction<'family'>, direction: 'past' | 'future'): string {
  const ms = Date.parse(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(ms)) return iso;
  const deltaMs = direction === 'past' ? Date.now() - ms : ms - Date.now();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 0) {
    return direction === 'future'
      ? t('family:invitations.relativeTime.expired')
      : t('family:invitations.relativeTime.now');
  }
  if (minutes < 1) return t('family:invitations.relativeTime.now');
  if (minutes < 60) {
    return t(
      direction === 'past'
        ? 'family:invitations.relativeTime.minutesAgo'
        : 'family:invitations.relativeTime.inMinutes',
      { count: minutes }
    );
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return t(
      direction === 'past'
        ? 'family:invitations.relativeTime.hoursAgo'
        : 'family:invitations.relativeTime.inHours',
      { count: hours }
    );
  }
  const days = Math.round(hours / 24);
  return t(
    direction === 'past'
      ? 'family:invitations.relativeTime.daysAgo'
      : 'family:invitations.relativeTime.inDays',
    { count: days }
  );
}

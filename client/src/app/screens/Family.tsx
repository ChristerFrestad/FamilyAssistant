// Phase 2B Family screen — second real screen in the v2 SPA after
// Dashboard. Replaces the placeholder added in Phase 1d.
//
// Layout:
//   1. Header — family name + "Edit"-button (placeholder for now;
//      shows an inline status when clicked)
//   2. Members section — heading + grid of MemberCard.
//      mobile: single column; >= sm: two columns.
//   3. Footer actions — "Invite member" button (placeholder; shows
//      an inline status when clicked).
//
// State machine:
//   - useFamilyData hook drives loading/error/data states with
//     per-member save tracking for portion-factor changes.
//   - Skeleton-grid shown during initial load.
//   - Error-card with retry shown on initial-fetch failure.
//   - Single-member rosters get a hint line under the grid.
//
// Auth integration:
//   - useAuthContext exposes the current user. We pass
//     user.profileMemberId into joinMembersWithUsers so the
//     correct row gets the "(Du)"-badge.
//   - Children (role=child) cannot edit portion factors; the
//     backend enforces this with 403, but we also pre-disable the
//     slider so they get an immediate visual cue.

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/layout/Card';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { Button } from '../components/base/Button';
import { MemberCard } from '../components/family/MemberCard';
import { InviteMemberModal } from '../components/family/InviteMemberModal';
import { PendingInvitationsList } from '../components/family/PendingInvitationsList';
import { useFamilyData, joinMembersWithUsers } from '../family/useFamilyData';
import { useAuthContext } from '../auth/AuthContext';
import { listInvitations, type Invitation } from '../family/familyInvitationsApi';

const PLACEHOLDER_DISMISS_MS = 4000;

export function Family(): JSX.Element {
  const { t } = useTranslation(['family', 'common']);
  const { user } = useAuthContext();
  const { data, isLoading, error, memberSaveStatus, retry, updatePortion } = useFamilyData();

  // Edit-family-name still shows a Sprint-5+ placeholder. The invite
  // surface is now real: opening the modal and a refreshable
  // pending-list under the roster.
  const [editPlaceholderVisible, setEditPlaceholderVisible] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const isOwner = user?.role === 'owner';

  const showEditPlaceholder = useCallback(() => {
    setEditPlaceholderVisible(true);
    setTimeout(() => setEditPlaceholderVisible(false), PLACEHOLDER_DISMISS_MS);
  }, []);

  const flashStatus = useCallback((message: string) => {
    setStatusMessage(message);
    setTimeout(
      () => setStatusMessage((current) => (current === message ? null : current)),
      PLACEHOLDER_DISMISS_MS
    );
  }, []);

  const refreshInvitations = useCallback(async () => {
    if (!isOwner) return;
    try {
      const r = await listInvitations();
      setInvitations(Array.isArray(r.invitations) ? r.invitations : []);
      setInvitationsError(null);
    } catch {
      setInvitationsError(t('family:invitations.pending.loadFailed'));
    }
  }, [isOwner, t]);

  useEffect(() => {
    void refreshInvitations();
  }, [refreshInvitations]);

  const isChild = user?.role === 'child';

  return (
    <section aria-labelledby="family-heading" className="flex flex-col gap-6">
      <ScreenHeader title={t('family:title')} titleHidden titleId="family-heading" />

      {/* Family header card */}
      <Card padding="md" shadow="low" data-testid="family-header">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-body text-meta uppercase tracking-wider text-text-3">
              {t('family:familyHeader.label')}
            </span>
            <h2 className="font-display text-display-md text-text-1 truncate">
              {data?.family.name ?? '—'}
            </h2>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={showEditPlaceholder}
            data-testid="edit-family-button"
          >
            {t('family:familyHeader.editAction')}
          </Button>
        </div>
        {editPlaceholderVisible ? (
          <p
            className="mt-3 font-body text-meta text-text-3"
            role="status"
            aria-live="polite"
            data-testid="edit-placeholder-status"
          >
            {t('family:familyHeader.editPlaceholder')}
          </p>
        ) : null}
      </Card>

      {/* Members section */}
      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="font-display text-card text-text-1">
          {t('family:members.heading')}
        </h2>

        {isLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            data-testid="family-skeleton"
          >
            <span className="sr-only">{t('common:status.loading')}</span>
            {[0, 1].map((i) => (
              <Card key={i} padding="md" shadow="low">
                <div className="flex flex-col gap-3">
                  <div className="h-4 w-1/2 animate-pulse rounded-pill bg-stroke-strong" />
                  <div className="h-3 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
                  <div className="h-2 w-full animate-pulse rounded-pill bg-stroke-strong" />
                </div>
              </Card>
            ))}
          </div>
        ) : null}

        {!isLoading && error !== null ? (
          <Card padding="md" shadow="low" data-testid="family-error">
            <div className="flex flex-col gap-3" role="alert">
              <p className="font-body text-body text-text-2">{t('family:errors.loadFailed')}</p>
              <Button type="button" variant="secondary" onClick={retry}>
                {t('family:actions.retry')}
              </Button>
            </div>
          </Card>
        ) : null}

        {!isLoading && error === null && data !== null ? (
          <FamilyMembersGrid
            joinedMembers={joinMembersWithUsers(data, user?.profileMemberId ?? null)}
            memberSaveStatus={memberSaveStatus}
            onPortionChange={updatePortion}
            sliderDisabled={isChild}
          />
        ) : null}

        {!isLoading && error === null && data?.profileMembers.length === 1 ? (
          <p className="font-body text-meta text-text-3" data-testid="single-member-hint">
            {t('family:members.singleMemberHint')}
          </p>
        ) : null}
      </section>

      {/* Pending invitations — owners only. The list lives next to the
          roster so an owner planning new members can see who is in
          flight without leaving the screen. */}
      {isOwner ? (
        <section aria-labelledby="pending-invitations-heading" className="flex flex-col gap-2">
          <h2 id="pending-invitations-heading" className="sr-only">
            {t('family:invitations.pending.title')}
          </h2>
          {invitationsError ? (
            <p role="alert" className="font-body text-meta text-danger">
              {invitationsError}
            </p>
          ) : (
            <PendingInvitationsList
              invitations={invitations}
              onChanged={(event) => {
                if (event.kind === 'resent') {
                  flashStatus(t('family:invitations.success.resent'));
                } else {
                  flashStatus(t('family:invitations.success.revoked'));
                }
                void refreshInvitations();
              }}
              onError={(message) => flashStatus(message)}
            />
          )}
        </section>
      ) : null}

      {/* Footer actions */}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => setInviteModalOpen(true)}
          data-testid="invite-member-button"
          disabled={!isOwner}
        >
          {t('family:actions.invite')}
        </Button>
        {statusMessage ? (
          <p
            className="font-body text-meta text-text-3"
            role="status"
            aria-live="polite"
            data-testid="invite-status-message"
          >
            {statusMessage}
          </p>
        ) : null}
      </div>

      <InviteMemberModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onSuccess={(invitation) => {
          flashStatus(
            t('family:invitations.success.sent', { email: invitation.invitedEmail ?? '' })
          );
          void refreshInvitations();
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------
// Internal helper component — keeps Family.tsx scannable. Pulled out
// inline rather than promoting to its own file because nothing else
// will ever consume this layout.
// ---------------------------------------------------------------------

interface FamilyMembersGridProps {
  joinedMembers: ReturnType<typeof joinMembersWithUsers>;
  memberSaveStatus: Record<number, 'idle' | 'saving' | 'saved' | 'error'>;
  onPortionChange: (memberId: number, portionFactor: number) => Promise<void>;
  sliderDisabled: boolean;
}

function FamilyMembersGrid({
  joinedMembers,
  memberSaveStatus,
  onPortionChange,
  sliderDisabled,
}: FamilyMembersGridProps): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="family-members-grid">
      {joinedMembers.map(({ member, user, isCurrentUser }) => (
        <MemberCard
          key={member.id}
          member={member}
          user={user}
          isCurrentUser={isCurrentUser}
          saveStatus={memberSaveStatus[member.id]}
          onPortionChange={(value) => {
            void onPortionChange(member.id, value);
          }}
          sliderDisabled={sliderDisabled}
        />
      ))}
    </div>
  );
}

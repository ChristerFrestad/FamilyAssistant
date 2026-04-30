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

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { MemberCard } from '../components/family/MemberCard';
import { useFamilyData, joinMembersWithUsers } from '../family/useFamilyData';
import { useAuthContext } from '../auth/AuthContext';

const PLACEHOLDER_DISMISS_MS = 3000;

export function Family(): JSX.Element {
  const { t } = useTranslation(['family', 'common']);
  const { user } = useAuthContext();
  const { data, isLoading, error, memberSaveStatus, retry, updatePortion } = useFamilyData();

  // Inline placeholder status for the two unimplemented buttons
  // (rename + invite). Single piece of state — only one placeholder
  // is visible at a time, which matches the natural focus flow.
  const [placeholderKey, setPlaceholderKey] = useState<'edit' | 'invite' | null>(null);

  const showPlaceholder = useCallback((kind: 'edit' | 'invite') => {
    setPlaceholderKey(kind);
    setTimeout(() => {
      setPlaceholderKey((current) => (current === kind ? null : current));
    }, PLACEHOLDER_DISMISS_MS);
  }, []);

  const isChild = user?.role === 'child';

  return (
    <section aria-labelledby="family-heading" className="flex flex-col gap-6">
      <h1 id="family-heading" className="sr-only">
        {t('family:title')}
      </h1>

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
            onClick={() => showPlaceholder('edit')}
            data-testid="edit-family-button"
          >
            {t('family:familyHeader.editAction')}
          </Button>
        </div>
        {placeholderKey === 'edit' ? (
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

      {/* Footer actions */}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => showPlaceholder('invite')}
          data-testid="invite-member-button"
        >
          {t('family:actions.invite')}
        </Button>
        {placeholderKey === 'invite' ? (
          <p
            className="font-body text-meta text-text-3"
            role="status"
            aria-live="polite"
            data-testid="invite-placeholder-status"
          >
            {t('family:actions.invitePlaceholder')}
          </p>
        ) : null}
      </div>
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

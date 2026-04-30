// Card representing one family roster row in the Family screen.
//
// Composition:
//   - Header: Avatar (initials from name) + name (with "(Du)"-badge
//     if this card represents the logged-in user) + role badge
//     (if a user is linked) + category label.
//   - Body: PortionFactorSlider with live save-status under it.
//
// Save status surface:
//   - "saving"  → muted "Lagrer..." line under the slider
//   - "saved"   → mint "Lagret" line that the parent dismisses
//                 after ~1.5 s (handled in useFamilyData)
//   - "error"   → coral "Kunne ikke lagre" line; persists until the
//                 next attempt
//   - undefined → no status line (resting state)
//
// The component is a pure render: data and onPortionChange flow in
// from useFamilyData. We do NOT read AuthContext here — the parent
// passes isCurrentUser as a boolean prop so this component stays
// trivially testable without provider scaffolding.

import { useTranslation } from 'react-i18next';
import { Card } from '../layout/Card';
import { Avatar } from '../display/Avatar';
import { Badge } from '../display/Badge';
import { PortionFactorSlider } from '../form/PortionFactorSlider';
import type { ProfileMember, FamilyUser } from '../../family/familyApi';
import type { SaveStatus } from '../../family/useFamilyData';

export interface MemberCardProps {
  member: ProfileMember;
  /** Linked user record, if any. Null = no login account on this roster row. */
  user: FamilyUser | null;
  /** True when this card represents the logged-in viewer. */
  isCurrentUser: boolean;
  /** Save state from the parent hook. Undefined = no current activity. */
  saveStatus: SaveStatus | undefined;
  /** Fires every time the slider settles on a new step. */
  onPortionChange: (value: number) => void;
  /** Disable the slider when the viewer cannot edit (read-only roles). */
  sliderDisabled?: boolean;
}

const ROLE_BADGE_VARIANT: Record<FamilyUser['role'], 'mint' | 'cyan' | 'amber'> = {
  owner: 'amber',
  adult: 'mint',
  child: 'cyan',
};

export function MemberCard({
  member,
  user,
  isCurrentUser,
  saveStatus,
  onPortionChange,
  sliderDisabled = false,
}: MemberCardProps): JSX.Element {
  const { t } = useTranslation('family');

  const sliderId = `member-${member.id}-portion`;
  const statusId = `member-${member.id}-status`;

  // exactOptionalPropertyTypes forbids passing `undefined` to an
  // optional prop, so build the Avatar props conditionally.
  const avatarProps = user?.avatarUrl
    ? { src: user.avatarUrl, alt: member.name, size: 'md' as const, shape: 'round' as const }
    : { alt: member.name, size: 'md' as const, shape: 'round' as const };

  return (
    <Card padding="md" shadow="low" data-testid={`member-card-${member.id}`}>
      <header className="mb-4 flex items-start gap-3">
        <Avatar {...avatarProps} />
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-display text-card text-text-1 leading-none truncate">
              {member.name}
            </h3>
            {isCurrentUser ? (
              <Badge variant="mint" data-testid="you-badge">
                {t('youBadge')}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {user ? (
              <Badge variant={ROLE_BADGE_VARIANT[user.role]} data-testid="role-badge">
                {t(`roles.${user.role}`)}
              </Badge>
            ) : null}
            <span className="font-body text-meta text-text-3" data-testid="category-label">
              {t(`category.${member.category}`)}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <label htmlFor={sliderId} className="font-body text-meta text-text-2">
          {t('portionFactor.label')}
        </label>
        <PortionFactorSlider
          id={sliderId}
          value={member.portionFactor}
          onChange={onPortionChange}
          disabled={sliderDisabled}
          aria-describedby={statusId}
          description={t('portionFactor.help')}
        />
        <p id={statusId} role="status" aria-live="polite" className="min-h-[1.25rem]">
          {saveStatus === 'saving' ? (
            <span className="font-body text-meta text-text-3">{t('portionFactor.saving')}</span>
          ) : null}
          {saveStatus === 'saved' ? (
            <span className="font-body text-meta text-mint" data-testid="save-status-saved">
              {t('portionFactor.updateSuccess')}
            </span>
          ) : null}
          {saveStatus === 'error' ? (
            <span className="font-body text-meta text-coral" data-testid="save-status-error">
              {t('portionFactor.updateError')}
            </span>
          ) : null}
        </p>
      </div>
    </Card>
  );
}

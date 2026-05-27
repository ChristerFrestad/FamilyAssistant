// Tests for MemberCard.
//
// Covers the four visible-state combinations:
//   1. Linked user, current viewer → name + (Du)-badge + role + category
//   2. Linked user, NOT current viewer → name + role + category, no badge
//   3. No linked user → name + category only, no role badge
//   4. Save status surfaces:
//        saving → no special data-testid (just text)
//        saved  → data-testid='save-status-saved'
//        error  → data-testid='save-status-error'
//        undefined → none of the above
// Plus: slider onChange propagates to onPortionChange.

import { test, expect, vi, describe } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberCard } from './MemberCard';
import type { ProfileMember, FamilyUser } from '../../family/familyApi';

const MEMBER: ProfileMember = {
  id: 10,
  name: 'Christer',
  category: 'adult',
  portionFactor: 1.0,
  sortOrder: 0,
  allergies: null,
  dislikes: null,
  dietTags: [],
  customDietNote: null,
  createdAt: '2026-04-01 12:00:00',
  updatedAt: '2026-04-01 12:00:00',
};

const KID_MEMBER: ProfileMember = {
  ...MEMBER,
  id: 11,
  name: 'Storebror',
  category: 'child',
  portionFactor: 0.5,
};

const OWNER_USER: FamilyUser = {
  id: 1,
  email: 'peder@example.com',
  name: 'Christer',
  avatarUrl: null,
  role: 'owner',
  profileMemberId: 10,
  lastSeenAt: null,
};

describe('MemberCard — render variants', () => {
  test('renders name + (Du)-badge + role + category for current user with linked user', () => {
    render(
      <MemberCard
        member={MEMBER}
        user={OWNER_USER}
        isCurrentUser={true}
        saveStatus={undefined}
        onPortionChange={() => undefined}
      />
    );
    expect(screen.getByText('Christer')).toBeInTheDocument();
    expect(screen.getByTestId('you-badge')).toBeInTheDocument();
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Eier');
    expect(screen.getByTestId('category-label')).toHaveTextContent('Voksen');
  });

  test('renders role + category but NOT (Du)-badge when isCurrentUser=false', () => {
    render(
      <MemberCard
        member={MEMBER}
        user={OWNER_USER}
        isCurrentUser={false}
        saveStatus={undefined}
        onPortionChange={() => undefined}
      />
    );
    expect(screen.queryByTestId('you-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('role-badge')).toBeInTheDocument();
  });

  test('renders only category (no role) when no linked user', () => {
    render(
      <MemberCard
        member={KID_MEMBER}
        user={null}
        isCurrentUser={false}
        saveStatus={undefined}
        onPortionChange={() => undefined}
      />
    );
    expect(screen.queryByTestId('role-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('category-label')).toHaveTextContent('Barn');
    expect(screen.queryByTestId('you-badge')).not.toBeInTheDocument();
  });
});

describe('MemberCard — save status', () => {
  test('renders saving text when saveStatus=saving', () => {
    render(
      <MemberCard
        member={MEMBER}
        user={OWNER_USER}
        isCurrentUser={false}
        saveStatus="saving"
        onPortionChange={() => undefined}
      />
    );
    expect(screen.getByText(/Lagrer/)).toBeInTheDocument();
  });

  test('renders saved badge when saveStatus=saved', () => {
    render(
      <MemberCard
        member={MEMBER}
        user={OWNER_USER}
        isCurrentUser={false}
        saveStatus="saved"
        onPortionChange={() => undefined}
      />
    );
    expect(screen.getByTestId('save-status-saved')).toBeInTheDocument();
  });

  test('renders error badge when saveStatus=error', () => {
    render(
      <MemberCard
        member={MEMBER}
        user={OWNER_USER}
        isCurrentUser={false}
        saveStatus="error"
        onPortionChange={() => undefined}
      />
    );
    expect(screen.getByTestId('save-status-error')).toBeInTheDocument();
  });

  test('renders no status text when saveStatus is undefined', () => {
    render(
      <MemberCard
        member={MEMBER}
        user={OWNER_USER}
        isCurrentUser={false}
        saveStatus={undefined}
        onPortionChange={() => undefined}
      />
    );
    expect(screen.queryByTestId('save-status-saved')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-status-error')).not.toBeInTheDocument();
  });
});

describe('MemberCard — interactions', () => {
  test('forwards slider onChange to onPortionChange', () => {
    const onPortionChange = vi.fn();
    render(
      <MemberCard
        member={MEMBER}
        user={OWNER_USER}
        isCurrentUser={true}
        saveStatus={undefined}
        onPortionChange={onPortionChange}
      />
    );

    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1.3' } });
    expect(onPortionChange).toHaveBeenCalledWith(1.3);
  });

  test('disables the slider when sliderDisabled=true', () => {
    render(
      <MemberCard
        member={MEMBER}
        user={OWNER_USER}
        isCurrentUser={false}
        saveStatus={undefined}
        onPortionChange={() => undefined}
        sliderDisabled={true}
      />
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider).toBeDisabled();
  });
});

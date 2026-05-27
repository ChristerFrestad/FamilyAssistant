// Tests for useFamilyData.
//
// Drives the hook via dependency injection (overrides) so we don't
// need MSW or a fetch-spy. The state machine itself — initial load,
// optimistic update, rollback on failure, abort on rapid drags —
// is what we exercise here.

import { renderHook, act, waitFor } from '@testing-library/react';
import { test, expect, vi, describe } from 'vitest';
import { useFamilyData, joinMembersWithUsers, type ProfileMemberWithUser } from './useFamilyData';
import type { FamilyResponse, ProfileMember, FamilyUser } from './familyApi';

const MEMBER_CHRISTER: ProfileMember = {
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

const MEMBER_KID: ProfileMember = {
  id: 11,
  name: 'Storebror',
  category: 'child',
  portionFactor: 0.5,
  sortOrder: 1,
  allergies: null,
  dislikes: null,
  dietTags: [],
  customDietNote: null,
  createdAt: '2026-04-01 12:00:00',
  updatedAt: '2026-04-01 12:00:00',
};

const USER_CHRISTER: FamilyUser = {
  id: 1,
  email: 'peder@example.com',
  name: 'Christer',
  avatarUrl: null,
  role: 'owner',
  profileMemberId: 10,
  lastSeenAt: '2026-04-29 09:00:00',
};

const FAMILY_OK: FamilyResponse = {
  family: {
    id: 1,
    name: 'Familie Frestad',
    ownerUserId: 1,
    createdAt: '2026-04-01 12:00:00',
    updatedAt: '2026-04-01 12:00:00',
  },
  profileMembers: [MEMBER_CHRISTER, MEMBER_KID],
  users: [USER_CHRISTER],
  portionSum: 1.5,
};

describe('useFamilyData — initial load', () => {
  test('starts in loading state and resolves to data', async () => {
    const fetchFamily = vi.fn(() => Promise.resolve(FAMILY_OK));
    const updateMemberPortion = vi.fn();

    const { result } = renderHook(() => useFamilyData({ fetchFamily, updateMemberPortion }));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual(FAMILY_OK);
    expect(result.current.error).toBeNull();
    expect(fetchFamily).toHaveBeenCalledTimes(1);
  });

  test('surfaces fetch errors as Error instances', async () => {
    const boom = new Error('500');
    const fetchFamily = vi.fn(() => Promise.reject(boom));
    const updateMemberPortion = vi.fn();

    const { result } = renderHook(() => useFamilyData({ fetchFamily, updateMemberPortion }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe(boom);
    expect(result.current.data).toBeNull();
  });

  test('retry refetches and clears errors', async () => {
    let attempts = 0;
    const fetchFamily = vi.fn(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('500')) : Promise.resolve(FAMILY_OK);
    });
    const updateMemberPortion = vi.fn();

    const { result } = renderHook(() => useFamilyData({ fetchFamily, updateMemberPortion }));
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual(FAMILY_OK);
    expect(result.current.error).toBeNull();
    expect(fetchFamily).toHaveBeenCalledTimes(2);
  });
});

describe('useFamilyData — optimistic updatePortion', () => {
  test('flips local value immediately and confirms after server resolves', async () => {
    const fetchFamily = vi.fn(() => Promise.resolve(FAMILY_OK));
    const updateMemberPortion = vi.fn(async (memberId: number, portionFactor: number) => ({
      ok: true as const,
      member: { ...MEMBER_CHRISTER, id: memberId, portionFactor },
    }));

    const { result } = renderHook(() => useFamilyData({ fetchFamily, updateMemberPortion }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let updatePromise!: Promise<void>;
    act(() => {
      updatePromise = result.current.updatePortion(10, 1.2);
    });

    // Optimistic — local state already shows the new value.
    expect(result.current.data?.profileMembers.find((m) => m.id === 10)?.portionFactor).toBe(1.2);
    expect(result.current.memberSaveStatus[10]).toBe('saving');

    await act(async () => {
      await updatePromise;
    });

    await waitFor(() => {
      expect(result.current.memberSaveStatus[10]).toBe('saved');
    });
    expect(result.current.data?.profileMembers.find((m) => m.id === 10)?.portionFactor).toBe(1.2);
  });

  test('rolls back on server error and reports error status', async () => {
    const fetchFamily = vi.fn(() => Promise.resolve(FAMILY_OK));
    const updateMemberPortion = vi.fn(() => Promise.reject(new Error('500')));

    const { result } = renderHook(() => useFamilyData({ fetchFamily, updateMemberPortion }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updatePortion(10, 1.5);
    });

    expect(result.current.data?.profileMembers.find((m) => m.id === 10)?.portionFactor).toBe(1.0);
    expect(result.current.memberSaveStatus[10]).toBe('error');
  });

  test('rapid drags cancel earlier in-flight updates', async () => {
    const fetchFamily = vi.fn(() => Promise.resolve(FAMILY_OK));
    type Settle = (value: { ok: true; member: ProfileMember }) => void;
    const settles: Settle[] = [];
    const updateMemberPortion = vi.fn(
      (memberId: number, portionFactor: number, signal?: AbortSignal) =>
        new Promise<{ ok: true; member: ProfileMember }>((resolve, reject) => {
          settles.push(resolve);
          if (signal) {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }
          // Use the args so noUnusedParameters is satisfied
          void memberId;
          void portionFactor;
        })
    );

    const { result } = renderHook(() => useFamilyData({ fetchFamily, updateMemberPortion }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Two rapid drags — second should abort the first.
    act(() => {
      void result.current.updatePortion(10, 1.2);
    });
    act(() => {
      void result.current.updatePortion(10, 1.4);
    });

    expect(updateMemberPortion).toHaveBeenCalledTimes(2);
    expect(result.current.data?.profileMembers.find((m) => m.id === 10)?.portionFactor).toBe(1.4);

    // Second resolves — verify state reflects the second value.
    await act(async () => {
      settles[1]!({
        ok: true as const,
        member: { ...MEMBER_CHRISTER, portionFactor: 1.4 },
      });
    });

    await waitFor(() => {
      expect(result.current.memberSaveStatus[10]).toBe('saved');
    });
    expect(result.current.data?.profileMembers.find((m) => m.id === 10)?.portionFactor).toBe(1.4);
  });
});

describe('joinMembersWithUsers', () => {
  test('attaches linked user and marks current user', () => {
    const joined: ProfileMemberWithUser[] = joinMembersWithUsers(FAMILY_OK, 10);
    expect(joined).toHaveLength(2);
    expect(joined[0]?.member.id).toBe(10);
    expect(joined[0]?.user?.role).toBe('owner');
    expect(joined[0]?.isCurrentUser).toBe(true);
    expect(joined[1]?.member.id).toBe(11);
    expect(joined[1]?.user).toBeNull();
    expect(joined[1]?.isCurrentUser).toBe(false);
  });

  test('returns empty isCurrentUser when no current user is set', () => {
    const joined = joinMembersWithUsers(FAMILY_OK, null);
    expect(joined.every((j) => j.isCurrentUser === false)).toBe(true);
  });
});

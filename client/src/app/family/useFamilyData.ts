// Hook that orchestrates the Family screen's data fetching and
// portion-factor updates.
//
// Responsibilities:
//   - Initial fetch of /api/family on mount; per-screen abort on
//     unmount.
//   - Optimistic update for portion-factor changes: local state
//     flips immediately, the PUT runs in the background, and on
//     failure the change rolls back to the previous value.
//   - Per-member AbortController so a fast slider drag (multiple
//     updates in quick succession) only delivers the latest value
//     to the server. Earlier in-flight requests are cancelled.
//   - Per-member save-status ("idle" | "saving" | "saved" | "error")
//     so MemberCard can display inline feedback under the slider.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchFamily,
  updateMemberPortion,
  type FamilyResponse,
  type ProfileMember,
} from './familyApi';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseFamilyDataResult {
  data: FamilyResponse | null;
  isLoading: boolean;
  error: Error | null;
  /** Per-member save state, keyed by profile_member.id. */
  memberSaveStatus: Record<number, SaveStatus>;
  /** Re-fetch the screen. Resets save-statuses to idle. */
  retry: () => void;
  /**
   * Optimistic portion-factor update. Resolves once the server
   * round-trip settles (success OR rollback). Never throws —
   * callers consume the resolved status via memberSaveStatus.
   */
  updatePortion: (memberId: number, portionFactor: number) => Promise<void>;
}

export interface UseFamilyDataOverrides {
  fetchFamily?: typeof fetchFamily;
  updateMemberPortion?: typeof updateMemberPortion;
}

const SAVED_RESET_MS = 1500;

export function useFamilyData(overrides: UseFamilyDataOverrides = {}): UseFamilyDataResult {
  const [data, setData] = useState<FamilyResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [memberSaveStatus, setMemberSaveStatus] = useState<Record<number, SaveStatus>>({});

  const fetchCtrlRef = useRef<AbortController | null>(null);
  const memberCtrlsRef = useRef<Map<number, AbortController>>(new Map());
  const savedTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const fetchFn = overrides.fetchFamily ?? fetchFamily;
  const updateFn = overrides.updateMemberPortion ?? updateMemberPortion;

  const load = useCallback((): void => {
    fetchCtrlRef.current?.abort();
    const ctrl = new AbortController();
    fetchCtrlRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    setMemberSaveStatus({});
    fetchFn(ctrl.signal).then(
      (res) => {
        if (ctrl.signal.aborted) return;
        setData(res);
        setIsLoading(false);
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setData(null);
        setIsLoading(false);
        setError(err instanceof Error ? err : new Error('Failed to load family'));
      }
    );
  }, [fetchFn]);

  const updatePortion = useCallback(
    async (memberId: number, portionFactor: number): Promise<void> => {
      // Snapshot previous value for rollback. If data is null we
      // are being asked to update before the initial fetch landed —
      // that should never happen in practice, but defensively bail
      // out instead of building a stale snapshot.
      const previous = data?.profileMembers.find((m) => m.id === memberId);
      if (!previous || !data) return;
      const previousValue = previous.portionFactor;

      // Cancel any in-flight save for this member so a fast drag
      // produces only one server-side write per drag pause.
      memberCtrlsRef.current.get(memberId)?.abort();
      // Also clear any pending "saved" reset — a new save in
      // progress should not flicker through "saved" before settling.
      const existingTimer = savedTimersRef.current.get(memberId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        savedTimersRef.current.delete(memberId);
      }

      const ctrl = new AbortController();
      memberCtrlsRef.current.set(memberId, ctrl);

      // Optimistic local update.
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          profileMembers: current.profileMembers.map((m) =>
            m.id === memberId ? { ...m, portionFactor } : m
          ),
        };
      });
      setMemberSaveStatus((prev) => ({ ...prev, [memberId]: 'saving' }));

      try {
        const res = await updateFn(memberId, portionFactor, ctrl.signal);
        if (ctrl.signal.aborted) return;
        // Server-confirmed value (may equal what we sent, or be
        // clamped). Trust the server and overwrite local state.
        setData((current) => {
          if (!current) return current;
          return {
            ...current,
            profileMembers: current.profileMembers.map((m) => (m.id === memberId ? res.member : m)),
          };
        });
        setMemberSaveStatus((prev) => ({ ...prev, [memberId]: 'saved' }));
        const timer = setTimeout(() => {
          setMemberSaveStatus((prev) => {
            // Only reset to idle if we are still in the saved state —
            // a new save kicked off in the meantime would have
            // overwritten this and we don't want to clobber it.
            if (prev[memberId] !== 'saved') return prev;
            const next = { ...prev };
            delete next[memberId];
            return next;
          });
          savedTimersRef.current.delete(memberId);
        }, SAVED_RESET_MS);
        savedTimersRef.current.set(memberId, timer);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        // Rollback. Defensive — if the same member was updated again
        // in the meantime we should NOT clobber the newer value.
        setData((current) => {
          if (!current) return current;
          return {
            ...current,
            profileMembers: current.profileMembers.map((m) =>
              m.id === memberId && m.portionFactor === portionFactor
                ? { ...m, portionFactor: previousValue }
                : m
            ),
          };
        });
        setMemberSaveStatus((prev) => ({ ...prev, [memberId]: 'error' }));
        // Surface the type to satisfy strict-mode unused-locals
        // when we expand error handling later.
        void err;
      }
    },
    [data, updateFn]
  );

  useEffect(() => {
    load();
    const fetchCtrl = fetchCtrlRef.current;
    const memberCtrls = memberCtrlsRef.current;
    const savedTimers = savedTimersRef.current;
    return () => {
      fetchCtrl?.abort();
      memberCtrls.forEach((c) => c.abort());
      memberCtrls.clear();
      savedTimers.forEach((t) => clearTimeout(t));
      savedTimers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    data,
    isLoading,
    error,
    memberSaveStatus,
    retry: load,
    updatePortion,
  };
}

/**
 * Helper used by Family.tsx to attach the linked user (if any) to
 * each profile_member row. Pure function so the join logic is
 * trivially testable separate from the hook.
 */
export interface ProfileMemberWithUser {
  member: ProfileMember;
  user: FamilyResponse['users'][number] | null;
  isCurrentUser: boolean;
}

export function joinMembersWithUsers(
  data: FamilyResponse,
  currentUserProfileMemberId: number | null
): ProfileMemberWithUser[] {
  return data.profileMembers.map((member) => {
    const user = data.users.find((u) => u.profileMemberId === member.id) ?? null;
    const isCurrentUser =
      currentUserProfileMemberId !== null && currentUserProfileMemberId === member.id;
    return { member, user, isCurrentUser };
  });
}

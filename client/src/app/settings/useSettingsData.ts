// Orchestrates the Settings screen's data + mutation flows.
//
// Mirrors useShoppingData / usePantryData: one initial fetch on
// mount, optimistic mutation with rollback, userFacingError surface
// for toasts. The single mutation is renameFamily (owner-only); the
// GDPR actions (export + delete) are one-shot helpers that do not
// touch the cached state.
//
// The hook also derives the current user (the one logged in) from
// the family payload by matching session-cookie identity. We do
// that via a separate /api/auth/me fetch — but to keep this PR
// focused on existing endpoints, we resolve currentUser by picking
// the user whose role + email match what the AuthContext already
// exposes. Since AuthContext is the source of truth for the
// authenticated user, we read it from there and do the join in the
// component layer.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchFamily,
  renameFamily as apiRenameFamily,
  exportMyData as apiExportMyData,
  deleteMyAccount as apiDeleteMyAccount,
  SettingsApiError,
  type FamilyResponse,
} from './settingsApi';

export interface UseSettingsDataResult {
  family: FamilyResponse | null;
  isLoading: boolean;
  error: Error | null;
  /** Last error from a mutation, surfaced as a toast. Cleared on next success. */
  userFacingError: { message: string; code: string | null } | null;
  retry: () => void;
  renameFamily: (name: string) => Promise<boolean>;
  exportMyData: () => Promise<unknown | null>;
  deleteMyAccount: () => Promise<{ ok: true; hardDeleteAt: string; graceDays: number } | null>;
  clearUserFacingError: () => void;
}

export interface UseSettingsDataOverrides {
  fetchFamily?: typeof fetchFamily;
  renameFamily?: typeof apiRenameFamily;
  exportMyData?: typeof apiExportMyData;
  deleteMyAccount?: typeof apiDeleteMyAccount;
}

export function useSettingsData(overrides: UseSettingsDataOverrides = {}): UseSettingsDataResult {
  const fetchFn = overrides.fetchFamily ?? fetchFamily;
  const renameFn = overrides.renameFamily ?? apiRenameFamily;
  const exportFn = overrides.exportMyData ?? apiExportMyData;
  const deleteFn = overrides.deleteMyAccount ?? apiDeleteMyAccount;

  const [family, setFamily] = useState<FamilyResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [userFacingError, setUserFacingError] =
    useState<UseSettingsDataResult['userFacingError']>(null);

  const ctrlRef = useRef<AbortController | null>(null);

  const load = useCallback((): void => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    fetchFn(ctrl.signal).then(
      (res: FamilyResponse) => {
        if (ctrl.signal.aborted) return;
        setFamily(res);
        setIsLoading(false);
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setFamily(null);
        setIsLoading(false);
        setError(err instanceof Error ? err : new Error('Failed to load family'));
      }
    );
  }, [fetchFn]);

  useEffect(() => {
    load();
    const ctrl = ctrlRef.current;
    return () => {
      ctrl?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renameFamily = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 100) {
        setUserFacingError({ message: 'Family name is required (max 100 chars).', code: null });
        return false;
      }
      const snapshot = family;
      // Optimistic update.
      setFamily((prev) =>
        prev
          ? {
              ...prev,
              family: { ...prev.family, name: trimmed },
            }
          : prev
      );
      try {
        const res = await renameFn(trimmed);
        // Replace optimistic with server-canonical (carries updated_at).
        setFamily((prev) =>
          prev
            ? {
                ...prev,
                family: res.family,
              }
            : prev
        );
        setUserFacingError(null);
        return true;
      } catch (err) {
        setFamily(snapshot);
        const code = err instanceof SettingsApiError ? err.code : null;
        const message = err instanceof Error ? err.message : 'Kunne ikke lagre familienavn';
        setUserFacingError({ message, code });
        return false;
      }
    },
    [family, renameFn]
  );

  const exportMyData = useCallback(async (): Promise<unknown | null> => {
    try {
      const data = await exportFn();
      setUserFacingError(null);
      return data;
    } catch (err) {
      const code = err instanceof SettingsApiError ? err.code : null;
      const message = err instanceof Error ? err.message : 'Kunne ikke laste ned data';
      setUserFacingError({ message, code });
      return null;
    }
  }, [exportFn]);

  const deleteMyAccount = useCallback(async (): Promise<{
    ok: true;
    hardDeleteAt: string;
    graceDays: number;
  } | null> => {
    try {
      const res = await deleteFn();
      setUserFacingError(null);
      return res;
    } catch (err) {
      const code = err instanceof SettingsApiError ? err.code : null;
      const message = err instanceof Error ? err.message : 'Kunne ikke slette konto';
      setUserFacingError({ message, code });
      return null;
    }
  }, [deleteFn]);

  const clearUserFacingError = useCallback(() => setUserFacingError(null), []);

  return {
    family,
    isLoading,
    error,
    userFacingError,
    retry: load,
    renameFamily,
    exportMyData,
    deleteMyAccount,
    clearUserFacingError,
  };
}

// Tests for useSettingsData.ts. Verifies orchestration:
//   - initial fetch + loading/error states
//   - renameFamily: optimistic update + rollback
//   - exportMyData: returns parsed payload, surfaces errors
//   - deleteMyAccount: returns response, surfaces errors
//   - userFacingError surfacing + clearing
//   - validation: empty name, name > 100 chars

import { renderHook, waitFor, act } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { useSettingsData } from './useSettingsData';
import { SettingsApiError, type FamilyResponse } from './settingsApi';

function makeFamily(over: Partial<FamilyResponse['family']> = {}): FamilyResponse {
  return {
    family: {
      id: 1,
      name: 'Frestad',
      ownerUserId: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
      ...over,
    },
    profileMembers: [],
    users: [],
    portionSum: 1,
  };
}

function fetchOk(payload: FamilyResponse) {
  return vi.fn().mockResolvedValue(payload);
}

describe('useSettingsData — initial load', () => {
  test('exposes loading then resolves with family', async () => {
    const fetchFn = fetchOk(makeFamily());
    const { result } = renderHook(() => useSettingsData({ fetchFamily: fetchFn }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.family?.family.name).toBe('Frestad');
    expect(result.current.error).toBeNull();
  });

  test('exposes error when fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new SettingsApiError(403, 'forbidden'));
    const { result } = renderHook(() => useSettingsData({ fetchFamily: fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.family).toBeNull();
  });

  test('retry triggers a fresh fetch', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new SettingsApiError(500, 'boom'))
      .mockResolvedValueOnce(makeFamily());
    const { result } = renderHook(() => useSettingsData({ fetchFamily: fetchFn }));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.family?.family.name).toBe('Frestad');
  });
});

describe('useSettingsData — renameFamily', () => {
  test('optimistically updates name and confirms with server response', async () => {
    const fetchFn = fetchOk(makeFamily({ name: 'Frestad' }));
    const renameFn = vi.fn().mockResolvedValue({
      ok: true,
      family: {
        id: 1,
        name: 'Hverdagsplanleggeren',
        ownerUserId: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    });
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, renameFamily: renameFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.renameFamily('Hverdagsplanleggeren');
    });
    expect(success).toBe(true);
    expect(renameFn).toHaveBeenCalledWith('Hverdagsplanleggeren');
    expect(result.current.family?.family.name).toBe('Hverdagsplanleggeren');
  });

  test('rolls back name on failure', async () => {
    const fetchFn = fetchOk(makeFamily({ name: 'Original' }));
    const renameFn = vi.fn().mockRejectedValue(new SettingsApiError(403, 'forbidden'));
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, renameFamily: renameFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.renameFamily('NewName');
    });
    expect(success).toBe(false);
    expect(result.current.family?.family.name).toBe('Original');
    expect(result.current.userFacingError?.message).toContain('forbidden');
  });

  test('rejects empty name without API call', async () => {
    const fetchFn = fetchOk(makeFamily());
    const renameFn = vi.fn();
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, renameFamily: renameFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const ok = await result.current.renameFamily('   ');
      expect(ok).toBe(false);
    });
    expect(renameFn).not.toHaveBeenCalled();
    expect(result.current.userFacingError).not.toBeNull();
  });

  test('rejects name longer than 100 chars without API call', async () => {
    const fetchFn = fetchOk(makeFamily());
    const renameFn = vi.fn();
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, renameFamily: renameFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const ok = await result.current.renameFamily('A'.repeat(101));
      expect(ok).toBe(false);
    });
    expect(renameFn).not.toHaveBeenCalled();
  });
});

describe('useSettingsData — exportMyData', () => {
  test('returns the parsed payload on success', async () => {
    const fetchFn = fetchOk(makeFamily());
    const exportFn = vi.fn().mockResolvedValue({ exportVersion: 1, user: { email: 'x@y' } });
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, exportMyData: exportFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let payload: unknown;
    await act(async () => {
      payload = await result.current.exportMyData();
    });
    expect(payload).toEqual({ exportVersion: 1, user: { email: 'x@y' } });
  });

  test('returns null and surfaces error on failure', async () => {
    const fetchFn = fetchOk(makeFamily());
    const exportFn = vi.fn().mockRejectedValue(new SettingsApiError(401, 'login required'));
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, exportMyData: exportFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const out = await result.current.exportMyData();
      expect(out).toBeNull();
    });
    expect(result.current.userFacingError?.message).toContain('login required');
  });
});

describe('useSettingsData — deleteMyAccount', () => {
  test('returns response on success', async () => {
    const fetchFn = fetchOk(makeFamily());
    const deleteFn = vi
      .fn()
      .mockResolvedValue({ ok: true, hardDeleteAt: '2026-05-31', graceDays: 30 });
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, deleteMyAccount: deleteFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let res: unknown;
    await act(async () => {
      res = await result.current.deleteMyAccount();
    });
    expect(res).toMatchObject({ ok: true, graceDays: 30 });
  });

  test('returns null and surfaces error on owner-with-family rejection', async () => {
    const fetchFn = fetchOk(makeFamily());
    const deleteFn = vi
      .fn()
      .mockRejectedValue(
        new SettingsApiError(403, 'Transfer ownership or delete the family first.')
      );
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, deleteMyAccount: deleteFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const out = await result.current.deleteMyAccount();
      expect(out).toBeNull();
    });
    expect(result.current.userFacingError?.message).toContain('Transfer ownership');
  });
});

describe('useSettingsData — clearUserFacingError', () => {
  test('clears the toast', async () => {
    const fetchFn = fetchOk(makeFamily());
    const renameFn = vi.fn().mockRejectedValue(new SettingsApiError(403, 'no'));
    const { result } = renderHook(() =>
      useSettingsData({ fetchFamily: fetchFn, renameFamily: renameFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.renameFamily('X');
    });
    expect(result.current.userFacingError).not.toBeNull();

    act(() => {
      result.current.clearUserFacingError();
    });
    expect(result.current.userFacingError).toBeNull();
  });
});

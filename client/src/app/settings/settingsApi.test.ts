// Tests for settingsApi.ts — verifies request shaping (method/path/body),
// response parsing, and error mapping. Network is mocked via vi.fn().

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SettingsApiError,
  fetchFamily,
  renameFamily,
  exportMyData,
  deleteMyAccount,
} from './settingsApi';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchFamily', () => {
  test('GETs /api/family with credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        family: { id: 1, name: 'Frestad', ownerUserId: 1, createdAt: '', updatedAt: '' },
        profileMembers: [],
        users: [],
        portionSum: 1,
      })
    );
    const res = await fetchFamily();
    expect(res.family.name).toBe('Frestad');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/family',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      })
    );
  });

  test('forwards AbortSignal', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        family: { id: 1, name: 'F', ownerUserId: 1, createdAt: '', updatedAt: '' },
        profileMembers: [],
        users: [],
        portionSum: 1,
      })
    );
    const ctrl = new AbortController();
    await fetchFamily(ctrl.signal);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });

  test('throws SettingsApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: 'forbidden' }));
    await expect(fetchFamily()).rejects.toMatchObject({
      name: 'SettingsApiError',
      status: 403,
    });
  });
});

describe('renameFamily', () => {
  test('PUTs to /api/family with name', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        family: { id: 1, name: 'New Name', ownerUserId: 1, createdAt: '', updatedAt: '' },
      })
    );
    const res = await renameFamily('New Name');
    expect(res.ok).toBe(true);
    expect(res.family.name).toBe('New Name');
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/family');
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'New Name' });
  });

  test('throws when not owner', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: 'Owner role required' }));
    await expect(renameFamily('X')).rejects.toMatchObject({
      name: 'SettingsApiError',
      status: 403,
    });
  });
});

describe('exportMyData', () => {
  test('GETs /api/me/export and returns parsed body', async () => {
    const exportPayload = { exportVersion: 1, user: { email: 'x@y' }, family: {} };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, exportPayload));
    const data = await exportMyData();
    expect(data).toEqual(exportPayload);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/export',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
  });

  test('throws on auth failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: 'Login required.' }));
    await expect(exportMyData()).rejects.toMatchObject({
      name: 'SettingsApiError',
      status: 401,
    });
  });
});

describe('deleteMyAccount', () => {
  test('DELETEs /api/me and returns hardDeleteAt + graceDays', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, hardDeleteAt: '2026-05-31T12:00:00Z', graceDays: 30 })
    );
    const res = await deleteMyAccount();
    expect(res.ok).toBe(true);
    expect(res.graceDays).toBe(30);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' })
    );
  });

  test('throws when owner with family attached', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, {
        detail: 'Transfer ownership or delete the family before deleting your account.',
      })
    );
    await expect(deleteMyAccount()).rejects.toMatchObject({
      name: 'SettingsApiError',
      status: 403,
    });
  });
});

describe('SettingsApiError', () => {
  test('preserves status, code, and message', () => {
    const e = new SettingsApiError(409, 'conflict', 'CONFLICT');
    expect(e.status).toBe(409);
    expect(e.code).toBe('CONFLICT');
    expect(e.message).toBe('conflict');
    expect(e.name).toBe('SettingsApiError');
  });
});

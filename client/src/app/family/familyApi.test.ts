// Tests for familyApi.ts.
//
// Three contracts:
//   1. Each helper hits the right URL with credentials: 'include'.
//   2. Non-2xx responses throw FamilyApiError carrying the status.
//   3. updateMemberPortion sends portionFactor in the JSON body.

import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { fetchFamily, updateMemberPortion, FamilyApiError } from './familyApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('fetchFamily', () => {
  test('GETs /api/family with credentials and parses the body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        family: {
          id: 1,
          name: 'Familie Frestad',
          ownerUserId: 1,
          createdAt: '2026-04-01 12:00:00',
          updatedAt: '2026-04-01 12:00:00',
        },
        profileMembers: [],
        users: [],
        portionSum: 0,
      })
    );
    const r = await fetchFamily();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/family',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(r.family.name).toBe('Familie Frestad');
    expect(r.profileMembers).toEqual([]);
  });

  test('throws FamilyApiError carrying the status on 500', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    try {
      await fetchFamily();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FamilyApiError);
      expect((err as FamilyApiError).status).toBe(500);
    }
  });

  test('throws FamilyApiError on 401', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'unauthorized' }));
    await expect(fetchFamily()).rejects.toBeInstanceOf(FamilyApiError);
  });
});

describe('updateMemberPortion', () => {
  test('PUTs /api/family/members/:id with portionFactor in body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        member: {
          id: 5,
          name: 'Christer',
          category: 'adult',
          portionFactor: 1.2,
          sortOrder: 0,
          allergies: null,
          dislikes: null,
          dietTags: [],
          customDietNote: null,
          createdAt: '2026-04-01 12:00:00',
          updatedAt: '2026-04-29 09:00:00',
        },
      })
    );
    const r = await updateMemberPortion(5, 1.2);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/family/members/5',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ portionFactor: 1.2 }),
      })
    );
    expect(r.member.portionFactor).toBe(1.2);
  });

  test('throws FamilyApiError on 403', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(403, { detail: 'role-required' }));
    try {
      await updateMemberPortion(5, 1.2);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FamilyApiError);
      expect((err as FamilyApiError).status).toBe(403);
    }
  });

  test('forwards AbortSignal to fetch', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        member: {
          id: 5,
          name: 'Christer',
          category: 'adult',
          portionFactor: 1.0,
          sortOrder: 0,
          allergies: null,
          dislikes: null,
          dietTags: [],
          customDietNote: null,
          createdAt: '2026-04-01 12:00:00',
          updatedAt: '2026-04-29 09:00:00',
        },
      })
    );
    const ctrl = new AbortController();
    await updateMemberPortion(5, 1.0, ctrl.signal);
    const callArgs = fetchSpy.mock.calls[0]?.[1];
    expect((callArgs as RequestInit | undefined)?.signal).toBe(ctrl.signal);
  });
});

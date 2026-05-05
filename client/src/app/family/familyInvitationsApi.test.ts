// Tests for familyInvitationsApi.ts.
//
// Verifies:
//   1. Each helper hits the right URL with the right method and
//      credentials: 'include'.
//   2. Non-2xx responses throw FamilyInvitationsApiError carrying the
//      status, the machine-readable code, and the detail string.
//   3. createInvitation forwards email + role + invitationMessage +
//      locale in the JSON body.

import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import {
  acceptInvitation,
  createInvitation,
  FamilyInvitationsApiError,
  listInvitations,
  peekInvitation,
  resendInvitation,
  revokeInvitation,
} from './familyInvitationsApi';

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

describe('createInvitation', () => {
  test('POSTs /api/family/invitations with full body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        invitation: {
          id: 1,
          token: 'tok',
          url: '/v2/invite/tok',
          assignedRole: 'adult',
          profileMemberId: null,
          invitedEmail: 'a@test.no',
          invitationMessage: 'Velkommen!',
          locale: 'no',
          expiresAt: '2026-05-12 12:00:00',
          createdAt: '2026-05-05 12:00:00',
        },
      })
    );

    const r = await createInvitation({
      email: 'a@test.no',
      role: 'adult',
      invitationMessage: 'Velkommen!',
      locale: 'no',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/family/invitations');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      email: 'a@test.no',
      role: 'adult',
      invitationMessage: 'Velkommen!',
      locale: 'no',
    });
    expect(r.invitation.invitationMessage).toBe('Velkommen!');
  });

  test('surfaces 409 EMAIL_ALREADY_MEMBER as code on the error', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(409, {
        title: 'Conflict',
        status: 409,
        detail: 'This email is already a member of the family.',
        code: 'EMAIL_ALREADY_MEMBER',
      })
    );
    try {
      await createInvitation({ email: 'x@test.no', role: 'adult' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FamilyInvitationsApiError);
      expect((err as FamilyInvitationsApiError).status).toBe(409);
      expect((err as FamilyInvitationsApiError).code).toBe('EMAIL_ALREADY_MEMBER');
    }
  });

  test('surfaces 409 EMAIL_ALREADY_INVITED as code on the error', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(409, {
        title: 'Conflict',
        detail: 'This email already has a pending invitation.',
        code: 'EMAIL_ALREADY_INVITED',
      })
    );
    await expect(createInvitation({ email: 'x@test.no', role: 'adult' })).rejects.toMatchObject({
      status: 409,
      code: 'EMAIL_ALREADY_INVITED',
    });
  });
});

describe('listInvitations', () => {
  test('GETs /api/family/invitations and returns invitations array', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        invitations: [
          {
            id: 1,
            token: 't1',
            url: '/v2/invite/t1',
            assignedRole: 'adult',
            profileMemberId: null,
            invitedEmail: 'a@test.no',
            invitationMessage: null,
            locale: 'no',
            expiresAt: '2026-05-12 12:00:00',
            createdAt: '2026-05-05 12:00:00',
          },
        ],
      })
    );
    const r = await listInvitations();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/family/invitations',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(r.invitations).toHaveLength(1);
    expect(r.invitations[0]?.invitedEmail).toBe('a@test.no');
  });
});

describe('revokeInvitation', () => {
  test('DELETEs /api/family/invitations/:id and returns ok', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const r = await revokeInvitation(42);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/family/invitations/42',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' })
    );
    expect(r.ok).toBe(true);
  });

  test('throws on 404 not found', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(404, { detail: 'Invitation not found' }));
    await expect(revokeInvitation(999)).rejects.toBeInstanceOf(FamilyInvitationsApiError);
  });
});

describe('resendInvitation', () => {
  test('POSTs /api/family/invitations/:id/resend and returns new url', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        invitation: {
          id: 7,
          token: 'newtok',
          url: '/v2/invite/newtok',
          assignedRole: 'adult',
          profileMemberId: null,
          invitedEmail: 'r@test.no',
          invitationMessage: null,
          locale: 'no',
          expiresAt: '2026-05-12 12:00:00',
          createdAt: '2026-05-05 12:00:00',
        },
      })
    );
    const r = await resendInvitation(7);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/family/invitations/7/resend',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
    expect(r.invitation.token).toBe('newtok');
  });

  test('surfaces 409 INVITATION_REVOKED', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(409, {
        title: 'Conflict',
        detail: 'Cannot resend a revoked invitation.',
        code: 'INVITATION_REVOKED',
      })
    );
    await expect(resendInvitation(7)).rejects.toMatchObject({
      status: 409,
      code: 'INVITATION_REVOKED',
    });
  });
});

describe('peekInvitation', () => {
  test('GETs /api/invitations/:token and returns peek data', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        familyId: 1,
        familyName: 'Frestad',
        assignedRole: 'adult',
        inviterName: 'Christer',
        inviterEmail: 'c@test.no',
        invitedEmail: 'r@test.no',
        invitationMessage: 'Hi!',
        locale: 'no',
        expiresAt: '2026-05-12 12:00:00',
      })
    );
    const r = await peekInvitation('the-token');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/invitations/the-token',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(r.familyName).toBe('Frestad');
    expect(r.invitedEmail).toBe('r@test.no');
  });

  test('encodes the token so /+ characters round-trip safely', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(404, { detail: 'gone' }));
    await expect(peekInvitation('a/b+c')).rejects.toBeInstanceOf(FamilyInvitationsApiError);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/invitations/a%2Fb%2Bc');
  });

  test('surfaces 410 INVITATION_EXPIRED', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(410, {
        title: 'Gone',
        detail: 'This invitation has expired.',
        code: 'INVITATION_EXPIRED',
      })
    );
    await expect(peekInvitation('expired-tok')).rejects.toMatchObject({
      status: 410,
      code: 'INVITATION_EXPIRED',
    });
  });
});

describe('acceptInvitation', () => {
  test('POSTs /api/invitations/:token/accept and returns user + family', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        user: {
          id: 5,
          email: 'r@test.no',
          name: 'Receiver',
          role: 'adult',
          familyId: 7,
          profileMemberId: null,
        },
        family: { id: 7, name: 'Frestad' },
      })
    );
    const r = await acceptInvitation('the-token');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/invitations/the-token/accept',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
    expect(r.user.familyId).toBe(7);
    expect(r.family.name).toBe('Frestad');
  });

  test('surfaces 403 wrong-email mismatch', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(403, {
        title: 'Forbidden',
        detail: 'This invitation is addressed to a different email.',
      })
    );
    await expect(acceptInvitation('tok')).rejects.toMatchObject({ status: 403 });
  });
});

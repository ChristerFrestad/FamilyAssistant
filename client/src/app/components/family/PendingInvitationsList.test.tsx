// Tests for PendingInvitationsList.
//
// Covers:
//   - Empty state when invitations is []
//   - Renders email, sent + expires hint, and resend/revoke buttons
//   - Resend confirms, calls API, fires onChanged with {kind:'resent'}
//   - Revoke confirms, calls API, fires onChanged with {kind:'revoked'}
//   - Cancelling the confirm leaves the list untouched
//   - 409 on the API surfaces onError

import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PendingInvitationsList } from './PendingInvitationsList';
import type { Invitation } from '../../family/familyInvitationsApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Migration 030: the listing-shape Invitation no longer carries
// `token`/`url`. The pending-list UI never rendered them anyway —
// the fixture drops both fields so the type-check is happy.
const SAMPLE: Invitation = {
  id: 7,
  assignedRole: 'adult',
  profileMemberId: null,
  invitedEmail: 'invitee@test.no',
  invitationMessage: null,
  locale: 'no',
  expiresAt: new Date(Date.now() + 6 * 86400000).toISOString().replace('T', ' ').slice(0, 19),
  createdAt: new Date(Date.now() - 30 * 60_000).toISOString().replace('T', ' ').slice(0, 19),
};

let fetchSpy: ReturnType<typeof vi.spyOn>;
let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  fetchSpy.mockRestore();
  confirmSpy.mockRestore();
});

describe('PendingInvitationsList', () => {
  test('renders empty state when invitations array is empty', () => {
    render(
      <PendingInvitationsList
        invitations={[]}
        onChanged={() => undefined}
        onError={() => undefined}
      />
    );
    expect(screen.getByTestId('pending-invitations-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-invitations-list')).not.toBeInTheDocument();
  });

  test('renders email and action buttons for each invitation', () => {
    render(
      <PendingInvitationsList
        invitations={[SAMPLE]}
        onChanged={() => undefined}
        onError={() => undefined}
      />
    );
    expect(screen.getByText('invitee@test.no')).toBeInTheDocument();
    expect(screen.getByTestId(`pending-invitation-resend-${SAMPLE.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pending-invitation-revoke-${SAMPLE.id}`)).toBeInTheDocument();
  });

  test('resend confirms then fires onChanged with kind=resent', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, invitation: SAMPLE }));
    const onChanged = vi.fn();
    render(
      <PendingInvitationsList
        invitations={[SAMPLE]}
        onChanged={onChanged}
        onError={() => undefined}
      />
    );
    fireEvent.click(screen.getByTestId(`pending-invitation-resend-${SAMPLE.id}`));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({ kind: 'resent', email: 'invitee@test.no' })
    );
    expect(confirmSpy).toHaveBeenCalled();
  });

  test('revoke confirms then fires onChanged with kind=revoked', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const onChanged = vi.fn();
    render(
      <PendingInvitationsList
        invitations={[SAMPLE]}
        onChanged={onChanged}
        onError={() => undefined}
      />
    );
    fireEvent.click(screen.getByTestId(`pending-invitation-revoke-${SAMPLE.id}`));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({ kind: 'revoked', email: 'invitee@test.no' })
    );
  });

  test('declining the confirm dialog skips the API call', () => {
    confirmSpy.mockReturnValueOnce(false);
    const onChanged = vi.fn();
    render(
      <PendingInvitationsList
        invitations={[SAMPLE]}
        onChanged={onChanged}
        onError={() => undefined}
      />
    );
    fireEvent.click(screen.getByTestId(`pending-invitation-revoke-${SAMPLE.id}`));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test('API failure on resend surfaces onError', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(409, {
        detail: 'Cannot resend a revoked invitation',
        code: 'INVITATION_REVOKED',
      })
    );
    const onError = vi.fn();
    render(
      <PendingInvitationsList
        invitations={[SAMPLE]}
        onChanged={() => undefined}
        onError={onError}
      />
    );
    fireEvent.click(screen.getByTestId(`pending-invitation-resend-${SAMPLE.id}`));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

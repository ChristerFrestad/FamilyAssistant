// Tests for InviteMemberModal.
//
// Covers:
//   - Renders title + form fields when open
//   - Email validation: blank submit disabled; invalid format shows
//     inline error after blur
//   - Submit success calls onSuccess with the invitation and onClose
//   - 409 EMAIL_ALREADY_MEMBER + EMAIL_ALREADY_INVITED route to inline
//     error under the email field
//   - Personal-message char counter updates and overflow disables submit
//   - Cancel button calls onClose

import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InviteMemberModal } from './InviteMemberModal';
import type { InvitationWithSecret } from '../../family/familyInvitationsApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Migration 030: the create-response carries `token` + `url` one-shot
// (InvitationWithSecret), while the listing-shape Invitation does not.
// SAMPLE here mocks the create-response, so InvitationWithSecret is
// the right type.
const SAMPLE_INVITATION: InvitationWithSecret = {
  id: 1,
  token: 'tok',
  url: '/invite/tok',
  assignedRole: 'adult',
  profileMemberId: null,
  invitedEmail: 'a@test.no',
  invitationMessage: null,
  locale: 'no',
  expiresAt: '2026-05-12 12:00:00',
  createdAt: '2026-05-05 12:00:00',
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('InviteMemberModal', () => {
  test('renders title and primary form controls when open', () => {
    render(<InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    expect(screen.getByText(/Inviter medlem til familien/i)).toBeInTheDocument();
    expect(screen.getByTestId('invite-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('invite-message-input')).toBeInTheDocument();
    expect(screen.getByTestId('invite-submit')).toBeDisabled();
  });

  test('does not render anything when open=false', () => {
    render(
      <InviteMemberModal open={false} onClose={() => undefined} onSuccess={() => undefined} />
    );
    expect(screen.queryByText(/Inviter medlem til familien/i)).not.toBeInTheDocument();
  });

  test('shows invalid-email error after blur with non-empty invalid value', () => {
    render(<InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    const input = screen.getByTestId('invite-email-input');
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.blur(input);
    expect(screen.getByText(/Skriv inn en gyldig e-postadresse/i)).toBeInTheDocument();
    expect(screen.getByTestId('invite-submit')).toBeDisabled();
  });

  test('character counter reflects message length and disables submit at >500', () => {
    render(<InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    fireEvent.change(screen.getByTestId('invite-email-input'), {
      target: { value: 'ok@test.no' },
    });
    fireEvent.blur(screen.getByTestId('invite-email-input'));
    fireEvent.change(screen.getByTestId('invite-message-input'), {
      target: { value: 'x'.repeat(501) },
    });
    expect(screen.getByTestId('invite-message-counter')).toHaveTextContent('501');
    expect(screen.getByTestId('invite-submit')).toBeDisabled();
  });

  test('submits and calls onSuccess on 200', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, invitation: SAMPLE_INVITATION }));
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<InviteMemberModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByTestId('invite-email-input'), {
      target: { value: 'a@test.no' },
    });
    fireEvent.click(screen.getByTestId('invite-submit'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(SAMPLE_INVITATION));
    expect(onClose).toHaveBeenCalled();
  });

  test('409 EMAIL_ALREADY_MEMBER renders inline error under email', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(409, { detail: 'Already member', code: 'EMAIL_ALREADY_MEMBER' })
    );
    render(<InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    fireEvent.change(screen.getByTestId('invite-email-input'), {
      target: { value: 'a@test.no' },
    });
    fireEvent.click(screen.getByTestId('invite-submit'));
    await waitFor(() =>
      expect(screen.getByText(/allerede medlem av familien/i)).toBeInTheDocument()
    );
  });

  test('409 EMAIL_ALREADY_INVITED renders inline error under email', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(409, { detail: 'Already invited', code: 'EMAIL_ALREADY_INVITED' })
    );
    render(<InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />);
    fireEvent.change(screen.getByTestId('invite-email-input'), {
      target: { value: 'a@test.no' },
    });
    fireEvent.click(screen.getByTestId('invite-submit'));
    await waitFor(() => expect(screen.getByText(/allerede invitert/i)).toBeInTheDocument());
  });

  test('500 from server renders generic error and stays open', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    const onClose = vi.fn();
    render(<InviteMemberModal open={true} onClose={onClose} onSuccess={() => undefined} />);
    fireEvent.change(screen.getByTestId('invite-email-input'), {
      target: { value: 'a@test.no' },
    });
    fireEvent.click(screen.getByTestId('invite-submit'));
    await waitFor(() => expect(screen.getByTestId('invite-generic-error')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  test('cancel button closes the modal', () => {
    const onClose = vi.fn();
    render(<InviteMemberModal open={true} onClose={onClose} onSuccess={() => undefined} />);
    fireEvent.click(screen.getByTestId('invite-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  // Locale-picker tests (issue #121).
  describe('email-language picker', () => {
    test('defaults to Norwegian when the inviter is using the Norwegian UI', () => {
      // The test bootstrap initialises i18next with language 'no'; the
      // modal should mirror that by default.
      render(
        <InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />
      );
      expect(screen.getByTestId('invite-locale-no')).toBeChecked();
      expect(screen.getByTestId('invite-locale-en')).not.toBeChecked();
    });

    test('explicit English override forwards locale=en in the submit payload', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { ok: true, invitation: SAMPLE_INVITATION })
      );
      render(
        <InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />
      );
      fireEvent.change(screen.getByTestId('invite-email-input'), {
        target: { value: 'a@test.no' },
      });
      // Switch to English BEFORE submit.
      fireEvent.click(screen.getByTestId('invite-locale-en'));
      expect(screen.getByTestId('invite-locale-en')).toBeChecked();
      fireEvent.click(screen.getByTestId('invite-submit'));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      // The POST body must carry locale: 'en' regardless of the
      // inviter's current i18n.language.
      const call = fetchSpy.mock.calls[0];
      const body = JSON.parse((call?.[1] as { body?: string })?.body ?? '{}');
      expect(body.locale).toBe('en');
    });

    test('locale resets to default when the modal is closed and re-opened', () => {
      const { rerender } = render(
        <InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />
      );
      // Override to English
      fireEvent.click(screen.getByTestId('invite-locale-en'));
      expect(screen.getByTestId('invite-locale-en')).toBeChecked();
      // Close
      rerender(
        <InviteMemberModal open={false} onClose={() => undefined} onSuccess={() => undefined} />
      );
      // Re-open
      rerender(
        <InviteMemberModal open={true} onClose={() => undefined} onSuccess={() => undefined} />
      );
      // Picker should be back to the i18n.language default (no).
      expect(screen.getByTestId('invite-locale-no')).toBeChecked();
      expect(screen.getByTestId('invite-locale-en')).not.toBeChecked();
    });
  });
});

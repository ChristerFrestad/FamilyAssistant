import { fireEvent, render, screen, act } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach } from 'vitest';
import { EmailVerificationBanner } from './EmailVerificationBanner';
import type { AuthUser } from '../../auth/authApi';

const startEmailVerification = vi.fn();
const refreshUser = vi.fn();

vi.mock('../../auth/AuthContext', () => ({
  useAuthContext: () => ({
    startEmailVerification,
    refreshUser,
  }),
}));

const baseUser: AuthUser = {
  id: 1,
  email: null,
  username: 'alice',
  name: 'Alice',
  role: 'adult',
  avatarUrl: null,
  familyId: 1,
  profileMemberId: null,
  onboardingCompleted: true,
  synthetic: false,
  emailVerified: false,
  withinGrace: true,
  verificationDueAt: '2026-10-01T00:00:00.000Z',
  passwordResetRequired: false,
};

beforeEach(() => {
  startEmailVerification.mockReset();
  refreshUser.mockReset();
  startEmailVerification.mockResolvedValue({ ok: true });
  refreshUser.mockResolvedValue(undefined);
});

describe('EmailVerificationBanner', () => {
  test('renders nothing when email is already verified', () => {
    const { container } = render(
      <EmailVerificationBanner user={{ ...baseUser, emailVerified: true }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('renders grace notice with due date', () => {
    render(<EmailVerificationBanner user={baseUser} />);
    expect(screen.getByTestId('email-verification-banner')).toBeInTheDocument();
    expect(screen.getAllByText(/Bekreft e-posten din/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1\. oktober 2026|1\. okt\.? 2026|oktober 2026/i)).toBeInTheDocument();
  });

  test('submits verification request', async () => {
    render(<EmailVerificationBanner user={baseUser} />);
    fireEvent.change(screen.getByRole('textbox', { name: /E-postadresse/i }), {
      target: { value: 'alice@example.com' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('textbox', { name: /E-postadresse/i }).closest('form')!);
    });
    expect(startEmailVerification).toHaveBeenCalledWith({ email: 'alice@example.com' });
    expect(refreshUser).toHaveBeenCalled();
    expect(screen.getByTestId('email-verification-sent')).toBeInTheDocument();
  });
});

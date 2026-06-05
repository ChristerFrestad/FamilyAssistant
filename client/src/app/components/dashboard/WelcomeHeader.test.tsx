// Tests for WelcomeHeader.
//
// Two contracts to lock down:
//   1. The pure helpers (pickGreetingKey, displayNameFromUser) cover
//      every interesting boundary so we can rely on them directly.
//   2. The component renders the greeting that matches the injected
//      `now` and pulls the name from useAuth().user.name.

import type { JSX } from 'react';
import { render, screen } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { WelcomeHeader, pickGreetingKey, displayNameFromUser } from './WelcomeHeader';
import { AuthProvider } from '../../auth/AuthContext';
import type { AuthUser } from '../../auth/authApi';

const TEST_USER: AuthUser = {
  id: 7,
  email: 'peder@example.com',
  name: 'Christer',
  role: 'owner',
  avatarUrl: null,
  familyId: 5,
  profileMemberId: 9,
  onboardingCompleted: true,
  synthetic: false,
};

function withAuth(ui: JSX.Element, user: AuthUser | null = TEST_USER): JSX.Element {
  return <AuthProvider initialState={{ user, isLoading: false }}>{ui}</AuthProvider>;
}

// Silence the i18n-language-detector storage write that AuthProvider
// triggers on mount in jsdom — we don't care about it here.
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(() => null),
  length: 0,
});

describe('pickGreetingKey', () => {
  test.each([
    [4, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
    [0, 'evening'],
    [3, 'evening'],
  ])('hour %i maps to %s', (hour, expected) => {
    expect(pickGreetingKey(hour)).toBe(expected);
  });
});

describe('displayNameFromUser', () => {
  test('returns the name unchanged when it is not an email', () => {
    expect(displayNameFromUser('Christer')).toBe('Christer');
  });
  test('extracts and capitalises the email local-part', () => {
    expect(displayNameFromUser('peder@example.com')).toBe('Peder');
  });
  test('returns "" for null', () => {
    expect(displayNameFromUser(null)).toBe('');
  });
  test('returns "" for empty / whitespace', () => {
    expect(displayNameFromUser('   ')).toBe('');
  });
});

describe('WelcomeHeader render', () => {
  test('renders morning greeting at 09:00', () => {
    render(withAuth(<WelcomeHeader now={new Date('2026-04-29T09:00:00')} />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/God morgen, Christer/);
  });

  test('renders afternoon greeting at 14:00', () => {
    render(withAuth(<WelcomeHeader now={new Date('2026-04-29T14:00:00')} />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /God ettermiddag, Christer/
    );
  });

  test('renders evening greeting at 21:00', () => {
    render(withAuth(<WelcomeHeader now={new Date('2026-04-29T21:00:00')} />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/God kveld, Christer/);
  });

  test('renders evening greeting at 02:00 (post-midnight)', () => {
    render(withAuth(<WelcomeHeader now={new Date('2026-04-29T02:00:00')} />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/God kveld, Christer/);
  });

  test('uses the email-local-part when name is an email', () => {
    const userWithEmailName: AuthUser = { ...TEST_USER, name: 'peder@example.com' };
    render(withAuth(<WelcomeHeader now={new Date('2026-04-29T09:00:00')} />, userWithEmailName));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/God morgen, Peder/);
  });

  test('renders an empty interpolation slot when user.name is null', () => {
    const userWithoutName: AuthUser = { ...TEST_USER, name: null };
    render(withAuth(<WelcomeHeader now={new Date('2026-04-29T09:00:00')} />, userWithoutName));
    // The label still renders, just without a name. We assert on the
    // morning prefix being present rather than on a brittle full
    // string match.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/God morgen/);
  });
});

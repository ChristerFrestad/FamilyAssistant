// Tests for OnboardingContext / OnboardingProvider.
//
// Three contracts to lock down:
//   1. setFamily / setUser are partial-merge — calling them with a
//      single field updates that field and leaves the others alone.
//   2. completeOnboarding refuses to fire when family.name is missing
//      (the screens enforce this via navigate-back-to-Step-1, but the
//      context guards the API call as a defensive last line).
//   3. completeOnboarding posts to /api/auth/onboarding/complete with
//      the trimmed family + user payload and returns the parsed body.
//   4. resetOnboarding clears both state slices back to empty.

import type { JSX } from 'react';
import { render, screen, act } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import {
  OnboardingProvider,
  useOnboardingContext,
  type OnboardingUserState,
} from './OnboardingContext';

const VALID_USER: OnboardingUserState = {
  name: 'Christer',
  category: 'adult',
  portionFactor: 1.0,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function Consumer(): JSX.Element {
  const ctx = useOnboardingContext();
  return (
    <div>
      <span data-testid="family-name">{ctx.family.name ?? '—'}</span>
      <span data-testid="user-name">{ctx.user.name ?? '—'}</span>
      <span data-testid="user-category">{ctx.user.category ?? '—'}</span>
      <span data-testid="user-portion">{ctx.user.portionFactor ?? '—'}</span>
      <button onClick={() => ctx.setFamily({ name: 'Frestad' })}>set-family</button>
      <button onClick={() => ctx.setUser({ name: 'Christer' })}>set-user-name</button>
      <button onClick={() => ctx.setUser({ category: 'adult', portionFactor: 1.0 })}>
        set-user-rest
      </button>
      <button
        onClick={() => {
          void ctx.completeOnboarding(VALID_USER);
        }}
      >
        submit
      </button>
      <button onClick={() => ctx.resetOnboarding()}>reset</button>
    </div>
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('OnboardingProvider state', () => {
  test('starts empty by default', () => {
    render(
      <OnboardingProvider>
        <Consumer />
      </OnboardingProvider>
    );
    expect(screen.getByTestId('family-name').textContent).toBe('—');
    expect(screen.getByTestId('user-name').textContent).toBe('—');
    expect(screen.getByTestId('user-category').textContent).toBe('—');
  });

  test('setFamily updates only family.name', () => {
    render(
      <OnboardingProvider>
        <Consumer />
      </OnboardingProvider>
    );
    act(() => {
      screen.getByText('set-family').click();
    });
    expect(screen.getByTestId('family-name').textContent).toBe('Frestad');
    expect(screen.getByTestId('user-name').textContent).toBe('—');
  });

  test('setUser merges patches without clobbering earlier fields', () => {
    render(
      <OnboardingProvider>
        <Consumer />
      </OnboardingProvider>
    );
    act(() => {
      screen.getByText('set-user-name').click();
    });
    expect(screen.getByTestId('user-name').textContent).toBe('Christer');
    expect(screen.getByTestId('user-category').textContent).toBe('—');
    act(() => {
      screen.getByText('set-user-rest').click();
    });
    // setUser is partial-merge: name from the first call survives,
    // category + portionFactor land from the second.
    expect(screen.getByTestId('user-name').textContent).toBe('Christer');
    expect(screen.getByTestId('user-category').textContent).toBe('adult');
    expect(screen.getByTestId('user-portion').textContent).toBe('1');
  });

  test('initialState seeds the provider for tests', () => {
    render(
      <OnboardingProvider initialState={{ family: { name: 'Seeded' }, user: {} }}>
        <Consumer />
      </OnboardingProvider>
    );
    expect(screen.getByTestId('family-name').textContent).toBe('Seeded');
  });

  test('resetOnboarding clears both slices', () => {
    render(
      <OnboardingProvider>
        <Consumer />
      </OnboardingProvider>
    );
    act(() => {
      screen.getByText('set-family').click();
      screen.getByText('set-user-name').click();
    });
    expect(screen.getByTestId('family-name').textContent).toBe('Frestad');

    act(() => {
      screen.getByText('reset').click();
    });
    expect(screen.getByTestId('family-name').textContent).toBe('—');
    expect(screen.getByTestId('user-name').textContent).toBe('—');
  });
});

describe('completeOnboarding', () => {
  test('throws when family.name is missing (no fetch fired)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { ok: true }));
    let caught: unknown = null;
    function Trigger(): JSX.Element {
      const ctx = useOnboardingContext();
      return (
        <button
          onClick={() => {
            ctx.completeOnboarding(VALID_USER).catch((err) => {
              caught = err;
            });
          }}
        >
          submit
        </button>
      );
    }
    render(
      <OnboardingProvider>
        <Trigger />
      </OnboardingProvider>
    );
    await act(async () => {
      screen.getByText('submit').click();
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Family name is required/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('POSTs the atomic payload when family.name + user are set', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        family: { id: 5, name: 'Frestad', ownerUserId: 1, createdAt: 'now' },
        user: {
          id: 1,
          email: 'x@example.com',
          name: 'Christer',
          role: 'owner',
          familyId: 5,
          profileMemberId: 9,
          onboardingCompleted: true,
        },
        member: { id: 9, name: 'Christer', category: 'adult', portionFactor: 1.0 },
      })
    );

    render(
      <OnboardingProvider initialState={{ family: { name: '  Frestad  ' }, user: {} }}>
        <Consumer />
      </OnboardingProvider>
    );

    await act(async () => {
      screen.getByText('submit').click();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/onboarding/complete',
      expect.objectContaining({ method: 'POST' })
    );
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const init = call?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      family: { name: 'Frestad' }, // trimmed
      user: { name: 'Christer', category: 'adult', portionFactor: 1.0 },
    });
  });
});

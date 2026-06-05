// Multi-step onboarding state container.
//
// PR #77 atomic-onboarding refactor: the wizard is two screens
// (FamilySetup → UserProfile) but writes to the database exactly
// once, on the final submit. This context holds the partial state
// between screens so a tab-close before the final submit leaves
// nothing on the server.
//
// Lifecycle:
//   * Mounted in App.tsx around the /onboarding/* route group, so
//     navigating between FamilySetup and UserProfile keeps the
//     provider — and therefore the partial state — alive.
//   * Unmounted when the user leaves the route group (login → app
//     shell, logout, or the route is replaced by a redirect). React
//     drops the local state automatically; on next mount the user
//     starts from a clean slate.
//   * `resetOnboarding()` is exposed for explicit clears (e.g. a
//     "start over" button or after completeOnboarding succeeds and
//     the wizard unmounts via navigation).
//
// Why separate from AuthContext:
//   AuthContext is mounted at the app root and lives for the
//   session. Onboarding state must NOT survive a page reload (the
//   user closing the tab is exactly the cancellation we want to
//   honour). Splitting into two providers keeps the lifecycles
//   correct: AuthContext = session-long, OnboardingContext = visit
//   to the onboarding screens only.

import type { JSX } from 'react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { completeOnboarding as apiCompleteOnboarding } from './authApi';
import type { OnboardingCompleteResponse } from './authApi';

export type OnboardingCategory = 'adult' | 'teen' | 'child';

export interface OnboardingFamilyState {
  name: string;
}

export interface OnboardingUserState {
  name: string;
  category: OnboardingCategory;
  portionFactor: number;
}

export interface OnboardingState {
  family: Partial<OnboardingFamilyState>;
  user: Partial<OnboardingUserState>;
}

export interface OnboardingActions {
  setFamily: (patch: Partial<OnboardingFamilyState>) => void;
  setUser: (patch: Partial<OnboardingUserState>) => void;
  /**
   * Submit the wizard. Caller passes the latest user values
   * directly (avoids the React closure-staleness footgun where the
   * context might still see the previous setUser state). family.name
   * is read from the context, since Step 1 commits it via setFamily
   * before navigating to Step 2.
   */
  completeOnboarding: (userPayload: OnboardingUserState) => Promise<OnboardingCompleteResponse>;
  resetOnboarding: () => void;
}

export type OnboardingContextValue = OnboardingState & OnboardingActions;

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const EMPTY_STATE: OnboardingState = {
  family: {},
  user: {},
};

export interface OnboardingProviderProps {
  children: ReactNode;
  /**
   * Optional override for tests so they can mount the provider at a
   * non-empty starting state without first driving setFamily/setUser
   * through user events. Production code never passes this.
   */
  initialState?: OnboardingState;
}

export function OnboardingProvider({
  children,
  initialState,
}: OnboardingProviderProps): JSX.Element {
  const [family, setFamilyState] = useState<Partial<OnboardingFamilyState>>(
    initialState?.family ?? EMPTY_STATE.family
  );
  const [user, setUserState] = useState<Partial<OnboardingUserState>>(
    initialState?.user ?? EMPTY_STATE.user
  );

  const setFamily = useCallback((patch: Partial<OnboardingFamilyState>): void => {
    setFamilyState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setUser = useCallback((patch: Partial<OnboardingUserState>): void => {
    setUserState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetOnboarding = useCallback((): void => {
    setFamilyState(EMPTY_STATE.family);
    setUserState(EMPTY_STATE.user);
  }, []);

  const completeOnboarding = useCallback(
    async (userPayload: OnboardingUserState): Promise<OnboardingCompleteResponse> => {
      // Defensive: the wizard's submit flow only fires this when
      // Step 1 has navigated forward (which commits family.name via
      // setFamily). A programmatic caller that skipped Step 1 would
      // hit this guard with a clear error instead of a backend 400.
      if (!family.name || !family.name.trim()) {
        throw new Error('Family name is required before completing onboarding.');
      }
      if (!userPayload.name || !userPayload.name.trim()) {
        throw new Error('User name is required before completing onboarding.');
      }
      return apiCompleteOnboarding({
        family: { name: family.name.trim() },
        user: {
          name: userPayload.name.trim(),
          category: userPayload.category,
          portionFactor: userPayload.portionFactor,
        },
      });
    },
    [family]
  );

  const value: OnboardingContextValue = {
    family,
    user,
    setFamily,
    setUser,
    completeOnboarding,
    resetOnboarding,
  };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboardingContext(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (ctx === null) {
    throw new Error('useOnboardingContext must be used inside <OnboardingProvider>');
  }
  return ctx;
}

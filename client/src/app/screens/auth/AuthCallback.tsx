// AuthCallback — the screen the user lands on after they click the
// magic link in their email.
//
// The backend's /api/auth/magic-link/verify endpoint is doing the
// real work: it receives the token, validates it, sets the session
// cookie, and 302-redirects the browser to either /v2/dashboard or
// /v2/onboarding/family. So technically this React screen is only
// reached when something has gone wrong (404 endpoint, network
// failure mid-redirect) or when a frontend-side route was hit
// directly with a token query-param (rare, mostly tests).
//
// We render a loading state on mount, then transition to either:
//   - success: refreshUser() succeeded -> AuthGuard will route us
//     onward on the next render. We just show "redirecting..." so
//     the user knows to wait.
//   - error: the token was missing/expired/used. We show the
//     translated error and a link back to /login. The user can
//     request a new link without losing context.
//
// Failure-mode taxonomy — kept here so the message-mapping is
// auditable in one place rather than spread across the UI:
//   query.error=expired   -> "link expired"
//   query.error=used      -> "already used"
//   query.error=invalid   -> "invalid"
//   any other / no token  -> "invalid"

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { useAuthContext } from '../../auth/AuthContext';

type CallbackState =
  | { status: 'loading' }
  | { status: 'success' }
  | { status: 'error'; reason: 'expired' | 'used' | 'invalid' };

function readReason(rawError: string | null): 'expired' | 'used' | 'invalid' {
  if (rawError === 'expired') return 'expired';
  if (rawError === 'used') return 'used';
  return 'invalid';
}

export function AuthCallback(): JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const { refreshUser } = useAuthContext();
  const [params] = useSearchParams();

  const [state, setState] = useState<CallbackState>({ status: 'loading' });

  // The backend handles the actual token exchange. If the user
  // arrived here because the backend redirected with an error
  // query-param (e.g. /v2/auth/callback?error=expired), we surface
  // it directly. Otherwise we treat the visit as a successful
  // post-redirect and refresh the session so the AuthGuard /
  // OnboardingGuard send the user onward.
  useEffect(() => {
    const errorParam = params.get('error');
    if (errorParam) {
      setState({ status: 'error', reason: readReason(errorParam) });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await refreshUser();
        if (!cancelled) setState({ status: 'success' });
      } catch {
        if (!cancelled) setState({ status: 'error', reason: 'invalid' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, refreshUser]);

  if (state.status === 'loading') {
    return (
      <PageShell maxWidth="sm" compact>
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-[40vh] items-center justify-center font-body text-text-2 text-center px-4"
        >
          {t('auth:callback.verifying')}
        </div>
      </PageShell>
    );
  }

  if (state.status === 'success') {
    return (
      <PageShell maxWidth="sm" compact>
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-[40vh] items-center justify-center font-body text-text-2 text-center px-4"
        >
          {t('auth:callback.success')}
        </div>
      </PageShell>
    );
  }

  // error
  const reasonKey =
    state.reason === 'expired'
      ? 'auth:callback.errorExpired'
      : state.reason === 'used'
        ? 'auth:callback.errorUsed'
        : 'auth:callback.errorInvalid';

  return (
    <PageShell maxWidth="sm" compact>
      <section
        aria-labelledby="callback-error-heading"
        className="flex flex-col gap-4 py-8 text-center"
      >
        <h1
          id="callback-error-heading"
          className="font-display text-display-md text-text-1 leading-tight"
        >
          {t('auth:callback.errorTitle')}
        </h1>
        <p className="font-body text-body text-text-2 max-w-md mx-auto">{t(reasonKey)}</p>
        <Link
          to="/login"
          className={[
            'self-center rounded-md px-4 py-2 font-body text-body',
            'bg-mint text-ink-contrast hover:bg-mint-deep',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
          ].join(' ')}
        >
          {t('auth:callback.backToLogin')}
        </Link>
      </section>
    </PageShell>
  );
}

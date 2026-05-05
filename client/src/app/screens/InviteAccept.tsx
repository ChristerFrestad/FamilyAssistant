// Sprint 9 / PR #119 — Invite-accept screen, route /v2/invite/:token.
//
// Public route (outside AuthGuard, inside PilotGuard). The component
// drives a 5-state machine fed by /api/invitations/:token (peek) and
// the AuthContext:
//
//   1. LOADING        — peek is in-flight (min 500 ms gate to avoid flash)
//   2. VALID_ANON     — peek OK, viewer not authenticated
//   3. VALID_MATCH    — peek OK, viewer authenticated, email matches
//   4. VALID_MISMATCH — peek OK, viewer authenticated, email differs
//   5. ERROR          — peek failed (404 / 410 / 409 / 5xx)
//
// On accept click in state 3 the component POSTs /accept and redirects
// to /v2/family on success. Wrong-email logout (state 4) calls
// authContext.logout() and routes back to /v2/login with a redirect
// param so the magic-link flow returns to /v2/invite/:token.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { useAuthContext } from '../auth/AuthContext';
import {
  acceptInvitation,
  FamilyInvitationsApiError,
  peekInvitation,
  type PeekInvitationResponse,
} from '../family/familyInvitationsApi';

const MIN_LOADING_MS = 500;

type State =
  | { kind: 'loading' }
  | { kind: 'valid'; peek: PeekInvitationResponse }
  | { kind: 'error'; code: ErrorCode };

type ErrorCode = 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'ALREADY_USED' | 'GENERIC';

export function InviteAccept(): JSX.Element {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('family');
  const auth = useAuthContext();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', code: 'NOT_FOUND' });
      return;
    }
    let cancelled = false;
    const startedAt = Date.now();
    (async () => {
      try {
        const peek = await peekInvitation(token);
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_LOADING_MS) {
          await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
        }
        if (!cancelled) {
          // Switch the i18n locale to whatever the email said this
          // invitation should render in — the recipient may be on a
          // different default than the inviter.
          if (peek.locale && peek.locale !== i18n.language) {
            void i18n.changeLanguage(peek.locale);
          }
          setState({ kind: 'valid', peek });
        }
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'error', code: classifyPeekError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, i18n]);

  if (state.kind === 'loading' || auth.isLoading) {
    return (
      <Layout>
        <div className="flex flex-col items-center gap-3" data-testid="invite-loading">
          <Spinner />
          <p className="font-body text-body text-text-2">
            {t('family:invitations.accept.loading')}
          </p>
        </div>
      </Layout>
    );
  }

  if (state.kind === 'error') {
    return <ErrorPanel code={state.code} onTryAgain={() => navigate('/')} />;
  }

  const peek = state.peek;
  const userEmail = auth.user?.email?.trim().toLowerCase() ?? null;
  const inviteEmail = peek.invitedEmail?.trim().toLowerCase() ?? null;
  const isAuthenticated = auth.isAuthenticated;
  const emailMatches = !inviteEmail || (userEmail && userEmail === inviteEmail);

  // STATE 4 — wrong email
  if (isAuthenticated && !emailMatches) {
    return (
      <Layout>
        <Card padding="md" shadow="low" data-testid="invite-state-mismatch">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-display-md text-text-1">
              {t('family:invitations.accept.wrongEmailHeading')}
            </h2>
            <p className="font-body text-body text-text-2">
              {t('family:invitations.accept.wrongEmailBody', {
                email: peek.invitedEmail,
                currentEmail: auth.user?.email ?? '',
              })}
            </p>
            <div className="flex flex-row gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  void auth
                    .logout()
                    .finally(() =>
                      navigate(`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`)
                    );
                }}
                data-testid="invite-logout-button"
              >
                {t('family:invitations.accept.logoutButton')}
              </Button>
            </div>
          </div>
        </Card>
      </Layout>
    );
  }

  async function handleAccept(): Promise<void> {
    setAccepting(true);
    setAcceptError(null);
    try {
      await acceptInvitation(token);
      await auth.refreshUser();
      navigate('/family');
    } catch (err) {
      setAcceptError(deriveAcceptError(err, t));
      setAccepting(false);
    }
  }

  // STATE 2 — valid + anonymous
  // STATE 3 — valid + matching email
  return (
    <Layout>
      <Card padding="md" shadow="low" data-testid="invite-state-valid">
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-display-md text-text-1">
            {t('family:invitations.accept.title', {
              inviter: peek.inviterName ?? peek.inviterEmail ?? '',
              family: peek.familyName,
            })}
          </h2>
          <p className="font-body text-body text-text-2">
            {t('family:invitations.accept.description')}
          </p>
          {peek.invitationMessage ? (
            <section
              aria-labelledby={`invite-${token}-message-heading`}
              data-testid="invite-personal-message"
              className="rounded-md border-l-4 border-mint bg-surface px-4 py-3"
            >
              <h3
                id={`invite-${token}-message-heading`}
                className="font-body text-meta font-medium text-text-2"
              >
                {t('family:invitations.accept.personalMessageHeading')}
              </h3>
              <p className="mt-1 whitespace-pre-line font-body text-body italic text-text-1">
                {peek.invitationMessage}
              </p>
            </section>
          ) : null}
          {acceptError ? (
            <p
              role="alert"
              className="font-body text-body text-danger"
              data-testid="invite-accept-error"
            >
              {acceptError}
            </p>
          ) : null}
          {isAuthenticated ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleAccept()}
                loading={accepting}
                data-testid="invite-accept-button"
              >
                {accepting
                  ? t('family:invitations.accept.accepting')
                  : t('family:invitations.accept.accept')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() =>
                  navigate(`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`)
                }
                data-testid="invite-login-button"
              >
                {t('family:invitations.accept.loginRequired')}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </Layout>
  );
}

function ErrorPanel({
  code,
  onTryAgain,
}: {
  code: ErrorCode;
  onTryAgain: () => void;
}): JSX.Element {
  const { t } = useTranslation('family');
  const titleKey = errorTitleKey(code);
  const bodyKey = errorBodyKey(code);
  return (
    <Layout>
      <Card padding="md" shadow="low" data-testid={`invite-state-error-${code.toLowerCase()}`}>
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-display-md text-text-1" role="alert">
            {t(titleKey)}
          </h2>
          <p className="font-body text-body text-text-2">{t(bodyKey)}</p>
          <div className="flex flex-row gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onTryAgain}
              data-testid="invite-back-home"
            >
              {t('family:invitations.accept.backHome')}
            </Button>
          </div>
        </div>
      </Card>
    </Layout>
  );
}

function Layout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-stretch justify-center gap-6 px-4 py-12">
      {children}
    </main>
  );
}

function Spinner(): JSX.Element {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block h-6 w-6 rounded-full border-2 border-current border-t-transparent animate-spin text-text-2"
    />
  );
}

function classifyPeekError(err: unknown): ErrorCode {
  if (err instanceof FamilyInvitationsApiError) {
    if (err.status === 404) return 'NOT_FOUND';
    if (err.status === 410) {
      if (err.code === 'INVITATION_REVOKED') return 'REVOKED';
      return 'EXPIRED';
    }
    if (err.status === 409) return 'ALREADY_USED';
  }
  return 'GENERIC';
}

function deriveAcceptError(err: unknown, t: (key: string) => string): string {
  if (err instanceof FamilyInvitationsApiError) {
    if (err.status === 410 && err.code === 'INVITATION_REVOKED') {
      return t('family:invitations.accept.errorRevokedBody');
    }
    if (err.status === 410) return t('family:invitations.accept.errorExpiredBody');
    if (err.status === 409) return t('family:invitations.accept.errorAlreadyUsedBody');
  }
  return t('family:invitations.accept.errorGenericBody');
}

function errorTitleKey(code: ErrorCode): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'family:invitations.accept.errorNotFoundTitle';
    case 'EXPIRED':
      return 'family:invitations.accept.errorExpiredTitle';
    case 'REVOKED':
      return 'family:invitations.accept.errorRevokedTitle';
    case 'ALREADY_USED':
      return 'family:invitations.accept.errorAlreadyUsedTitle';
    default:
      return 'family:invitations.accept.errorGenericTitle';
  }
}

function errorBodyKey(code: ErrorCode): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'family:invitations.accept.errorNotFoundBody';
    case 'EXPIRED':
      return 'family:invitations.accept.errorExpiredBody';
    case 'REVOKED':
      return 'family:invitations.accept.errorRevokedBody';
    case 'ALREADY_USED':
      return 'family:invitations.accept.errorAlreadyUsedBody';
    default:
      return 'family:invitations.accept.errorGenericBody';
  }
}

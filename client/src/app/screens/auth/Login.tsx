// Login — low-barrier username/password with magic-link as secondary.
//
// Primary flow: register or sign in with username + password. Full app
// access starts immediately (progressive email verification).
// After the grace period, password login returns 403
// email_verification_required and we switch to the verify+reset panel.
//
// Secondary: classic magic-link email form (unchanged API).

import type { JSX } from 'react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { Field } from '../../components/form/Field';
import { Input } from '../../components/form/Input';
import { Button } from '../../components/base/Button';
import { useAuthContext } from '../../auth/AuthContext';
import { AuthApiError, type PasswordLoginErrorBody } from '../../auth/authApi';

type Mode = 'login' | 'register' | 'magic' | 'verify';

function extrasFrom(err: unknown): PasswordLoginErrorBody | null {
  if (!(err instanceof AuthApiError)) return null;
  const e = err as AuthApiError & { extras?: PasswordLoginErrorBody };
  return e.extras ?? null;
}

export function Login(): JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const { requestMagicLink, loginWithPassword, registerWithPassword, startEmailVerification } =
    useAuthContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState<Mode>(
    searchParams.get('mode') === 'register' ? 'register' : 'login'
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verifyUsername, setVerifyUsername] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');

  function classifyPasswordError(err: unknown): string {
    if (err instanceof AuthApiError) {
      if (err.status === 409) return t('auth:password.errorUsernameTaken');
      if (err.status === 400) return err.detail || t('auth:password.errorInvalid');
      if (err.status === 401) return t('auth:password.errorInvalidCredentials');
      if (err.status === 429) return t('auth:password.errorRateLimit');
      if (err.status === 403) {
        const extras = extrasFrom(err);
        if (extras?.code === 'email_verification_required') {
          return t('auth:password.errorVerificationRequired');
        }
      }
    }
    return t('auth:password.errorGeneric');
  }

  function classifyMagicError(err: unknown): string {
    if (err instanceof AuthApiError) {
      if (err.status === 400) return t('auth:login.errorInvalidEmail');
      if (err.status === 429) return t('auth:login.errorRateLimit');
    }
    return t('auth:login.errorGeneric');
  }

  async function onPasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (mode === 'register') {
        const result = await registerWithPassword({
          username: username.trim(),
          password,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        });
        navigate(result.redirect.replace(/^\/v2/, '') || '/onboarding/family', { replace: true });
      } else {
        try {
          const result = await loginWithPassword(username.trim(), password);
          navigate(result.redirect.replace(/^\/v2/, '') || '/dashboard', { replace: true });
        } catch (err) {
          const extras = extrasFrom(err);
          if (extras?.code === 'email_verification_required') {
            setVerifyUsername(extras.username || username.trim());
            setVerifyPassword(password);
            setMode('verify');
            setError(t('auth:password.errorVerificationRequired'));
            return;
          }
          throw err;
        }
      }
    } catch (err) {
      setError(classifyPasswordError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onMagicSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await requestMagicLink(email.trim());
      navigate('/login/sent', { state: { email: email.trim() } });
    } catch (err) {
      setError(classifyMagicError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerifySubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await startEmailVerification({
        username: verifyUsername,
        password: verifyPassword,
        email: email.trim(),
      });
      setInfo(t('auth:password.verifySent'));
      navigate('/login/sent', {
        state: {
          email: email.trim(),
          purpose: 'verify',
        },
      });
    } catch (err) {
      setError(classifyPasswordError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const heading =
    mode === 'register'
      ? t('auth:password.registerTitle')
      : mode === 'verify'
        ? t('auth:password.verifyTitle')
        : mode === 'magic'
          ? t('auth:login.title')
          : t('auth:password.loginTitle');

  const intro =
    mode === 'register'
      ? t('auth:password.registerIntro')
      : mode === 'verify'
        ? t('auth:password.verifyIntro')
        : mode === 'magic'
          ? t('auth:login.intro')
          : t('auth:password.loginIntro');

  return (
    <PageShell maxWidth="sm" compact>
      <section aria-labelledby="login-heading" className="flex flex-col gap-6 py-8">
        <header className="text-center space-y-2">
          <h1 id="login-heading" className="font-display text-display-md text-text-1 leading-tight">
            {heading}
          </h1>
          <p className="font-body text-body text-text-2">{intro}</p>
        </header>

        {(mode === 'login' || mode === 'register') && (
          <form onSubmit={onPasswordSubmit} className="flex flex-col gap-4" noValidate>
            <Field label={t('auth:password.usernameLabel')} {...(error ? { error } : {})}>
              <Input
                type="text"
                autoComplete="username"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('auth:password.usernamePlaceholder')}
              />
            </Field>
            {mode === 'register' && (
              <Field label={t('auth:password.nameLabel')}>
                <Input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('auth:password.namePlaceholder')}
                />
              </Field>
            )}
            {mode === 'register' && (
              <Field label={t('auth:password.emailOptionalLabel')}>
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth:password.emailOptionalPlaceholder')}
                />
              </Field>
            )}
            <Field label={t('auth:password.passwordLabel')}>
              <Input
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth:password.passwordPlaceholder')}
              />
            </Field>
            <Button
              type="submit"
              loading={submitting}
              disabled={submitting || !username.trim() || password.length < 8}
            >
              {submitting
                ? t('auth:password.working')
                : mode === 'register'
                  ? t('auth:password.registerSubmit')
                  : t('auth:password.loginSubmit')}
            </Button>
          </form>
        )}

        {mode === 'magic' && (
          <form onSubmit={onMagicSubmit} className="flex flex-col gap-4" noValidate>
            <Field label={t('auth:login.emailLabel')} {...(error ? { error } : {})}>
              <Input
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth:login.emailPlaceholder')}
              />
            </Field>
            <Button type="submit" loading={submitting} disabled={submitting || !email.trim()}>
              {submitting ? t('auth:login.sending') : t('auth:login.submit')}
            </Button>
          </form>
        )}

        {mode === 'verify' && (
          <form onSubmit={onVerifySubmit} className="flex flex-col gap-4" noValidate>
            {error && (
              <p className="font-body text-meta text-danger" role="alert">
                {error}
              </p>
            )}
            {info && (
              <p className="font-body text-meta text-text-2" role="status">
                {info}
              </p>
            )}
            <Field label={t('auth:password.emailRequiredLabel')}>
              <Input
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth:login.emailPlaceholder')}
              />
            </Field>
            <Button type="submit" loading={submitting} disabled={submitting || !email.trim()}>
              {submitting ? t('auth:login.sending') : t('auth:password.verifySubmit')}
            </Button>
          </form>
        )}

        <div className="flex flex-col gap-2 text-center font-body text-meta text-text-3">
          {mode === 'login' && (
            <>
              <button
                type="button"
                className="hover:text-text-1 underline-offset-4 hover:underline"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
              >
                {t('auth:password.switchToRegister')}
              </button>
              <button
                type="button"
                className="hover:text-text-1 underline-offset-4 hover:underline"
                onClick={() => {
                  setMode('magic');
                  setError(null);
                }}
              >
                {t('auth:password.switchToMagic')}
              </button>
            </>
          )}
          {mode === 'register' && (
            <button
              type="button"
              className="hover:text-text-1 underline-offset-4 hover:underline"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
            >
              {t('auth:password.switchToLogin')}
            </button>
          )}
          {(mode === 'magic' || mode === 'verify') && (
            <button
              type="button"
              className="hover:text-text-1 underline-offset-4 hover:underline"
              onClick={() => {
                setMode('login');
                setError(null);
                setInfo(null);
              }}
            >
              {t('auth:password.switchToLogin')}
            </button>
          )}
          <Link to="/welcome" className="hover:text-text-1 underline-offset-4 hover:underline">
            {t('common:actions.back')}
          </Link>
        </div>
      </section>
    </PageShell>
  );
}

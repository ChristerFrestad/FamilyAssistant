// Set / reset password after post-grace email verification.
//
// Reached via magic-link purpose=email_verify_reset (session already set,
// passwordResetRequired=true). AuthGuard also redirects here if the
// flag is set on any protected route.

import type { JSX } from 'react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { Field } from '../../components/form/Field';
import { Input } from '../../components/form/Input';
import { Button } from '../../components/base/Button';
import { useAuthContext } from '../../auth/AuthContext';
import { AuthApiError } from '../../auth/authApi';

export function SetPassword(): JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const { user, isLoading, isAuthenticated, setPassword } = useAuthContext();
  const navigate = useNavigate();
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) {
    return (
      <PageShell maxWidth="sm" compact>
        <div role="status" className="py-16 text-center text-text-2">
          {t('common:status.loading')}
        </div>
      </PageShell>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // If reset is not required, send them into the normal app flow.
  if (!user?.passwordResetRequired) {
    const dest = user?.onboardingCompleted ? '/dashboard' : '/onboarding/family';
    return <Navigate to={dest} replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (password.length < 8) {
      setError(t('auth:password.errorTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth:password.errorMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await setPassword(password);
      navigate(result.redirect.replace(/^\/v2/, '') || '/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 400) {
        setError(err.detail || t('auth:password.errorInvalid'));
      } else {
        setError(t('auth:password.errorGeneric'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell maxWidth="sm" compact>
      <section aria-labelledby="set-password-heading" className="flex flex-col gap-6 py-8">
        <header className="text-center space-y-2">
          <h1
            id="set-password-heading"
            className="font-display text-display-md text-text-1 leading-tight"
          >
            {t('auth:password.setTitle')}
          </h1>
          <p className="font-body text-body text-text-2">{t('auth:password.setIntro')}</p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label={t('auth:password.passwordLabel')} {...(error ? { error } : {})}>
            <Input
              type="password"
              autoComplete="new-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              placeholder={t('auth:password.passwordPlaceholder')}
            />
          </Field>
          <Field label={t('auth:password.confirmLabel')}>
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t('auth:password.passwordPlaceholder')}
            />
          </Field>
          <Button type="submit" loading={submitting} disabled={submitting || password.length < 8}>
            {submitting ? t('auth:password.working') : t('auth:password.setSubmit')}
          </Button>
        </form>
      </section>
    </PageShell>
  );
}

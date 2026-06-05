// Login — magic-link entry point.
//
// User types email, hits Submit, and we POST /api/auth/magic-link/start.
// On success we navigate to /login/sent with the email passed via
// route state so the next screen can show "We sent the link to X".
//
// Error handling:
//   - 400 (invalid email format)        -> inline field error
//   - 429 (rate-limit on email)         -> hint-line under the form
//   - 503 (email service unavailable)   -> generic error message
//   - any other failure                 -> generic error message
//
// We deliberately do NOT distinguish "email belongs to existing
// account" from "email is unknown" in the response — the backend
// returns the same {ok:true} payload either way to prevent account
// enumeration. The success path is therefore the same regardless,
// and the next screen says "if the address is valid you'll get an
// email" rather than confirming a specific account.

import type { JSX } from 'react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { Field } from '../../components/form/Field';
import { Input } from '../../components/form/Input';
import { Button } from '../../components/base/Button';
import { useAuthContext } from '../../auth/AuthContext';
import { AuthApiError } from '../../auth/authApi';

export function Login(): JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const { requestMagicLink } = useAuthContext();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function classifyError(err: unknown): string {
    if (err instanceof AuthApiError) {
      if (err.status === 400) return t('auth:login.errorInvalidEmail');
      if (err.status === 429) return t('auth:login.errorRateLimit');
    }
    return t('auth:login.errorGeneric');
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await requestMagicLink(email.trim());
      navigate('/login/sent', { state: { email: email.trim() } });
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell maxWidth="sm" compact>
      <section aria-labelledby="login-heading" className="flex flex-col gap-6 py-8">
        <header className="text-center space-y-2">
          <h1 id="login-heading" className="font-display text-display-md text-text-1 leading-tight">
            {t('auth:login.title')}
          </h1>
          <p className="font-body text-body text-text-2">{t('auth:login.intro')}</p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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

        <p className="text-center font-body text-meta text-text-3">
          <Link to="/welcome" className="hover:text-text-1 underline-offset-4 hover:underline">
            {t('common:actions.back')}
          </Link>
        </p>
      </section>
    </PageShell>
  );
}

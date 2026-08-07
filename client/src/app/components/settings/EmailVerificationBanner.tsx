// Soft notice: password accounts get a grace period before email
// verification is mandatory. Shown on Settings while emailVerified
// is false. Lets the user add/confirm email and trigger a magic-link
// verification without leaving the app.

import type { JSX } from 'react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../base/Button';
import { Field } from '../form/Field';
import { Input } from '../form/Input';
import { AuthApiError, type AuthUser } from '../../auth/authApi';
import { useAuthContext } from '../../auth/AuthContext';

export interface EmailVerificationBannerProps {
  user: AuthUser;
}

function formatDueDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale === 'no' ? 'nb-NO' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function EmailVerificationBanner({
  user,
}: EmailVerificationBannerProps): JSX.Element | null {
  const { t, i18n } = useTranslation(['settings', 'auth', 'common']);
  const { startEmailVerification, refreshUser } = useAuthContext();

  // Only relevant for real password-era users who have not verified.
  if (user.synthetic || user.emailVerified === true) return null;
  // Magic-link-only users created before this feature may lack the field;
  // treat undefined as "no progressive-verification state" and hide.
  if (user.emailVerified === undefined && !user.username) return null;

  const [email, setEmail] = useState(user.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dueLabel = formatDueDate(user.verificationDueAt, i18n.language);
  const withinGrace = user.withinGrace !== false;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await startEmailVerification({ email: email.trim() });
      setInfo(t('settings:emailVerify.sent'));
      await refreshUser();
    } catch (err) {
      if (err instanceof AuthApiError) {
        if (err.status === 400) setError(err.detail || t('settings:emailVerify.errorInvalid'));
        else if (err.status === 429) setError(t('settings:emailVerify.errorRateLimit'));
        else if (err.status === 503) setError(t('settings:emailVerify.errorUnavailable'));
        else setError(t('settings:emailVerify.errorGeneric'));
      } else {
        setError(t('settings:emailVerify.errorGeneric'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="status"
      data-testid="email-verification-banner"
      className={[
        'rounded-md border px-4 py-3',
        withinGrace
          ? 'border-stroke bg-surface text-text-1'
          : 'border-danger/40 bg-danger/10 text-text-1',
      ].join(' ')}
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1">
          <p className="font-body text-body font-medium">
            {withinGrace
              ? t('settings:emailVerify.titleGrace')
              : t('settings:emailVerify.titleUrgent')}
          </p>
          <p className="font-body text-meta text-text-2">
            {withinGrace
              ? t('settings:emailVerify.bodyGrace', { date: dueLabel || '—' })
              : t('settings:emailVerify.bodyUrgent')}
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label={t('settings:emailVerify.emailLabel')} {...(error ? { error } : {})}>
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('settings:emailVerify.emailPlaceholder')}
              />
            </Field>
          </div>
          <Button
            type="submit"
            loading={submitting}
            disabled={submitting || !email.trim()}
            className="sm:mb-0.5"
          >
            {submitting ? t('settings:emailVerify.sending') : t('settings:emailVerify.submit')}
          </Button>
        </form>

        {info && (
          <p className="font-body text-meta text-text-2" data-testid="email-verification-sent">
            {info}
          </p>
        )}
      </div>
    </div>
  );
}

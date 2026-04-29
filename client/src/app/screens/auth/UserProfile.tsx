// UserProfile — final onboarding screen.
//
// User sets their personal display-name, role, and portion-factor.
// On submit we POST /api/auth/onboarding/complete which flips
// users.onboarding_completed to 1 server-side, then refresh the
// auth user so the AuthContext sees the flag flip too. The
// OnboardingGuard then lets the user through to /v2/dashboard.
//
// Pilot scope (per "kun voksne logger inn"-decision): every user
// who reaches this screen is an adult. We still surface the role
// selector with the three options (adult / teen / child) for two
// reasons:
//   1. The shared backend schema accepts all three; defaulting to
//      'adult' keeps that contract intact.
//   2. A future pilot iteration may let teens log in with their
//      own account; the field is then already wired up.
//
// Personal name + portion-factor are NOT yet sent to a dedicated
// "save profile" endpoint — that endpoint comes in Sprint 4 with
// the full Family screen. For Sprint 3 we accept the values, mark
// onboarding complete, and rely on Sprint 4 to surface the same
// fields again for the user to confirm/edit.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { Field } from '../../components/form/Field';
import { Input } from '../../components/form/Input';
import { Button } from '../../components/base/Button';
import { ProgressDots } from '../../components/display/ProgressDots';
import {
  PortionFactorSlider,
  getPortionFactorDefault,
  type PortionRole,
} from '../../components/form/PortionFactorSlider';
import { useAuthContext } from '../../auth/AuthContext';
import { completeOnboarding } from '../../auth/authApi';

const ROLES: PortionRole[] = ['adult', 'teen', 'child'];

export function UserProfile(): JSX.Element {
  const { t } = useTranslation(['auth', 'common', 'family']);
  const { user, refreshUser } = useAuthContext();
  const navigate = useNavigate();

  // Initial values: pre-fill the name from /api/auth/me when we
  // have one (the magic-link flow stores email-as-name on first
  // login; the user can replace that here with their real name).
  const [name, setName] = useState<string>(
    user?.name && !isLikelyEmail(user.name) ? user.name : ''
  );
  const [role, setRole] = useState<PortionRole>('adult');
  const [portion, setPortion] = useState<number>(() => getPortionFactorDefault('adult'));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function onRoleChange(next: PortionRole): void {
    setRole(next);
    // Reset portion-factor to the default for the selected role
    // unless the user has already moved the slider away from the
    // current role default.
    setPortion((prev) => {
      const wasDefault = prev === getPortionFactorDefault(role);
      return wasDefault ? getPortionFactorDefault(next) : prev;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('auth:onboarding.profile.errorRequired'));
      return;
    }

    setSubmitting(true);
    try {
      // Sprint 3 only flips the onboarding flag. Name/role/portion
      // are accepted UI-side and re-applied from the Family screen
      // in Sprint 4 (which adds the dedicated profile-save endpoint).
      await completeOnboarding();
      await refreshUser();
      navigate('/dashboard');
    } catch {
      setError(t('auth:onboarding.profile.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell maxWidth="sm" compact>
      <section aria-labelledby="profile-heading" className="flex flex-col gap-6 py-8">
        <header className="space-y-2">
          <ProgressDots current={2} total={2} />
          <p className="font-body text-meta text-text-3 sr-only">
            {t('auth:onboarding.progress.label', { current: 2, total: 2 })}
          </p>
          <h1
            id="profile-heading"
            className="font-display text-display-md text-text-1 leading-tight"
          >
            {t('auth:onboarding.profile.title')}
          </h1>
          <p className="font-body text-body text-text-2">{t('auth:onboarding.profile.intro')}</p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <Field label={t('auth:onboarding.profile.nameLabel')} {...(error ? { error } : {})}>
            <Input
              required
              autoFocus
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth:onboarding.profile.namePlaceholder')}
            />
          </Field>

          <Field label={t('auth:onboarding.profile.categoryLabel')}>
            <div role="radiogroup" aria-label={t('auth:onboarding.profile.categoryLabel')}>
              <div className="flex gap-2">
                {ROLES.map((r) => {
                  const active = r === role;
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onRoleChange(r)}
                      className={[
                        'flex-1 rounded-md px-3 py-2 font-body text-body',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
                        active
                          ? 'bg-ink text-ink-contrast'
                          : 'bg-surface text-text-1 hover:bg-surface-strong',
                      ].join(' ')}
                    >
                      {t(`family:category.${r}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </Field>

          <Field
            label={t('auth:onboarding.profile.portionLabel')}
            hint={t('auth:onboarding.profile.portionHelper')}
          >
            <PortionFactorSlider value={portion} onChange={setPortion} />
          </Field>

          <Button type="submit" loading={submitting} disabled={submitting || !name.trim()}>
            {submitting
              ? t('auth:onboarding.profile.submitting')
              : t('auth:onboarding.profile.submit')}
          </Button>
        </form>
      </section>
    </PageShell>
  );
}

// Crude heuristic — if the name is the email address (default
// when a magic-link user has just been created), we let the user
// type their real name into a blank field rather than asking them
// to delete the email first.
function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

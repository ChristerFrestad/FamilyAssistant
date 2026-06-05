// UserProfile — final onboarding screen.
//
// PR #77 atomic-onboarding refactor:
//   Reads the family name out of OnboardingContext (set by Step 1)
//   and the personal profile fields out of local state. On submit
//   the combined payload goes to POST /api/auth/onboarding/complete
//   exactly once. The backend creates the family, the first profile-
//   member row, sets users.role='owner' + portion_factor +
//   onboarding_completed=true, and writes an audit-log entry — all
//   in a single transaction. Closing the tab before this submit
//   leaves nothing on the server.
//
// Pilot scope (per "kun voksne logger inn"-decision): every user
// who reaches this screen logs in themselves. The category radio
// reflects the portion-scaling category (adult / teen / child) that
// the matching family_profile_members row stores. users.role is
// always set to 'owner' by the backend regardless of the category
// chosen here, because the user is creating the family.

import type { JSX } from 'react';
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
import { useOnboardingContext } from '../../auth/OnboardingContext';

const ROLES: PortionRole[] = ['adult', 'teen', 'child'];

export function UserProfile(): JSX.Element {
  const { t } = useTranslation(['auth', 'common', 'family']);
  const { user, refreshUser } = useAuthContext();
  const { family, completeOnboarding, resetOnboarding } = useOnboardingContext();
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
    // If the user landed here without a family name in context (e.g.
    // direct navigation to /onboarding/profile), bounce back to step 1
    // rather than firing a request the backend will reject.
    if (!family.name || !family.name.trim()) {
      navigate('/onboarding/family');
      return;
    }

    setSubmitting(true);
    try {
      await completeOnboarding({
        name: trimmed,
        category: role,
        portionFactor: portion,
      });
      resetOnboarding();
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

// FamilySetup — first onboarding screen.
//
// User picks a family name. Submitting POSTs /api/onboarding/create-family
// which creates the family row, attaches the caller as owner, and
// returns the new family id. We then refresh the auth user so
// /api/auth/me reflects the new family_id, and navigate forward to
// /onboarding/profile.
//
// Validation:
//   - empty name      -> client-side block before POST
//   - >100 chars      -> client-side block (matches backend cap)
//   - other failures  -> backend errorGeneric
//
// We use ProgressDots at the top so the user knows they are at
// step 1 of 2 (drop FamilyMembers from initial pilot per Sprint 3
// scope — the second/last step is UserProfile).

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { Field } from '../../components/form/Field';
import { Input } from '../../components/form/Input';
import { Button } from '../../components/base/Button';
import { ProgressDots } from '../../components/display/ProgressDots';
import { useAuthContext } from '../../auth/AuthContext';
import { createFamily } from '../../auth/authApi';

const MAX_NAME = 100;

export function FamilySetup(): JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const { refreshUser } = useAuthContext();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('auth:onboarding.family.errorRequired'));
      return;
    }
    if (trimmed.length > MAX_NAME) {
      setError(t('auth:onboarding.family.errorTooLong'));
      return;
    }

    setSubmitting(true);
    try {
      await createFamily(trimmed);
      // Re-pull /api/auth/me so the AuthContext picks up the new
      // family_id. Without this, downstream guards (which check
      // user.familyId) would still see null until the next page
      // load.
      await refreshUser();
      navigate('/onboarding/profile');
    } catch {
      setError(t('auth:onboarding.family.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell maxWidth="sm" compact>
      <section aria-labelledby="family-setup-heading" className="flex flex-col gap-6 py-8">
        <header className="space-y-2">
          {/* Step 1 of 2 in the slimmed pilot onboarding (Sprint 3
              dropped FamilyMembers; Sprint 4 ships member-management
              from the Family screen). */}
          <ProgressDots current={1} total={2} />
          <p className="font-body text-meta text-text-3 sr-only">
            {t('auth:onboarding.progress.label', { current: 1, total: 2 })}
          </p>
          <h1
            id="family-setup-heading"
            className="font-display text-display-md text-text-1 leading-tight"
          >
            {t('auth:onboarding.family.title')}
          </h1>
          <p className="font-body text-body text-text-2">{t('auth:onboarding.family.intro')}</p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            label={t('auth:onboarding.family.nameLabel')}
            hint={t('auth:onboarding.family.nameHelper')}
            {...(error ? { error } : {})}
          >
            <Input
              required
              autoFocus
              maxLength={MAX_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth:onboarding.family.namePlaceholder')}
            />
          </Field>
          <Button type="submit" loading={submitting} disabled={submitting || !name.trim()}>
            {submitting
              ? t('auth:onboarding.family.submitting')
              : t('auth:onboarding.family.submit')}
          </Button>
        </form>
      </section>
    </PageShell>
  );
}

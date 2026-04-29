// FamilySetup — first onboarding screen.
//
// PR #77 atomic-onboarding refactor:
//   The user picks a family name, but no API call happens here. The
//   value is stashed in OnboardingContext (lifecycle = the visit to
//   the /onboarding/* route group) and the user is sent on to the
//   profile screen. The actual database writes — family + profile-
//   member + user.onboarding_completed=1 — happen exactly once when
//   UserProfile submits, in a single backend transaction. Closing
//   the tab on this screen leaves nothing on the server.
//
// Validation:
//   - empty name      -> client-side block before navigate
//   - >100 chars      -> client-side block (matches backend Zod cap)
//
// We use ProgressDots at the top so the user knows they are at
// step 1 of 2 (FamilyMembers is dropped from the initial pilot per
// Sprint 3 scope — the second/last step is UserProfile).

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { Field } from '../../components/form/Field';
import { Input } from '../../components/form/Input';
import { Button } from '../../components/base/Button';
import { ProgressDots } from '../../components/display/ProgressDots';
import { useOnboardingContext } from '../../auth/OnboardingContext';

const MAX_NAME = 100;

export function FamilySetup(): JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const { family, setFamily } = useOnboardingContext();
  const navigate = useNavigate();

  // Pre-fill from context so navigating Step 2 -> Back -> Step 1 keeps
  // the typed name visible. The provider's lifecycle covers the whole
  // /onboarding/* route group.
  const [name, setName] = useState(family.name ?? '');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
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

    setFamily({ name: trimmed });
    navigate('/onboarding/profile');
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
          <Button type="submit" disabled={!name.trim()}>
            {t('auth:onboarding.family.submit')}
          </Button>
        </form>
      </section>
    </PageShell>
  );
}

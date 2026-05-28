// Welcome — the first screen unauthenticated visitors see when they
// land on `/v2/`. Two CTAs:
//   - primary "Get started" → /v2/login
//   - secondary "I already have an account" → /v2/login (same target;
//     the distinction is historical UX-language; both go to the magic-
//     link form)
//
// PageShell renders the screen at the auth-flow density (compact,
// max-w-sm). The component is fully translation-driven through the
// `auth:welcome.*` namespace; the {{appName}} interpolation flips
// from "FamilyAssistant" to "Husby" via the white-
// label override (see AGENTS.md DEL 7.12).

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';

export function Welcome(): JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <PageShell maxWidth="sm" compact>
      <section
        aria-labelledby="welcome-heading"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center"
      >
        <h1 id="welcome-heading" className="font-display text-display-md text-text-1 leading-tight">
          {t('auth:welcome.title')}
        </h1>
        <p className="font-body text-body text-text-2 max-w-md">{t('auth:welcome.subtitle')}</p>
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <Link
            to="/login"
            className={[
              'rounded-md px-4 py-3 text-center font-body text-body font-medium',
              'bg-mint text-ink-contrast hover:bg-mint-deep',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
            ].join(' ')}
          >
            {t('auth:welcome.primaryAction')}
          </Link>
          <Link
            to="/login"
            className={[
              'rounded-md px-4 py-3 text-center font-body text-body',
              'bg-surface text-text-1 hover:bg-surface-strong',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
            ].join(' ')}
          >
            {t('auth:welcome.secondaryAction')}
          </Link>
        </div>
      </section>
    </PageShell>
  );
}

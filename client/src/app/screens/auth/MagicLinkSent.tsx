// MagicLinkSent — "Check your email" confirmation screen.
//
// React-router passes the email through Location.state from the
// Login submit-handler. If a user hits this URL directly (no state)
// we fall back to a generic "we sent the link" message and offer
// a way back to the form. Either way the screen is the same shape
// and the user knows what to expect.
//
// "Try again" sends the user back to /login. The Login screen does
// NOT pre-fill the input on the second visit — the user is expected
// to retype, which doubles as a sanity-check that they had the
// right address.

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';

interface LocationState {
  email?: string;
}

export function MagicLinkSent(): JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;
  const email = state?.email;

  return (
    <PageShell maxWidth="sm" compact>
      <section aria-labelledby="sent-heading" className="flex flex-col gap-6 py-8 text-center">
        <header className="space-y-2">
          <h1 id="sent-heading" className="font-display text-display-md text-text-1 leading-tight">
            {t('auth:magicLinkSent.title')}
          </h1>
          {/* Use a translation that interpolates the email when we
              have one. When the user lands here without state (deep
              link, refresh) we still show the generic copy so the
              screen keeps reading correctly. */}
          <p className="font-body text-body text-text-2">
            {email ? t('auth:magicLinkSent.intro', { email }) : t('auth:login.intro')}
          </p>
          <p className="font-body text-meta text-text-3">{t('auth:magicLinkSent.validityNote')}</p>
        </header>

        <div className="flex flex-col items-center gap-3 pt-4 border-t border-stroke">
          <p className="font-body text-meta text-text-2">{t('auth:magicLinkSent.didntReceive')}</p>
          <p className="font-body text-meta text-text-3 max-w-xs">
            {t('auth:magicLinkSent.checkSpam')}
          </p>
          <Link
            to="/login"
            className={[
              'rounded-md px-4 py-2 font-body text-body',
              'bg-surface text-text-1 hover:bg-surface-strong',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
            ].join(' ')}
          >
            {t('auth:magicLinkSent.tryAgain')}
          </Link>
        </div>
      </section>
    </PageShell>
  );
}

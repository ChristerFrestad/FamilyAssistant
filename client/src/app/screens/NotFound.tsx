// 404 fallback screen. Catch-all <Route path="*"> renders this when
// nothing else in the route table matches. Real design (per the
// "Feilskjerm — generell tilstand" entry in design-gaps.md) will
// arrive with the broader error-screen work in Phase 2.
//
// The "404" heading is a numeric literal kept outside i18n — the
// number reads identically in every supported language and the
// universal HTTP-status convention is more recognizable than any
// translated word would be.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFound(): JSX.Element {
  const { t } = useTranslation('common');
  return (
    <section
      aria-labelledby="screen-heading"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center"
    >
      <h1 id="screen-heading" className="font-display text-display-md text-text-1">
        404
      </h1>
      <p className="font-body text-body text-text-2 max-w-md">{t('notFound.description')}</p>
      <Link
        to="/dashboard"
        className={[
          'rounded-md px-4 py-2 font-body text-body',
          'bg-mint text-ink-contrast hover:bg-mint-deep',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
        ].join(' ')}
      >
        {t('nav.dashboard')}
      </Link>
    </section>
  );
}

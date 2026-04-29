// LanguageSwitcher preview — interactive: click NO/EN and watch
// every translated component on the page flip language together.
// Useful for verifying that i18n keys resolve in both bundles
// without booting the full app.

import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../../../app/components/form/LanguageSwitcher';

export default function LanguageSwitcherPreview(): JSX.Element {
  const { t } = useTranslation('common');
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">LanguageSwitcher</h3>

      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">default (sm)</code>
        <LanguageSwitcher />
        <p className="font-body text-meta text-text-2">
          {/* Live demo: this string flips between Norwegian and English when
              you click the buttons above. */}
          {t('actions.save')} / {t('actions.cancel')} / {t('actions.delete')}
        </p>
      </div>

      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">size=md</code>
        <LanguageSwitcher size="md" />
      </div>

      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">size=lg</code>
        <LanguageSwitcher size="lg" />
      </div>
    </div>
  );
}

// Two-button language toggle: NO / EN. The active language is
// highlighted with the primary button variant; the inactive language
// is rendered as a secondary button. A click flips i18next's active
// language, which cascades through every useTranslation() consumer
// on the page.
//
// Why two buttons rather than a dropdown:
//   - We support exactly two languages — a dropdown is overkill
//   - The choices are equally weighted (no "select-this-then-confirm"
//     UX), and the active state is always visible at a glance
//   - It accommodates a tiny bottom-nav slot just as comfortably as
//     a header corner
//
// Persistence happens automatically via i18next's languagedetector
// caches:['localStorage'] config in app/i18n/config.ts. The user's
// choice is restored on next load before the first render.
//
// aria-pressed (rather than aria-current) describes the toggle
// semantics: each button is a "pressed" / "unpressed" toggle, not a
// nav link to a different document.

import { useTranslation } from 'react-i18next';
import { Button, type ButtonSize } from '../base/Button';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n/config';

export interface LanguageSwitcherProps {
  /** Padding/text-size scale matching Button. Defaults to 'sm'. */
  size?: ButtonSize;
  /** Caller-supplied additional classes on the wrapper. */
  className?: string;
}

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  no: 'NO',
  en: 'EN',
};

export function LanguageSwitcher({ size = 'sm', className }: LanguageSwitcherProps): JSX.Element {
  const { i18n, t } = useTranslation('common');
  // Resolve the active language to a SupportedLanguage even if
  // i18next currently holds a region-tagged variant like "no-NB" or
  // "en-US" (browser-detected). We compare prefix because
  // i18n.language can be "en-US" depending on detection order.
  const current: SupportedLanguage =
    SUPPORTED_LANGUAGES.find((lng) => i18n.language?.toLowerCase().startsWith(lng)) ?? 'no';

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className={['inline-flex gap-1', className].filter(Boolean).join(' ')}
    >
      {SUPPORTED_LANGUAGES.map((lng) => {
        const isActive = lng === current;
        return (
          <Button
            key={lng}
            type="button"
            size={size}
            variant={isActive ? 'primary' : 'secondary'}
            aria-pressed={isActive}
            onClick={() => {
              if (!isActive) i18n.changeLanguage(lng);
            }}
          >
            {LANGUAGE_LABELS[lng]}
          </Button>
        );
      })}
    </div>
  );
}

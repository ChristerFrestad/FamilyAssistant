import type { Config } from 'tailwindcss';

// Minimal Tailwind v3 config — Fase 1a.
// Design tokens (OKLCH-farger, Instrument Serif-typografi, aurora-
// gradienter, glass-morphism) legges til i Fase 1b ved å mappe CSS-
// custom-properties inn som Tailwind-farger.
//
// darkMode = selector-basert via data-theme — matcher vår tema-
// arkitektur (se design/2026-04-redesign/extracted/design-system.md §12).
// Tailwind `dark:`-utilities aktiveres når <html data-theme="dark">.

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Fylles ut i Fase 1b med OKLCH-tokens fra mockup.
    },
  },
  plugins: [],
};

export default config;

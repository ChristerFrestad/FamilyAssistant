import type { Config } from 'tailwindcss';

// Tailwind v3 config for the v2 frontend.
//
// Design system rule: Tailwind utilities resolve to CSS custom
// properties from client/src/app/styles/tokens.css. No hard-coded
// hex / rgb / oklch literals in this file. Theme switching at
// runtime works because every utility expands to var(--token-name),
// and the CSS file overrides those variables based on data-theme.
//
// darkMode = selector-based via data-theme — Tailwind's `dark:`
// utilities therefore activate when <html data-theme="dark">. The
// system-default (no attribute) and explicit data-theme="light"
// fall through to the light values written by tokens.css.

// Content patterns are resolved relative to process.cwd() — i.e. the
// repo root where `npm run build:client` is invoked, NOT relative to
// this config file. Hence the leading `client/` segment. Without it,
// Tailwind's purge silently sees zero source files and emits a CSS
// bundle with no utility classes at all.
//
// In dev mode we additionally scan client/dev.html and the dev/
// folder so the design-system preview page gets its utility classes
// generated. In prod mode the dev tree is excluded; otherwise
// Tailwind would emit the preview's utility classes into the bundle
// even though the JSX is correctly tree-shaken (they are static
// strings the scanner sees, regardless of which JS chunk they end up
// in). NODE_ENV is set to 'production' by `vite build` and
// 'development' by the dev server, so this branch fires reliably.
const isProdBuild = process.env.NODE_ENV === 'production';

const PROD_CONTENT = [
  './client/index.html',
  './client/src/main.tsx',
  './client/src/app/**/*.{ts,tsx}',
];

const DEV_CONTENT = [...PROD_CONTENT, './client/dev.html', './client/src/dev/**/*.{ts,tsx}'];

const config: Config = {
  content: isProdBuild ? PROD_CONTENT : DEV_CONTENT,
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // -------------------------------------------------------------
      // Colors — every entry is a var(--...) reference so theme swaps
      // propagate automatically. Names match the token names from
      // tokens.css for one-to-one mental mapping.
      // -------------------------------------------------------------
      colors: {
        // Canvas (page-background) scale. Named "canvas" rather than
        // "bg" so utility classes read as `bg-canvas-0` instead of the
        // stuttering `bg-bg-0`.
        'canvas-0': 'var(--canvas-0)',
        'canvas-1': 'var(--canvas-1)',
        'canvas-2': 'var(--canvas-2)',
        // Glass surface tokens
        surface: 'var(--surface)',
        'surface-strong': 'var(--surface-strong)',
        // Stroke / border tokens
        stroke: 'var(--stroke)',
        'stroke-strong': 'var(--stroke-strong)',
        // Text scale (use as text- and border- via Tailwind)
        'text-1': 'var(--text-1)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        // Brand accents — flat keys (bg-mint, text-mint, border-mint)
        // sit alongside Tailwind's default cyan-500 / amber-500 / rose-500
        // shade objects without conflict; Tailwind picks our flat key
        // when no shade is requested.
        mint: 'var(--mint)',
        'mint-deep': 'var(--mint-deep)',
        cyan: 'var(--cyan)',
        'cyan-deep': 'var(--cyan-deep)',
        amber: 'var(--amber)',
        coral: 'var(--coral)',
        rose: 'var(--rose)',
        // Ink + ink-contrast — primary-button-style invert
        ink: 'var(--ink)',
        'ink-contrast': 'var(--ink-contrast)',
      },

      // -------------------------------------------------------------
      // Typography
      // -------------------------------------------------------------
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        // Override Tailwind's default font-mono so `font-mono` resolves
        // to Geist Mono, matching the mockup's terminal blocks.
        mono: ['var(--font-mono)'],
      },

      fontSize: {
        // Type scale extracted from the mockup. text-* utility names
        // in Tailwind clash with the default scale (text-sm, text-base,
        // ...), so we use intent-based names — text-hero, text-screen,
        // etc. — that augment rather than override.
        hero: 'var(--text-hero)',
        screen: 'var(--text-screen)',
        'display-md': 'var(--text-display-md)',
        card: 'var(--text-card)',
        day: 'var(--text-day)',
        body: 'var(--text-body)',
        meta: 'var(--text-meta)',
        label: 'var(--text-label)',
      },

      letterSpacing: {
        tight: 'var(--tracking-tight)',
        wide: 'var(--tracking-wide)',
        wider: 'var(--tracking-wider)',
      },

      lineHeight: {
        tight: 'var(--leading-tight)',
        snug: 'var(--leading-snug)',
        normal: 'var(--leading-normal)',
        relaxed: 'var(--leading-relaxed)',
      },

      // -------------------------------------------------------------
      // Spacing — Tailwind's default 4 px base unit already matches
      // the --space-1..12 scale in tokens.css, so no remap is needed.
      // Tailwind's `p-1` is 0.25 rem; tokens.css --space-1 is 0.25 rem.
      // Both stay in lockstep. If a designer needs to reference the
      // token explicitly (e.g. arbitrary value), they can write
      // p-[var(--space-3)].
      // -------------------------------------------------------------

      // -------------------------------------------------------------
      // Border radius
      // -------------------------------------------------------------
      borderRadius: {
        sm: 'var(--radius-sm)', // 6 px — overrides Tailwind default 2 px
        md: 'var(--radius-md)', // 12 px
        lg: 'var(--radius-lg)', // 16 px
        xl: 'var(--radius-xl)', // 22 px
        '2xl': 'var(--radius-2xl)', // 28 px
        '3xl': 'var(--radius-3xl)', // 44 px
        pill: 'var(--radius-pill)', // 999 px
      },

      // -------------------------------------------------------------
      // Shadows / elevation
      // -------------------------------------------------------------
      boxShadow: {
        low: 'var(--shadow-low)',
        mid: 'var(--shadow-mid)',
        high: 'var(--shadow-high)',
        // Glow is theme-dependent: muted in light, neon in dark. The
        // value comes from tokens.css and switches via the data-theme
        // override blocks.
        glow: 'var(--shadow-glow)',
      },

      // -------------------------------------------------------------
      // Animations — keyframes mirror tokens.css. Tailwind's
      // animation utilities (animate-soft-pulse, animate-slide-up,
      // animate-shake, animate-wobble) reference these.
      // tokens.css already provides .soft-pulse / .slide-up / .shake /
      // .wobble plain CSS classes for non-Tailwind callsites; both
      // surfaces use the same @keyframes name so there is no
      // duplication in the emitted CSS.
      // -------------------------------------------------------------
      keyframes: {
        softPulse: {
          '0%, 100%': {
            transform: 'scale(1)',
            boxShadow: '0 0 0 0 oklch(0.82 0.15 155 / 0.4)',
          },
          '50%': {
            transform: 'scale(1.04)',
            boxShadow: '0 0 0 20px oklch(0.82 0.15 155 / 0)',
          },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-3px)' },
          '40%, 80%': { transform: 'translateX(3px)' },
        },
        wobble: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      animation: {
        'soft-pulse': 'softPulse 2.6s ease-out infinite',
        'slide-up': 'slideUp 0.35s ease-out both',
        shake: 'shake 0.35s ease-in-out',
        wobble: 'wobble 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;

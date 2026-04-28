# Self-hosted web fonts

This folder holds the v2 frontend's typography assets. All files
ship with the production bundle — no external font CDN, no
runtime calls to Google Fonts or Vercel's CDN. Choice rationale
(self-hosted, "Strategy A") is captured in the Phase 1b.2.1
prompt and supports the GDPR posture in
`docs/workflow/pending-decisions.md` ("Data-retensjon for
inaktive familier", privacy policy section).

## Files

| File | Source | Use |
|---|---|---|
| `InstrumentSerif-Regular.woff2` | github.com/Instrument/instrument-serif | Display headings, hero copy |
| `InstrumentSerif-Italic.woff2` | github.com/Instrument/instrument-serif | Display italic accents (e.g. the "harmoni" word in the welcome screen) |
| `Geist[wght].woff2` | github.com/vercel/geist-font | Variable-weight body and UI text, weights 100-900 |
| `Geist-Italic[wght].woff2` | github.com/vercel/geist-font | Variable-weight italic for body and UI |
| `GeistMono[wght].woff2` | github.com/vercel/geist-font | Variable-weight monospace for terminals, codes, secrets |

Total weight: ~270 KB on disk. The variable-weight `[wght]` files
cover the full 100-900 weight range with a single download per
family — significantly cheaper than shipping per-weight static
files.

## Subsetting

Not subset in this iteration. The full character sets cover Latin
(including æøå), Greek, and Cyrillic. Subsetting for Latin-only
would cut roughly 30-40 % off the variable-font sizes, but the
tooling (`pyftsubset` from fonttools) adds a build dependency we
chose not to introduce in 1b.2.1. If bundle weight becomes a
constraint we revisit this — see the cleanup-plan workflow.

## Licenses

Both font families are released under the SIL Open Font License,
Version 1.1. The license texts are committed alongside the fonts:

- `OFL-InstrumentSerif.txt` — Instrument Serif, copyright Instrument LLC
- `OFL-Geist.txt` — Geist + Geist Mono, copyright Vercel Inc.

Both licenses permit redistribution as part of an application as
long as the license text travels with the font files and the
font files themselves are not sold separately. We satisfy both
conditions.

## How they are loaded

`@font-face` declarations live in
`client/src/app/styles/tokens.css`. The CSS is imported by
`client/src/main.tsx` so Vite emits the fonts as build assets and
hashes the filenames. The bundle then references the hashed
filenames from `public/v2/assets/`.

`font-display: swap` is set on every face so the page renders
immediately with the system fallback while the woff2 streams in,
then swaps to the real face when ready.

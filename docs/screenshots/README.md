# Screenshots

Visual reference for the live pilot deploy. Linked from the top-level
`README.md` — once a PNG exists at the listed path, GitHub renders it
inline in the table on the front page.

## Naming convention

`NN-short-screen-name.png` where `NN` is a two-digit ordering prefix
that matches the table in `README.md`. New screens get the next free
number; existing screens keep their number when retaken so external
links and the README stay stable.

## Capture conventions

- **Source**: take from the live pilot deploy, not a local dev
  server. The brand-override env-vars and real seed data look more
  representative than `npm run dev:client` defaults.
- **Resolution**: 1440 × 900 (laptop) for desktop screens, 390 × 844
  (iPhone 14 viewport) for mobile screens. GitHub scales them
  proportionally.
- **Format**: PNG with the browser chrome cropped out. macOS:
  `Shift + Cmd + 4` then Space then click the window with the
  "Window shadow" toggle off (`Option`-hold while clicking) for
  clean edges.
- **PII**: every screenshot uses Peder Ås / Marte Kirkerud / Lars
  Holm / Kari Nordmann (the Norwegian generic test-fixture names —
  see CHRISTER.md) and seeded recipes. Never capture real family
  data.
- **Size budget**: keep individual PNGs under 200 KB after
  compression (`pngquant --quality 70-85` is a reasonable default).
  The README renders four screenshots; total budget is 800 KB so
  page load on slow connections stays usable.

## What is *not* a screenshot

- Marketing renders, logo concepts, and product mocks live in
  `design/2026-04-redesign/`, not here.
- Architecture diagrams are ASCII inside `docs/ARCHITECTURE.md`.
- Brand-system colour palettes are in `docs/BRAND_SYSTEM.md`.

## Last refreshed

2026-05-28 — initial set captured from the live pilot deploy
(`01-dashboard` mobile, `02-meals-weekplan` desktop with rich
ingredient breakdown, `03-shopping-list` desktop, `04-pantry`
desktop). The Meals screenshot has the white-label brand-string in
the top-left header blurred out with a Gaussian filter (radius 18)
because the pilot deploy runs with a private `APP_NAME` override
that should not appear in the public README. All other regions are
untouched.

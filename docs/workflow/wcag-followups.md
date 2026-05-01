# WCAG follow-ups — items deferred from Phase 3A

This file tracks WCAG 2.1 AA findings discovered during the Phase 3A
audit (2026-05-01) that were deliberately deferred from the audit PR.
Each item documents what, where, severity, and recommended fix.

Source of truth for current AA compliance status:
[`docs/runbooks/wcag-compliance.md`](../runbooks/wcag-compliance.md).

## How items get added

When the audit (or any later WCAG-aware review) finds an issue that
is real but does not block AA compliance for pilot, file an entry
here. CRITICAL/HIGH go in the open audit PR; MEDIUM/LOW go here.

## Open follow-ups

### MEDIUM-1 — Tinted-badge color-on-color contrast

**Where:** `client/src/app/components/pantry/ExpiryBadge.tsx`,
`client/src/app/components/pantry/PantryItem.tsx` (out-of-stock
badge).

**Issue:** Both render `bg-coral/15 text-coral border-coral/25`
(or `bg-amber/15 text-amber` for one variant). The text-coral on
the canvas-tinted-coral surface yields ~3-3.5:1 contrast — passes
WCAG 1.4.11 (Non-text Contrast, 3:1 floor for graphical objects)
but fails 1.4.3 (Contrast Minimum, 4.5:1 for body text).

**Why deferred:** The fix requires switching `text-coral` to
`text-coral-deep`, which visually shifts the badge from "muted
accent indicator" to "dark warning text". Needs design-runde
input on whether the visual shift is acceptable for the system
language (these badges are status hints, not errors).

**Recommended fix:** Either
1. Apply `text-coral-deep`/`text-amber-deep` (would need an
   `--amber-deep` token added) — visual shift, AA-safe.
2. Increase tint alpha from `/15` to `/20` or `/25`, deepening
   the bg slightly so the existing text-coral clears 4.5:1 —
   subtle visual shift, may bring the badge closer to "outlined
   surface" instead of "ghost tint".
3. Accept the borderline state per WCAG 1.4.11 (graphical-
   object reading) and document the decision in
   `wcag-compliance.md` — needs explicit accessibility-officer
   sign-off post-pilot.

**Owner:** Christer + design-runde.
**Recommended timing:** Sprint 7 polish or after pilot feedback.

### MEDIUM-2 — Touch target size for `Button size="sm"`

**Where:** `client/src/app/components/base/Button.tsx`. The `sm`
variant produces a 28px-tall control (`px-3 py-1.5`).

**Issue:** WCAG 2.5.5 AAA recommends 44x44 CSS-px minimum for
touch targets. Our `sm` button is below that on mobile. We are
AA-compliant — AA only requires 24x24 — but a future polish pass
should bump mobile sm-buttons.

**Why deferred:** Bumping `sm` globally to 44px breaks desktop
tetthet in WeekList day-pills, settings rows, and inline-editable
text controls. Per-screen audit needs to identify which `sm`
buttons are mobile-touch-flow vs. desktop-tett-flow.

**Recommended fix:** Add a `touch-target` Tailwind utility class
that callers opt into (`min-h-[44px] min-w-[44px]`). Audit each
mobile flow and apply where the touch lands on a primary action.

**Owner:** Christer (design-runde for which flows qualify).
**Recommended timing:** Sprint 7 polish.

### LOW-1 — PortionFactorSlider standalone-label safety

**Where:** `client/src/app/components/form/PortionFactorSlider.tsx`.

**Issue:** Slider renders `<input type="range">` with no built-in
label. Today MemberCard always wraps with `<label htmlFor>` so the
gap does not surface in product code. axe correctly fails for an
unlabeled standalone slider — confirmed during audit.

**Why deferred:** Real risk is low (one consumer, careful pattern).
Adding a required `label` or `ariaLabel` prop is a breaking change
for the existing call site.

**Recommended fix:** Add a required `label?: string | { ariaLabel:
string }` prop in a follow-up refactor. Update MemberCard caller to
pass it. Remove the responsibility from the consumer.

**Owner:** Claude (engineering).
**Recommended timing:** When PortionFactorSlider gets its second
consumer.

### LOW-2 — Lighthouse Accessibility CI scoring

**Where:** Project-level CI configuration.

**Issue:** Phase 3A mathematical contrast + axe-core unit tests
catch most violations. They do NOT catch:
- Real-browser-only issues (CSS layout interactions,
  computed-style edge cases)
- Color-contrast violations (axe-core in jsdom cannot paint)
- Performance issues that affect a11y (motion, focus order
  during dynamic content)

A nightly Lighthouse CI run against a deployed preview would
close the gap.

**Why deferred:** Requires headless-browser harness, deployed
preview URL, and a baseline-comparison policy. Not blocking for
pilot.

**Recommended fix:** Add Playwright + Lighthouse-CLI to
`.github/workflows/`, run weekly against `main`, post results to
`docs/monitoring/`. Estimate 1 day of work.

**Owner:** Claude (engineering).
**Recommended timing:** Sprint 6 cleanup or post-pilot.

## Closed follow-ups

(None yet — file is new.)

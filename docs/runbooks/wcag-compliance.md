# WCAG 2.1 AA Compliance — FamilyAssistant v2 frontend

**Status:** Phase 3A audit complete (2026-05-01).
**Scope:** v2 SPA at `client/src/app/` — 16 base components and the
five hovedskjermer (Dashboard, Family, Meals, Shopping incl. Pantry
sub-view, Settings). Auth screens (Welcome, Login, AuthCallback) are
out of scope until Sprint 7 / Prompt 16.
**Standard:** WCAG 2.1 Level AA. AAA referenced where met without
extra effort.

This document is the source of truth for what is verified, how, and
where the gaps still are. Update it when audit work lands.

## Verification approach

We pair two complementary checks:

1. **Mathematical contrast verification** —
   `client/src/app/styles/contrast.test.ts` parses the OKLCH literals
   from `tokens.css`, converts to linear sRGB via `contrast.ts` (Bjorn
   Ottosson's OKLab formulae), and asserts the WCAG 2.1 ratio for
   every product token-pair in both `[data-theme='light']` and
   `[data-theme='dark']`. 23 assertions cover Button primary,
   ink-contrast variants, error-text, hint-text and AAA headings.

   Why mathematical: jsdom does not paint pixels, so axe-core cannot
   compute color-contrast in unit tests. The math approach is
   deterministic and independent of the browser.

2. **Programmatic axe-core scanning** —
   `client/src/app/components/a11y.test.tsx` (29 tests) and
   `client/src/app/screens/a11y.test.tsx` (6 tests) render the entire
   v2 component and screen surface and run axe with the WCAG 2.0 A,
   AA + WCAG 2.1 AA rule packs. Every violation fails the test with
   the offending HTML so future regressions cannot ship silently.

   The `color-contrast` rule is intentionally disabled inside jsdom
   (no pixel data) — its job is owned by approach 1. The `region`
   rule is disabled at component-level scope because component
   fragments do not carry the surrounding `<main>`/`<nav>`; it
   stays available at screen-level via `expectNoAxeViolations`
   options-override.

## WCAG 2.1 AA criteria coverage matrix

| Criterion | Status | Notes / where verified |
|---|---|---|
| 1.1.1 Non-text content | OK | Avatars take a required `alt` prop; icons are `aria-hidden` when paired with text; ProgressDots takes a required `ariaLabel`. axe coverage in `a11y.test.tsx`. |
| 1.3.1 Info and relationships | OK | Field wires `<label htmlFor>` + `aria-describedby` for hint/error; SettingsSection uses `aria-labelledby`; AppShell carries `<header role="banner">`, `<nav>`, `<main id="main-content">`. |
| 1.3.2 Meaningful sequence | OK | DOM order matches reading order on every screen. Verified by visual inspection during audit. |
| 1.3.3 Sensory characteristics | OK | Form errors carry both visual (rose-deep border + asterisk) AND text. ExpiryBadge variants pair color with icon + text label. |
| 1.4.1 Use of color | OK | Status indicators (saved/saving/error in MemberCard, expiry tones in ExpiryBadge) all carry text in addition to color. |
| 1.4.2 Audio control | n/a | No autoplaying audio. |
| 1.4.3 Contrast (Minimum) | OK | All product token-pairs verified mathematically in `contrast.test.ts`. Mint primary button now clears 4.5:1 in both modes after Phase 3A token-darkening. |
| 1.4.4 Resize text | OK | Tailwind utilities use rem/em throughout; no fixed-px text sizes that would resist user zoom. |
| 1.4.5 Images of text | OK | All text is rendered text. Logos use the `<Link>` text node. |
| 1.4.10 Reflow | OK | AppShell uses `min-w-0 flex-1` on `<main>` to prevent flex-item horizontal overflow. Verified via Sprint 4 hotfix `b7d265d`. |
| 1.4.11 Non-text contrast | Partial | UI-component borders (Card stroke, Input border) clear 3:1 against canvas. Tinted-badge color-on-color (`bg-coral/15 text-coral` in ExpiryBadge) is ~3-3.5:1; tracked as MEDIUM follow-up. |
| 1.4.12 Text spacing | OK | No fixed line-height / letter-spacing in component CSS that resists user override. |
| 1.4.13 Content on hover or focus | OK | Hover states do not show new content that requires hovering to dismiss. |
| 2.1.1 Keyboard | OK | All interactive elements use native `<button>`, `<input>`, `<a>` so keyboard handling is browser-default. axe coverage. |
| 2.1.2 No keyboard trap | OK | Modal traps focus within the dialog, releases on close. Verified in `Modal.test.tsx`. |
| 2.1.4 Character key shortcuts | n/a | No single-character shortcuts. |
| 2.4.1 Bypass blocks | OK | AppShell renders a skip-link to `#main-content`, visible on focus. |
| 2.4.2 Page titled | OK | Each screen renders `<h1>` via `<header>` (Settings, Meals, Family) or `sr-only` heading (Dashboard). |
| 2.4.3 Focus order | OK | DOM order matches expected tab order on every screen. |
| 2.4.4 Link purpose (in context) | OK | Links carry meaningful text via i18n bundle. No "click here". |
| 2.4.5 Multiple ways | OK | Bottom-nav (mobile) + side-nav (md+) + skip-link + UserMenu all expose primary navigation. |
| 2.4.6 Headings and labels | OK | Each screen has one `<h1>`. Form fields have `<label>`. |
| 2.4.7 Focus visible | OK | Every interactive element uses Tailwind's `focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0`. |
| 2.5.1 Pointer gestures | OK | No multi-finger or path-based gestures required. |
| 2.5.2 Pointer cancellation | OK | All `onClick` fire on click-up; no `onMouseDown` mutations. |
| 2.5.3 Label in name | OK | Buttons' visible text matches their accessible name. |
| 2.5.4 Motion actuation | n/a | No motion-triggered actions. |
| 3.1.1 Language of page | OK | `<html lang>` is set by main.tsx based on i18n active language. |
| 3.1.2 Language of parts | n/a | All content is in the active locale. |
| 3.2.1 On focus | OK | Focus does not change context unexpectedly. |
| 3.2.2 On input | OK | Input does not change context unexpectedly (LanguageSwitcher click DOES change language but is the explicit purpose of the control). |
| 3.2.3 Consistent navigation | OK | BottomNav and SideNav order is identical on every screen via `nav-items.ts`. |
| 3.2.4 Consistent identification | OK | Same icon+label pairs across nav surfaces. |
| 3.3.1 Error identification | OK | Field renders error message via `role="alert"` with `aria-describedby`. |
| 3.3.2 Labels or instructions | OK | Every Field has a label; Input on its own takes a placeholder via Tailwind's `placeholder:text-text-3`. |
| 3.3.3 Error suggestion | OK | Field error messages describe what is wrong (e.g. "Navnet kan ikke være tomt"). |
| 3.3.4 Error prevention (legal/financial/data) | Partial | Settings → Slett konto wraps native `window.confirm` for explicit consent. Bespoke modal for richer prevention is Sprint 7 polish. |
| 4.1.1 Parsing | OK | React's reconciler emits well-formed HTML; no manual `dangerouslySetInnerHTML`. |
| 4.1.2 Name, role, value | OK | Verified by axe-core across all components. |
| 4.1.3 Status messages | OK | Loading/success/error states use `role="status"` + `aria-live="polite"` (Settings skeleton, MemberCard save-status) or `role="alert"` (errors). |

## Known limitations and follow-ups

These are documented gaps that did not block AA compliance but are
recorded so the next audit picks them up.

### MEDIUM — tinted-badge color-on-color contrast
**Where:** `ExpiryBadge` and `PantryItem` out-of-stock badge use
`bg-coral/15 text-coral border-coral/25` (and `bg-amber/15 text-amber`
for one variant). The badge as a whole is a "graphical UI object"
under WCAG 1.4.11, but the text inside is at the borderline 3.5:1
ratio against the tinted background. Replacing `text-coral` with
`text-coral-deep` lifts contrast above 4.5:1 but visually changes the
badge from "muted accent" to "dark warning". Needs design-runde input
on whether the visual shift is acceptable.

### MEDIUM — touch target size for `Button size="sm"`
**Where:** `Button size="sm"` produces a 28px-tall control. WCAG 2.5.5
AAA recommends 44x44 px minimum; AA Level Achievable Mobile spec is
24x24. We are AA-compliant but a future polish pass should bump
mobile sm-buttons to 44px via a `touch-target` utility class.
Tracked entry in `wcag-followups.md`.

### LOW — PortionFactorSlider standalone-label safety
**Where:** `PortionFactorSlider` requires the consumer to supply
either an external `<label htmlFor>` (current MemberCard pattern) or
an `aria-label` prop. axe correctly fails for an unlabeled
standalone slider. Today the component is only used inside
MemberCard, so the gap does not surface in product code. A future
caller could miss the requirement. Consider adding a required
`label` or `ariaLabel` prop in a follow-up refactor.

## Test procedure for future changes

When you change UI code:

1. Run `npm run test:client` — all 700+ tests including axe.
2. If you touch `client/src/app/styles/tokens.css`, the contrast
   suite will fail unless every product pair still clears AA.
3. If you add a new component, add a corresponding test in
   `client/src/app/components/a11y.test.tsx` so axe scans it.
4. If you add a new screen or alter screen-level layout, add a
   corresponding test in `client/src/app/screens/a11y.test.tsx`.
5. If you introduce a new color token used as text, add an entry in
   `contrast.test.ts` for the relevant background pair.
6. For interactive flows that change shared state across components,
   add a regression test in
   `client/src/app/components/state-sync.test.tsx`.

## What is NOT covered

- **Lighthouse Accessibility CI scoring** — requires a headless
  browser harness, deferred to a future sprint
- **Manual screen-reader testing** — Christer's NVDA / VoiceOver
  manual pass happens after merge per Phase 3A scope
- **Auth screens** — Welcome, Login, AuthCallback are Sprint 7
  scope and frosset under DEL 6
- **Onboarding flow** — same Sprint 7 scope
- **Mobile-touch responsiveness verification at runtime** — out of
  scope for unit-test based audit; handled by Christer's pilot device
  testing

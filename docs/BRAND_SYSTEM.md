# Hverdagsplanleggeren / FamilyAssistant — Brand System

White-label brand system for the FamilyAssistant platform. Each instance (Hverdagsplanleggeren, FamilyAssistant, and future ones) shares the same structural DNA, but has its own words, letters, and tagline controlled by env.

## Design principles

1. **The wordmark is the logo.** Not a symbol plus text — just a word, set in a specific style. The color split in the word marks a conceptual two-part structure (compound word in Norwegian, two-word name in English).
2. **The favicon is a single letter.** The first letter of `APP_NAME_PRIMARY`, set in the same typography as the wordmark, on a dark-green container with a small sage-green dot in the upper right.
3. **System fonts on principle.** No webfont loading. No FOIT/FOUT. Native feel on every OS.
4. **No icon illustration.** No calendar, no checkmark, no food symbols. The logo doesn't say what the app does — it says what the app is called.
5. **Dark and light modes designed in parallel.** Not adaptation — parallel design.

## Token table

| Token | Hex | Use |
|---|---|---|
| `--brand-primary` | `#1F3F26` | Wordmark first part, favicon background, buttons, header text |
| `--brand-accent` | `#5F8B5C` | Wordmark second part, hover states, secondary links |
| `--brand-dot` | `#7BA05B` | Favicon dot, success states |
| `--brand-cream` | `#F7F3E8` | Cream background, favicon text |
| `--brand-muted` | `#5F7A66` | Tagline, secondary body text |
| `--brand-dark-bg` | `#1A2620` | Dark mode container |
| `--brand-dark-accent` | `#9BC59A` | Dark mode accent green |

## Env variables

| Variable | Default | Example (Hverdagsplanleggeren) |
|---|---|---|
| `APP_NAME` | `FamilyAssistant` | `Hverdagsplanleggeren` |
| `APP_NAME_PRIMARY` | `Family` | `Hverdags` |
| `APP_NAME_ACCENT` | `Assistant` | `planleggeren` |
| `APP_FAVICON_LETTER` | `F` | `h` |
| `APP_TAGLINE` | `Plan meals, chores and family` | `Planlegg middag, gjøremål og familie` |
| `APP_PRIMARY_COLOR` | `#1F3F26` | (same) |
| `APP_ACCENT_COLOR` | `#5F8B5C` | (same) |
| `APP_DOT_COLOR` | `#7BA05B` | (same) |

Cross-validation at startup:
- `APP_NAME_PRIMARY + APP_NAME_ACCENT` must concatenate to `APP_NAME` (case-insensitive, whitespace-tolerant). Mismatch = warning at boot.
- `APP_FAVICON_LETTER` must match the first letter of `APP_NAME_PRIMARY`. Mismatch = warning at boot.

Both are warnings, not crashes — the operator may have deliberate deviations.

## Files in client/public/branding/

| File | Type | Description |
|---|---|---|
| `favicon.template.svg` | Template | Contains `{{LETTER}}` and `{{APP_NAME}}`. Rendered by the backend on request to `/favicon.svg`. |
| `logo-mark.template.svg` | Template | Same principle, full-size mark for app icon, OG image. |

No static `.svg` files per instance. Everything is generated on request.

## Frontend rendering

### Wordmark component

Use `<Wordmark size="md" variant="light" />`. Automatically pulls from `useBrandConfig()`. Never hardcode the app name in React components.

```tsx
// Correct
<Wordmark size="lg" />

// Wrong — hardcoded, does not go through config
<h1>Hverdagsplanleggeren</h1>
```

### Tagline

`useBrandConfig().tagline` is used in the footer, splash screen, and OG meta. Never hardcoded.

### Favicon in index.html

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

These routes are all served by `branding.routes.ts` — SVGs are generated dynamically, PNG derivatives are generated on first request and cached.

### document.title

Set at app mount from `config.appName`. Never hardcoded in HTML.

```tsx
useEffect(() => {
  document.title = config.appName;
}, [config.appName]);
```

## Backend rendering

### /api/config endpoint

```json
{
  "appName": "Hverdagsplanleggeren",
  "namePrimary": "Hverdags",
  "nameAccent": "planleggeren",
  "faviconLetter": "h",
  "tagline": "Planlegg middag, gjøremål og familie",
  "primaryColor": "#1F3F26",
  "accentColor": "#5F8B5C",
  "dotColor": "#7BA05B"
}
```

Public endpoint (no auth). Cached at the CDN for 1 hour.

### Email templates

Templates use Handlebars-style placeholders that are interpolated from config:

```html
<h1 style="font-family: -apple-system, sans-serif; font-size: 28px; font-weight: 500; letter-spacing: -0.5px;">
  <span style="color: {{primaryColor}};">{{namePrimary}}</span><span style="color: {{accentColor}};">{{nameAccent}}</span>
</h1>
<p style="color: {{mutedColor}}; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;">
  {{tagline}}
</p>
```

The four templates from Sprint 9 are updated accordingly:
- `invitation-no.html` / `invitation-no.txt`
- `invitation-en.html` / `invitation-en.txt`
- Magic-link templates (NO/EN)

CTA button: `background: {{primaryColor}};` — not hardcoded blue.

### RESEND_FROM

Set in Portainer per instance:
- Hverdagsplanleggeren: `RESEND_FROM=Hverdagsplanleggeren <noreply@hverdagsplanleggeren.com>`
- FamilyAssistant (if deployed): `RESEND_FROM=FamilyAssistant <noreply@familyassistant.com>`

Boot warning if `RESEND_FROM` does not match `APP_NAME` in the from-name field.

## Prohibited use

- Hardcoding the app name in React components, HTML, or email templates
- Static SVG files per instance (must be templates with placeholders)
- Changing brand tokens without PR review
- Stretching/squeezing the wordmark or favicon
- Effects (shadow, gradient, glow) on the logo
- Webfonts — system fonts on principle

## New-instance checklist

To launch a third white-label instance (e.g. "Husby"):

1. Set env vars in Portainer:
   ```
   APP_NAME=Husby
   APP_NAME_PRIMARY=Hus
   APP_NAME_ACCENT=by
   APP_FAVICON_LETTER=h
   APP_TAGLINE=Hjem og hverdag
   ```
2. Set `RESEND_FROM` with the correct sender domain
3. Configure DNS for the new domain → Cloudflare Tunnel
4. Deploy. No code changes.

If the new instance requires different colors: upgrade to "level 3" white-label (palette overrides via env). Log as tech debt until there is a real need.

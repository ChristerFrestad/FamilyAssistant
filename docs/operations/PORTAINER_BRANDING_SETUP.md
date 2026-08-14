# Portainer branding setup

How to configure brand-specific env-vars in a Portainer stack so the
same `ghcr.io/christerfrestad/familyassistant:main` image renders any
white-label brand without rebuilding.

For the design rationale and rules, see
[BRAND_SYSTEM.md](../BRAND_SYSTEM.md). For the runtime endpoints the
frontend pulls from, see [`server/http/branding.js`](../../server/http/branding.js).

---

## Environment variables

| Variable | Required? | Default | Example (Husby) |
|---|---|---|---|
| `APP_NAME` | recommended | `FamilyAssistant` | `Husby` |
| `APP_NAME_PRIMARY` | recommended | `Family` | `Hus` |
| `APP_NAME_ACCENT` | recommended | `Assistant` | `by` |
| `APP_FAVICON_LETTER` | recommended | `F` | `h` |
| `APP_TAGLINE` | recommended | `Plan meals, chores and family` | `Planlegg middag, gjøremål og familie` |
| `APP_PRIMARY_COLOR` | optional | `#1F3F26` | `#1F3F26` |
| `APP_ACCENT_COLOR` | optional | `#5F8B5C` | `#5F8B5C` |
| `APP_DOT_COLOR` | optional | `#7BA05B` | `#7BA05B` |
| `RESEND_FROM` | optional | unset | `Husby <noreply@familyassistant.com>` |

All defaults match the open-source FamilyAssistant brand. Setting none
of them is a valid configuration — the deploy renders as
FamilyAssistant.

The colour tokens default to the FamilyAssistant palette. Setting them
to different hex values is supported but rarely needed; the design
system was tuned around these specific OKLCH-equivalent values for
WCAG contrast.

---

## Example: Husby stack

```yaml
# Portainer stack env-vars (paste into the "Environment variables" pane)
APP_NAME=Husby
APP_NAME_PRIMARY=Hus
APP_NAME_ACCENT=by
APP_FAVICON_LETTER=h
APP_TAGLINE=Planlegg middag, gjøremål og familie
RESEND_FROM=Husby <noreply@familyassistant.com>
```

Combine with the standard required vars (`AUTH_TOKEN`, `SESSION_SECRET`,
`ENCRYPTION_KEY`, `RESEND_API_KEY`, `APP_URL`, etc.) — see
[`docs/runbooks/deploy-portainer.md`](../runbooks/deploy-portainer.md)
for the full list.

## Example: FamilyAssistant (open-source default)

```yaml
# No brand env-vars needed — defaults render as FamilyAssistant
RESEND_FROM=FamilyAssistant <noreply@familyassistant.com>
```

---

## Cross-validation warnings at boot

The server validates three soft-consistency rules at startup. Each
mismatch logs a warning via pino but does not prevent startup —
operators with a deliberate spelling difference (e.g. `APP_NAME` with
a space) get to keep their config.

1. `APP_NAME == APP_NAME_PRIMARY + APP_NAME_ACCENT` (case-insensitive,
   whitespace stripped).
2. `APP_FAVICON_LETTER == first letter of APP_NAME_PRIMARY`
   (case-insensitive).
3. `RESEND_FROM` display-name `== APP_NAME` (case-insensitive). Bare
   `addr@domain` `RESEND_FROM` (no display-name) is exempt.

Sample warning in pino-log:

```
{"level":40,"subsystem":"brand-config","msg":"APP_NAME (\"Husby\") does not match APP_NAME_PRIMARY+APP_NAME_ACCENT (\"Otherthing\")"}
```

---

## Verification checklist after deploy

After redeploying the stack with new brand-config env-vars, verify:

1. **`/api/config`** returns the expected brand fields:
   ```sh
   curl https://app.familyassistant.com/api/config | jq .
   ```
   Expected fields: `appName`, `namePrimary`, `nameAccent`,
   `faviconLetter`, `tagline`, `primaryColor`, `accentColor`,
   `dotColor`. Cache-Control: `public, max-age=3600`.

2. **`/favicon.svg`** contains the right letter:
   ```sh
   curl https://app.familyassistant.com/favicon.svg | grep -o '<text[^>]*>.</text>'
   ```
   Expected: `<text ...>h</text>` for Husby.

3. **Browser tab title** on `/` reads "Husby" (not
   "FamilyAssistant"). Open a new tab, paste the URL, watch the
   title resolve from the placeholder `&nbsp;` → `Husby`
   within ~200 ms.

4. **Header wordmark** in the app shell shows split-color
   "Hus" + "by". Variant: `<Wordmark size="sm" />`.

5. **Manifest** at `/manifest.json` carries `name: "Husby"`,
   `theme_color: "#1F3F26"`.

6. **PWA install prompt** (Chrome on Android: ⋮ menu → Install app)
   shows the brand name + favicon.

7. **Test invitation email**: from the owner's account, send an
   invite to a test address you own. Verify:
   - Subject: `Christer inviterer deg til Frestad på Husby`
   - Header wordmark renders with brand colours (not the
     pre-Sprint-10 blue fallback)
   - CTA button background is `#1F3F26`, not blue
   - Footer line: `Husby · Planlegg middag, gjøremål og familie`

8. **Test magic-link email**: trigger a login from a fresh device.
   Verify the same wordmark + CTA + footer treatment as the
   invitation email.

9. **Boot-log** in Portainer container logs shows the active brand
   at startup:
   ```
   {"level":30,"appName":"Husby","namePrimary":"Hus","nameAccent":"by","faviconLetter":"h","tagline":"Planlegg middag, gjøremål og familie","msg":"Starting Husby..."}
   ```
   Look for `subsystem: "brand-config"` warnings — they indicate
   inconsistent env-vars and should be fixed unless deliberate.

---

## Rolling out a new brand instance

Spinning up a new white-label instance ("Husby") on a separate
Portainer stack:

1. Set the brand env-vars in Portainer:
   ```
   APP_NAME=Husby
   APP_NAME_PRIMARY=Hus
   APP_NAME_ACCENT=by
   APP_FAVICON_LETTER=h
   APP_TAGLINE=Hjem og hverdag
   ```
2. Set `RESEND_FROM` with the brand domain:
   ```
   RESEND_FROM=Husby <noreply@husby.com>
   ```
3. Configure DNS for the new domain → Cloudflare Tunnel → the new
   container.
4. Deploy the stack. **No code changes — same `:main` image.**
5. Run the verification checklist above.

If the new brand requires different colours, set
`APP_PRIMARY_COLOR`, `APP_ACCENT_COLOR`, `APP_DOT_COLOR`. The token
contract guarantees no other CSS rules need to change.

---

## Known limitations (Sprint 10)

- **PNG raster derivatives** are not generated. SVG-only is supported
  for tab icons, install icons, and logo-marks. Tracked as
  [issue: feat: PNG raster derivatives for favicon and OG image](https://github.com/ChristerFrestad/FamilyAssistant/issues)
  — required before any external pilot user.
- **Privacy + terms HTML** under `public/privacy.html` etc. still
  reference "FamilyAssistant" as the operating entity. These are
  legal documents and require legal review before being re-skinned
  for Husby. Tracked as `legal:` issue.
- **Brand-config cache** in the browser holds for one hour
  (`Cache-Control: public, max-age=3600`). Operators that flip env
  values mid-day must hard-refresh or wait up to 60 min for the new
  brand to surface.

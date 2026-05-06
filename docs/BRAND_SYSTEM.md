# Hverdagsplanleggeren / FamilyAssistant — Brand System

White-label brand-system for FamilyAssistant-plattformen. Hver instans (Hverdagsplanleggeren, FamilyAssistant, og fremtidige) deler samme strukturelle DNA, men har egne ord, bokstaver og tagline styrt av env.

## Designprinsipper

1. **Wordmark er logoen.** Ikke et symbol pluss tekst — bare ord, satt i en spesifikk stil. Fargedeling i ordet markerer en konseptuell todeling (sammensatt ord på norsk, to-ords-navn på engelsk).
2. **Favicon er én bokstav.** Første bokstav i `APP_NAME_PRIMARY`, satt i samme typografi som wordmarken, på mørkegrønn container med en liten salviegrønn prikk øvre-høyre.
3. **System-fonts av prinsipp.** Ingen webfont-loading. Ingen FOIT/FOUT. Native følelse på hvert OS.
4. **Ingen ikon-illustrasjon.** Ingen kalender, ingen hake, ingen mat-symboler. Logoen sier ikke hva appen gjør — den sier hva appen heter.
5. **Mørke og lyse modi tenkt parallelt.** Ikke tilpasning — paralleldesign.

## Token-tabell

| Token | Hex | Bruk |
|---|---|---|
| `--brand-primary` | `#1F3F26` | Wordmark første del, favicon-bakgrunn, knapper, header-tekst |
| `--brand-accent` | `#5F8B5C` | Wordmark andre del, hover-states, sekundære lenker |
| `--brand-dot` | `#7BA05B` | Favicon-prikk, success-states |
| `--brand-cream` | `#F7F3E8` | Krem-bakgrunn, favicon-tekst |
| `--brand-muted` | `#5F7A66` | Tagline, sekundær brødtekst |
| `--brand-dark-bg` | `#1A2620` | Mørk modus container |
| `--brand-dark-accent` | `#9BC59A` | Mørk modus aksent-grønn |

## Env-variabler

| Variabel | Default | Eksempel (Hverdagsplanleggeren) |
|---|---|---|
| `APP_NAME` | `FamilyAssistant` | `Hverdagsplanleggeren` |
| `APP_NAME_PRIMARY` | `Family` | `Hverdags` |
| `APP_NAME_ACCENT` | `Assistant` | `planleggeren` |
| `APP_FAVICON_LETTER` | `F` | `h` |
| `APP_TAGLINE` | `Plan meals, chores and family` | `Planlegg middag, gjøremål og familie` |
| `APP_PRIMARY_COLOR` | `#1F3F26` | (samme) |
| `APP_ACCENT_COLOR` | `#5F8B5C` | (samme) |
| `APP_DOT_COLOR` | `#7BA05B` | (samme) |

Cross-validation ved oppstart:
- `APP_NAME_PRIMARY + APP_NAME_ACCENT` skal konkatenere til `APP_NAME` (case-insensitive, mellomrom-tolerant). Mismatch = warning ved boot.
- `APP_FAVICON_LETTER` skal matche første bokstav i `APP_NAME_PRIMARY`. Mismatch = warning ved boot.

Begge er warnings, ikke crashes — operatør kan ha bevisste avvik.

## Filer i client/public/branding/

| Fil | Type | Beskrivelse |
|---|---|---|
| `favicon.template.svg` | Template | Inneholder `{{LETTER}}` og `{{APP_NAME}}`. Renderes av backend ved request til `/favicon.svg`. |
| `logo-mark.template.svg` | Template | Samme prinsipp, full-størrelse mark for app-icon, OG-bilde. |

Ingen statiske `.svg`-filer per instans. Alt genereres ved request.

## Frontend-rendering

### Wordmark-komponent

Bruk `<Wordmark size="md" variant="light" />`. Henter automatisk fra `useBrandConfig()`. Aldri hardkode app-navnet i React-komponenter.

```tsx
// Riktig
<Wordmark size="lg" />

// Feil — hardkodet, går ikke gjennom config
<h1>Hverdagsplanleggeren</h1>
```

### Tagline

`useBrandConfig().tagline` brukes i footer, splash, OG-meta. Aldri hardkodet.

### Favicon i index.html

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

Disse rutene serveres alle av `branding.routes.ts` — SVG genereres dynamisk, PNG-derivater genereres ved første request og caches.

### document.title

Settes ved app-mount fra `config.appName`. Aldri hardkodet i HTML.

```tsx
useEffect(() => {
  document.title = config.appName;
}, [config.appName]);
```

## Backend-rendering

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

Public endpoint (ingen auth). Cachet i CDN i 1 time.

### Email-templates

Templates bruker Handlebars-style placeholders som flettes fra config:

```html
<h1 style="font-family: -apple-system, sans-serif; font-size: 28px; font-weight: 500; letter-spacing: -0.5px;">
  <span style="color: {{primaryColor}};">{{namePrimary}}</span><span style="color: {{accentColor}};">{{nameAccent}}</span>
</h1>
<p style="color: {{mutedColor}}; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;">
  {{tagline}}
</p>
```

Fire templates fra Sprint 9 oppdateres tilsvarende:
- `invitation-no.html` / `invitation-no.txt`
- `invitation-en.html` / `invitation-en.txt`
- Magic-link-templates (NO/EN)

CTA-knapp: `background: {{primaryColor}};` — ikke hardkodet blå.

### RESEND_FROM

Settes i Portainer per instans:
- Hverdagsplanleggeren: `RESEND_FROM=Hverdagsplanleggeren <noreply@hverdagsplanleggeren.com>`
- FamilyAssistant (hvis deployes): `RESEND_FROM=FamilyAssistant <noreply@familyassistant.com>`

Boot-warning hvis `RESEND_FROM` ikke matcher `APP_NAME` i fra-navn-feltet.

## Forbudt bruk

- Hardkode app-navn i React-komponenter, HTML, eller email-templates
- Statiske SVG-filer per instans (skal være templates med placeholders)
- Endre brand-tokens uten PR-review
- Stretche/squeeze wordmark eller favicon
- Effekter (skygge, gradient, glow) på logoen
- Webfonts — system-fonts av prinsipp

## Ny instans-checklist

For å lansere en tredje white-label-instans (f.eks. "Husby"):

1. Sett env-vars i Portainer:
   ```
   APP_NAME=Husby
   APP_NAME_PRIMARY=Hus
   APP_NAME_ACCENT=by
   APP_FAVICON_LETTER=h
   APP_TAGLINE=Hjem og hverdag
   ```
2. Sett `RESEND_FROM` med riktig avsenderdomene
3. Sett DNS for nytt domene → Cloudflare Tunnel
4. Deploy. Ingen kode-endringer.

Hvis ny instans krever andre farger: oppgrader til "nivå 3" white-label (palette-overrides via env). Logg som tech-debt inntil reelt behov.

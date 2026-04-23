# User preferences-fit — Familieassistenten redesign

**Scope:** Dokumenterer hvilke bruker-preferanser v1 må støtte, hvor de
lagres (lokalt vs server), og hvilke API-endepunkter / datamodell-
endringer som trengs for å levere Christers låste beslutninger fra
2026-04-23.

**Relatert:** `design-system.md` §12 (tema-arkitektur), `architecture-fit.md`
(feature-gating), `backend-requirements.md` §8 (migrasjon 029).

---

## 1. Hva er "user preference"?

Tre nivåer av preferanse i v1:

| Nivå | Eksempler | Lagring |
|---|---|---|
| **Per-installation config** | `APP_URL`, `GOOGLE_CLIENT_ID`, `RESEND_API_KEY` | Env-variabler. Operator styrer. |
| **Per-family config** | Gamification på/av, foretrukne butikker, Kassal-nøkkel, diettpreferanser, valuta | SQLite (`families`, `family_profile`, `integration_configs`) |
| **Per-user preference** | Tema (light/dark), språk (no/en), startside (dashboard vs ukesmeny) | `user_preferences`-tabell (migrasjon 029) + localStorage fallback |

Dette dokumentet fokuserer på **per-user preference** (nivå 3) — fordi
det er den eneste nye som trengs for redesignet.

---

## 2. Låste per-user preferences for v1

| Preferanse | Verdier v1 | Default | Ekstenderbar |
|---|---|---|---|
| **Tema** | `light`, `dark` | `dark` (fra mockup) eller `prefers-color-scheme` | Ja (se design-system.md §12) |
| **Språk** | `no`, `en` | `no` | Ja (framtid: sv, da, is, ar+RTL) |
| **Startside** | `dashboard`, `meals`, `shopping`, `chores`, `calendar` | `dashboard` | Ja — bare utvid enum |
| **Ukestart** | `monday`, `sunday` | `monday` (norsk konvensjon) | Ja |
| **Valuta** | `NOK`, `SEK`, `EUR`, `USD`, `GBP` | `NOK` | Ja |
| **Enhet-system** | `metric` (kg/l), `imperial` (lb/oz) | `metric` | Ja |
| **Time-format** | `24h`, `12h` | `24h` (norsk) | Ja |

**Merk:** Ikke alle av disse krever backend fra dag én. Se §4.

---

## 3. Low-cost v1 (localStorage-only)

For å unngå at Fase 1 blokkerer på backend-arbeid, implementerer vi
preferanser som **localStorage-first**, med valgfri sync til server:

### 3.1 Klient-side (Fase 1)

```typescript
// client/src/hooks/useUserPreferences.ts
const STORAGE_KEY = 'fa:user-preferences';

type UserPreferences = {
  theme: 'light' | 'dark';
  locale: 'no' | 'en';
  startScreen: 'dashboard' | 'meals' | 'shopping' | 'chores' | 'calendar';
  weekStart: 'monday' | 'sunday';
  currency: 'NOK' | 'SEK' | 'EUR' | 'USD' | 'GBP';
  units: 'metric' | 'imperial';
  timeFormat: '24h' | '12h';
};

const DEFAULTS: UserPreferences = {
  theme: 'dark',
  locale: 'no',
  startScreen: 'dashboard',
  weekStart: 'monday',
  currency: 'NOK',
  units: 'metric',
  timeFormat: '24h',
};

// First load: respect prefers-color-scheme for theme
// Save to localStorage on change
// Sync to server in background when /api/user/preferences lands (Fase 2)
```

### 3.2 Serverside (Fase 2 — migrasjon 029)

```sql
-- Fase 2 — migrasjon 029
CREATE TABLE user_preferences (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme         TEXT NOT NULL DEFAULT 'dark',
  locale        TEXT NOT NULL DEFAULT 'no',
  start_screen  TEXT NOT NULL DEFAULT 'dashboard',
  week_start    TEXT NOT NULL DEFAULT 'monday',
  currency      TEXT NOT NULL DEFAULT 'NOK',
  units         TEXT NOT NULL DEFAULT 'metric',
  time_format   TEXT NOT NULL DEFAULT '24h',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

```
GET  /api/user/preferences      → dagens preferanser (eller defaults)
PUT  /api/user/preferences      → oppdater (partial update OK)
```

**Synkronisering:** Ved login hentes server-verdier og skrives til
localStorage. Ved endring skrives først til localStorage (instant UX),
deretter sendes til server i bakgrunnen. Konflikt-håndtering er trivielt
— siste skrivning vinner, og det er kun én bruker per user_id.

---

## 4. Preferanse-komponenter i UI

### 4.1 Settings-skjerm (fra mockup)
Mockupen har allerede Settings → "Preferanser"-seksjon som dekker:
- Uken starter: Mandag/Søndag
- Utseende: Lys/Mørk
- Valuta og enheter: NOK · kg/l

Disse må koble til `useUserPreferences`-hook og oppdatere når brukeren
endrer valg.

### 4.2 Theme-switcher i app-shell
TopBar har allerede sun/moon-ikon som toggler tema. Dette skal bruke
`useUserPreferences` og oppdatere preferanse ved klikk.

**Arkitektur-note:** Theme-switcher viser i v1 bare sun/moon (to valg),
men når flere temaer legges til skal den automatisk bli en drop-down.
Komponenten må lese `availableThemes[]` fra `useTheme()`, ikke anta
to-valg.

### 4.3 Language-toggle i app-shell
Nytt i redesignet (ikke i mockup). Et lite NO/EN-segment i TopBar eller
Settings.

---

## 5. Gamification-preferanse — family vs user?

🔒 **Låst: family-nivå i v1** (`families.gamification_enabled`).

Dette er en *family-preferanse*, ikke user-preferanse. En forelder
slår gamification av for hele husstanden. Nivå 2 (per-medlem opt-in/out)
kommer senere hvis behov.

**Implementering:** ikke en del av `user_preferences`-tabellen. Legges
på `families`-tabellen via migrasjon 022 eller senere separat:

```sql
ALTER TABLE families ADD COLUMN gamification_enabled INTEGER NOT NULL DEFAULT 0;
```

Default er 0 (av) for alle nye familier. Familien må aktivt slå på
gamification i Settings for at det skal vises.

**UI-logikk:**
```typescript
// client/src/screens/Chores.tsx
const gamificationEnabled = useFamilyConfig().gamificationEnabled;
// Hele XP/streak/badge-blokken wrappes i {gamificationEnabled && <GamificationBlock/>}
```

---

## 6. Dietary preferences (per-medlem, fra B7)

🔒 **Låst fra B7-arbeidet (batch 2):**
- Allergies + dislikes med fallback-arv (medlem NULL → familie-nivå)
- Diet_tags med 13-verdi enum (13 verdier, `diabetiker-vennlig` utelatt)
- `custom_diet_note` fritekst

Dette er allerede implementert backend-siden (migrasjon 020). Redesignet
må bygge UI for å redigere disse — se `backend-requirements.md` §7
(Member Detail) + `components-inventory.md` (MemberDetail-komponenten
i mockup har forslag til 8-verdi-liste som må utvides til 13).

**Ikke en user_preferences-konsern.** Dette er *family-member* preferanser,
lagret i `family_profile_members`-tabellen.

---

## 7. i18n-preferanse og RTL

Fra låste føringer:
- Primær norsk, engelsk neste
- RTL-støtte i layout fra dag én (for arabisk etc.)

**Implementering:**

```typescript
// client/src/i18n/index.ts
const locales: Array<{id: string, label: string, dir: 'ltr' | 'rtl'}> = [
  { id: 'no', label: 'Norsk',    dir: 'ltr' },
  { id: 'en', label: 'English',  dir: 'ltr' },
  // Fremtid:
  // { id: 'sv', label: 'Svenska',  dir: 'ltr' },
  // { id: 'ar', label: 'العربية',   dir: 'rtl' },
];

// Når locale byttes: document.documentElement.setAttribute('dir', locale.dir)
// Tailwind configures with rtl-variant support: logical properties (ps-4 vs pl-4)
```

**CSS-konsekvenser:** bruk *logical properties* over hele kodebasen.
I Tailwind betyr det `ps-4` (padding-inline-start) over `pl-4`
(padding-left). Dette er en v1-disciplin — ikke vent til arabisk kommer.

---

## 8. Sammendrag av backend-arbeid for user preferences

| Arbeid | Fase | Estimat |
|---|---|---|
| localStorage-based preferences (uten API) | 1b/1c | 0.5 dag |
| Migrasjon 029 `user_preferences` | 2 | 0.5 dag |
| `GET/PUT /api/user/preferences` | 2 | 0.5 dag |
| Sync-logikk (localStorage ↔ server) | 2 | 0.5 dag |
| `families.gamification_enabled`-kolonne (i 022) | 2 | 0.25 dag |
| Endpoint `PUT /api/family/settings` (gamification toggle) | 2 | 0.5 dag |

**Totalt:** ~3 dager over Fase 2.

**Fase 1 (nå) leverer:** kun klient-side preferences med localStorage.
Nok til at UI kan toggle tema, språk, osv. Sync og server-persistens
kommer i Fase 2. Dette gjør at Fase 1 kan fullføres uten å blokkere
på backend-arbeid.

---

## 9. Onboarding-leveranse 2026-04-23 — P1-P4-dekningsstatus

Kilde: `source/Onboarding og Auth.html`. Evaluerer hvor godt
onboarding-flyten dekker de fire viktigste user-preference-kravene.

### P1 — Tema (light/dark) ✅ Full dekning

**Kriterie:** Alle 7 onboarding-skjermer må fungere i både lys og
mørk tema uten visuelle bugs.

**Verifikasjon (2026-04-23):**
- `Onboarding og Auth.html:38-58` definerer komplett `html[data-theme="light"]`
  override for alle tokens (--bg-0..2, --surface*, --stroke*, --text-1..3,
  --mint*, --cyan*, --amber, --coral, --rose, --ink, --ink-contrast)
- Alle styles bruker `var(--*)` — ingen hardkodede farger i inline-style
  eller Tailwind-klasser (bekreftet via spot-check på ScreenWelcome,
  ScreenLogin, ScreenBootstrap, ScreenMagicSent, ScreenError)
- `.aurora::before/::after` har `opacity: 0.28`/`0.22` under light mode
  (matcher hovedappen)
- `.term`-blokken beholder mørk bakgrunn også i light mode (intentional —
  terminal-estetikk)
- `ThemeSwitch`-komponent (`Onboarding og Auth.html:1620`) bruker
  `localStorage('fa-theme')` + `document.documentElement.setAttribute('data-theme', ...)`
- Showcase-shell (`ScreenStrip`) har `<ThemeSwitch/>` i høyre hjørne, og
  individuelle `ScreenWelcome`/`ScreenLogin` osv. har også `<ThemeToggle/>`
  øverst i høyre hjørne

**Arkitektur-konsistens:** Samme mønster som hovedappen. `useTheme()`-hook
(fra user-preferences-fit.md §4.2) kan implementeres én gang og gjenbrukes
på tvers av auth og app.

**Konklusjon:** **Ingen ekstra arbeid i Fase 1b for å støtte onboarding-
skjermers tema-bytte.** Token-CSS som bygges i Fase 1b dekker begge filer.

### P2 — Onboarding-flyt (landing → opprett konto → dashboard) ✅ Komplett

**Kriterie:** Fra "jeg har aldri brukt appen" til "jeg ser I dag-skjermen"
uten dead-ends.

**Flyt-kartlegging (happy path):**

```
ScreenWelcome (01)
  ├─ "Opprett konto" → ScreenSignup1 (03) → ScreenSignup2 (04) → [setTimeout] → /v2/today
  └─ "Jeg har en konto" → ScreenLogin (02)
                           ├─ Google → [simulert OAuth] → /v2/today
                           ├─ Email → ScreenMagicSent (06) → [bruker klikker link i mail] → /v2/today
                           └─ Console → ScreenMagicSent (06) → [bruker kopierer link fra log] → /v2/today
```

**Alternative paths:**

```
ScreenBootstrap (05) for self-host fresh-install
  └─ Step 0-4 → ScreenSignup1 (03) → ScreenSignup2 (04) → /v2/today
```

**Feilhåndtering:**

```
ScreenError (07) med 3 varianter
  └─ "Prøv igjen" → /v2/today
  └─ "Til forsiden" → ScreenWelcome (01)
  └─ "Rapporter problem" → (krever implementering i prod — feedback-kanal)
```

**Ikke blokkerende gaps:**
- "Jeg har glemt hvilken email jeg brukte" — ingen lookup-flyt. Akseptabelt for v1.
- "Jeg vil endre email senere" — Settings-skjermen i hovedappen
  håndterer dette.
- "Hvordan inviterer jeg flere familiemedlemmer?" — dekket i Settings →
  Familiemedlemmer (hovedapp). Onboarding-flyten er kun admin-bruker.

**Konklusjon:** Happy path er komplett. **Fase 1/2-implementering har alt
den trenger for å bygge end-to-end flyt.**

### P3 — Språk (i18n + RTL-forberedelse) ✅ Strukturelt klar, tekst hardkodet

**Kriterie:** Alle tekster må være oversettelses-nøkler (fra Fase 1c
og fremover). RTL-layout må fungere automatisk når språk endres.

**Observasjon 2026-04-23:**

**Bra:** `ScreenSignup1` har eksplisitt språk-picker (NO/EN) som lagres
i `formData.language`. Dette er **riktig plassering** — språk velges
under onboarding før bruker ser appen.

**Bra:** Onboarding-filen bruker `inset-inline-start`/`inset-inline-end`
og `start`/`end` Tailwind-varianter istedenfor `left`/`right` —
RTL-forberedelse fra dag én (f.eks. `Onboarding og Auth.html:77`
`inset-inline-start: -100px`, og `Onboarding og Auth.html:488`
`end-3` for inline-select-ikon).

**Bra:** Tailwind-logical-properties i alle padding/margin (`ps-4`,
`pe-4`, `ms-2`, `me-2` osv. der det trengs).

**Ikke bra:** Tekstene er hardkodet på norsk. Dette er forventet i en
mockup, men må konverteres til i18n-nøkler i produksjon.

**Eksempler på tekster å ekstrahere til `messages/no.json`:**
```json
{
  "onboarding.welcome.tagline": "Hverdagen, i {harmony}.",
  "onboarding.welcome.harmony_word": "harmoni",
  "onboarding.welcome.description": "Planlegg middager, handleliste...",
  "onboarding.welcome.feature.meals": "Ukesmeny",
  "onboarding.welcome.feature.shopping": "Handleliste",
  "onboarding.welcome.cta.primary": "Opprett konto",
  "onboarding.welcome.cta.secondary": "Jeg har en konto",
  "onboarding.welcome.footer": "Self-host med Docker. Åpen kildekode. Dine data, din hage.",
  "onboarding.login.title": "Velkommen tilbake",
  "onboarding.login.description": "Logg inn for å fortsette til familien din.",
  "onboarding.login.provider.google.label": "Fortsett med Google",
  // ... etc (ca. 80-120 nøkler totalt for hele onboarding-flyten)
}
```

**Konklusjon:** Strukturen er **RTL-klar fra dag én**. Tekstene må
ekstraheres til locale-filer i Fase 1c (når i18n-biblioteket velges).
Estimat: 0.5-1 dag for en samlet ekstraksjon av alle 7 skjermer.

### P4 — Navigasjon (responsive, mobilvennlig) ✅ Oppfyller krav

**Kriterie:** Auth-flyten må fungere på mobil og desktop uten
layout-bugs. Bunnmeny (mobil) / sidemeny (desktop) er ikke aktuelt for
auth-flyten (auth er pre-app) — men skjermene må skalere.

**Observasjon:**
- `PageShell` (`Onboarding og Auth.html:363`) gir max-width `440px`
  sentrert. Dette er mobil-first og fungerer direkte på mobil og
  desktop (sentrert på desktop).
- Device-frame på desktop (`Onboarding og Auth.html:1509`) wrapper hele
  skjermen i en "telefon-ramme" — dette er en design-tool-konsept og
  **skal fjernes** i produksjon.
- I produksjon: `PageShell`-innhold vises direkte, sentrert via
  `max-w-[440px] mx-auto`.
- Typografi skalerer: `text-[44px] sm:text-[56px]` på hero-heading
  (medium-breakpoint = 768px).
- Grid-er (f.eks. `grid-cols-2` i feature-teaser) er responsive uten
  ekstra media-queries.

**Ingen bottom-nav/sidemeny i auth-flyten:** Korrekt design. Auth-
skjermene er "deep screens" uten global-nav. Bruker navigerer via
`<Button>` + `<Link>` i innholdet.

**Etter innlogging:** Bruker lander på `/v2/today` som har bunnmeny
(mobil) og sidemeny (desktop) ifølge locked-decisions §4.7. Overgangen
er clean — auth er sin egen "kapsel", app er sin egen.

**Konklusjon:** **Ingen ekstra arbeid** i Fase 1d (app-shell + nav)
for å håndtere auth-flyten. Auth har ikke app-shell — den har sin egen
`PageShell`-variant som er self-contained.

---

## 10. Summert onboarding-P1-P4-status

| Krav | Status | Fase-implementering | Estimat |
|---|---|---|---|
| P1 Tema (light+dark for 7 skjermer) | ✅ Full | Fase 1b (tokens dekker alt) | 0 ekstra |
| P2 Onboarding-flyt (happy path komplett) | ✅ Full | Fase 1e (ny fase) | 2-3 dager |
| P3 Språk-struktur (logical props, picker) | ✅ Strukturelt | Fase 1c (i18n) | 0.5-1 dag for ekstraksjon |
| P4 Responsive (mobil + desktop) | ✅ Full | Fase 1d (nav) | 0 ekstra |

**Total ekstra-arbeid for P1-P4 utover det som allerede er planlagt:**
ca. 0.5-1 dag (kun i18n-ekstraksjonen). Alt annet er dekket av
eksisterende fase-plan.

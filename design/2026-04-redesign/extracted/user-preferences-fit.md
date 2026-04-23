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

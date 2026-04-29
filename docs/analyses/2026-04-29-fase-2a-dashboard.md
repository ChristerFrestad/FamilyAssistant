# Fase 2A — Dashboard screen

**Dato:** 2026-04-29
**Branch:** `feat/fase-2a-dashboard`
**Sprint:** 4 (start)
**Type:** medium frontend feat

---

## 1. Reisen

### 1A. Happy path (autentisert + onboardet bruker)

```
1. AuthGuard slipper bruker gjennom (cookie OK)
2. OnboardingGuard slipper bruker gjennom (onboarding_completed=1)
3. AppShell rendres, navigerer til /v2/dashboard
   3.1. Dashboard-skjermen mounter
   3.2. WelcomeHeader rendres umiddelbart (bruker fra useAuth, ingen fetch)
   3.3. 4x DashboardCard rendrer skeletons (initial isLoading=true)
   3.4. useDashboardData kicker av tre parallelle fetches
        - GET /api/today (meal + chores + today's events ignored av oss)
        - GET /api/shopping/list/current (items[].length)
        - GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD (+30d)
   3.5. Hver fetch resolver uavhengig
   3.6. Dashboard-card oppdaterer fra skeleton → data
4. Bruker ser:
   - Velkomst-melding (tid-basert: god morgen/ettermiddag/kveld)
   - 4 cards med data (eller empty-state hvis tom)
   - Quick-actions (3 knapper navigerer til /v2/meals, /v2/shopping, /v2/family)
```

### 1B. Empty data sti

```
1. Bruker er fersk (akkurat fullført onboarding)
2. /api/today.meal er null (ingen middag planlagt)
3. /api/today.chores er [] (ingen chores i dag)
4. /api/shopping/list/current.items er [] (ingen handleliste generert)
5. /api/calendar/events.events er [] (ingen events neste 30 dager)
6. Hver card viser empty-state med passende CTA-tekst
```

### 1C. Error sti

```
1. Backend nede / nettverk dør / 500-respons
2. Hver fetch failer uavhengig
3. Cardet for den fetchen viser error-state med retry-knapp
4. Andre cards (som lyktes) viser data normalt
5. Bruker klikker retry → kun den ene fetchen kjører på nytt
```

## 2. Domenemodell-påvirkning

Ingen ny entitet, ingen ny migrasjon, ingen ny forretningsregel.
Dashboardet er **read-only aggregator** som leser fra eksisterende
endepunkter.

## 3. Backend-funn (Strategi A bekreftet)

| Område | Endpoint | Rolle |
|---|---|---|
| Dagens middag | `GET /api/today` → `meal` | Brukes som-er |
| Dagens chores | `GET /api/today` → `chores` | Frontend slicer top 3 ufullførte |
| Handleliste | `GET /api/shopping/list/current` → `items[].length` | Brukes som-er |
| Kommende events | `GET /api/calendar/events?from=today&to=today+30d` → `events` | Frontend slicer top 3 |

3 parallelle calls via `Promise.all` på frontend. Ingen ny backend-
kode. Bekreftet av Christer 2026-04-29.

## 4. Edge-cases

1. **Synthetic LOCAL_USER**: AuthContext filtrerer dette til null
   (PR #77), så dashboardet får aldri en synthetic user. Hvis
   useAuth().user er null bør guard-laget allerede ha redirectet.
2. **Tid-basert greeting på midnatt**: bruker treffer dashboardet
   23:59:59 → greeting "kveld"; refresher 00:00:01 → greeting endres
   neste re-render. Akseptabel.
3. **Tom data per card**: empty-state rendres med CTA som peker til
   relevant skjerm (f.eks. "Legg til måltid").
4. **Fetch-feil per card**: cardet viser error + retry; andre cards
   påvirkes ikke.
5. **Brukerens navn er email**: `useAuth().user.name` kan være
   `email@host.com` for nye brukere som ikke har gått gjennom
   profilskjermen. Vi bruker first-token før `@` som fallback navn
   for greeting (samme heuristikk som UserProfile.tsx bruker).
6. **Veldig lang dagens middag-tittel**: card-overflow med
   `line-clamp-2` så layout ikke kollapser.
7. **Mange chores i dag (10+)**: frontend slicer til 3, viser
   "+ N flere" hint for å antyde at det er mer.
8. **Mange events neste 30 dager**: slice til 3, samme hint.
9. **Bruker bytter språk mens dashboardet er åpent**: `useTranslation`
   re-rendrer og labels endres (bekreftet via i18n-mønster fra
   eksisterende screens).
10. **Dashboard mountes mens AuthGuard laster**: AuthGuard rendrer
    sin egen loading-shell, Dashboard kjører ikke før den slipper
    gjennom — så vi treffer aldri "user=null" inni Dashboard.
11. **Nettverk dør midtveis i en fetch**: AbortController kanselleres
    automatisk på unmount (cleanup i useEffect).
12. **Veldig kort visning (320px bredde)**: cards stacker vertikalt,
    quick-actions wrapper til 2 rader.

## 5. Konsekvenser på tvers (filer)

**Nye filer:**
- `client/src/app/dashboard/dashboardApi.ts` — fetch-helpers (3 stk)
- `client/src/app/dashboard/dashboardApi.test.ts` — URL/shape-tester
- `client/src/app/dashboard/useDashboardData.ts` — hook for data-flyt
- `client/src/app/dashboard/useDashboardData.test.tsx` — hook-tester
- `client/src/app/components/dashboard/DashboardCard.tsx`
- `client/src/app/components/dashboard/DashboardCard.test.tsx`
- `client/src/app/components/dashboard/QuickActions.tsx`
- `client/src/app/components/dashboard/QuickActions.test.tsx`
- `client/src/app/components/dashboard/WelcomeHeader.tsx`
- `client/src/app/components/dashboard/WelcomeHeader.test.tsx`

**Endrede filer:**
- `client/src/app/screens/Dashboard.tsx` — placeholder erstattes
- `client/src/app/i18n/locales/no/dashboard.json` — utvidet
- `client/src/app/i18n/locales/en/dashboard.json` — utvidet (parity)

**Ikke berørt:**
- Ingen backend-filer
- Ingen migrations
- Auth-laget urørt
- Ingen konfig-endringer

## 6. Beslutninger (kort, alle bekreftet av Christer)

- **B-1 (data-strategi):** Strategi A — 3 parallelle calls til
  eksisterende endepunkter. Ingen ny aggregert endpoint. (Bekreftet)
- **B-2 (kalender-vindu):** `from=today, to=today+30d`, slice 3.
  (Bekreftet — pilot-familie kan ha lite data, 30d øker treff)
- **B-3 (greeting-name):** `useAuth().user.name`. Hvis det er
  e-postlignende (heuristikk: inneholder `@`), bruk delen før `@`.
- **B-4 (skeleton):** Inline 3-grå-linjer i DashboardCard, ikke
  ny generell Skeleton-komponent.
- **B-5 (quick-actions):** Naviger til `/v2/meals`, `/v2/shopping`,
  `/v2/family` (eksisterende placeholders i App.tsx).
- **B-6 (single-vs-three-meals):** "Dagens måltider" som card-tittel,
  innhold viser dagens middag (singular). Plural-tittelen åpner for
  breakfast/lunch i fremtiden uten endring.

## 7. Portainer-oppstartsrisiko

| Berører | Ja/Nei |
|---|---|
| `Dockerfile` eller `.dockerignore` | Nei |
| `docker-compose.yml` | Nei |
| `server/http/bootstrap.js` | Nei |
| `server/config.js` oppstartsvalidering | Nei |
| `server/index.js` startup-sekvens | Nei |
| `server/db.js` eller `server/migrations/**` | Nei |
| `install.sh` | Nei |
| `bootstrap.json`-lesning eller -skriving | Nei |
| Miljøvariabel-krav for oppstart | Nei |

**Konklusjon:** Ingen Portainer-risiko. Kun frontend-endringer.

## 8. ISO 25010

| Karakteristikk | Før | Etter | Δ |
|---|---|---|---|
| Functional Suitability | 8.8 | 8.9 | +0.1 (ny dashboard-skjerm) |
| Usability | 8.7 | 8.8 | +0.1 (faktisk hjemmeskjerm i stedet for placeholder) |
| Reliability | 8.6 | 8.6 | 0 (per-card error/retry, men ingen ny risiko) |
| Maintainability | 8.4 | 8.4 | 0 (ny mappe og hook, men ren arkitektur) |
| Performance | 8.5 | 8.5 | 3 parallelle calls = ~1 round-trip i praksis |
| Security | 8.2 | 8.2 | Ikke berørt (eksisterende auth) |

Ingen karakteristikk trekkes under 8.0.

## 9. Plan (commits)

1. `docs(analysis): add Fase 2A dashboard analysis` — denne fila
2. `feat(client/dashboard): add dashboard data hook + API client` —
   `dashboardApi.ts` + `useDashboardData.ts` + tester
3. `feat(client/dashboard): DashboardCard with loading/empty/error
   states` — `DashboardCard.tsx` + test
4. `feat(client/dashboard): WelcomeHeader and QuickActions` — to
   komponenter + tester
5. `feat(client/dashboard): wire up Dashboard screen` —
   `Dashboard.tsx` refactor
6. `chore(i18n): expand dashboard namespace for Fase 2A keys` — no/en
7. `test(client/dashboard): integration coverage for Dashboard
   screen` — Dashboard-skjermen integration test (eller
   inkludert i punktene over)

## 10. Kompleksitet

Medium frontend-feat: ~5 nye komponenter, 1 hook, 1 API-klient,
~10 tester, ~30 nye i18n-keys. Ingen backend-endring. Bundle-impact
estimert til < 5 KB gzipped basert på liknende komponenter i Fase 1b.

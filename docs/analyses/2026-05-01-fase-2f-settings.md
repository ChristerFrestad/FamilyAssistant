# Analyse — Fase 2F Settings-skjerm (Sprint 5 avsluttes)

**Dato:** 2026-05-01
**Branch:** `feat/fase-2f-settings`
**Sprint/fase:** Sprint 5 / Fase 2F (Master-plan til pilot — siste skjerm)
**Forfatter:** Claude (autonom)
**Christer-bekreftet scope:** B1 (ingen migrasjon for family-prefs) + B2 (ingen migrasjon for user-prefs) + B3 (inline-edit familienavn) + B4 (koble GDPR) + B5 (tett-scope)

---

## 1. Bakgrunn

Sprint 5 leverte fire av fem hovedskjermer (Dashboard, Family, Meals, Shopping+Pantry). Settings er sjette og siste skjerm i Fase 2 — den lukker Sprint 5 og gjør produktet "settings-komplett" for pilot-bruk.

Christer har bekreftet **tett-scope**: lever en ærlig Settings som viser dagens funksjonalitet og signaliserer hva som kommer, framfor halvferdig kode som må refaktoreres i Sprint 6/7. Mockup-Settings ([Familieassistenten.html:2288-2570](../../design/2026-04-redesign/source/Familieassistenten.html)) har 9 SettingsGroups; vi implementerer 4.

Forretningsverdi: GDPR-eksport og slett-konto er kritisk for norsk personvern-pilot. Familienavn-edit er en ofte etterspurt funksjon. System-prefs (språk/tema) gir brukerne kontroll over presentasjon. Resten er "Coming soon"-stubs som signaliserer roadmap uten å lure brukeren.

---

## 2.1 Reisen

### Reise A: Bruker åpner Settings-skjerm

```
1. Bruker tapper Settings i SideNav (desktop) eller via UserMenu (mobil)
   1.1. Router navigerer til /v2/settings
   1.2. AuthGuard verifiserer session-cookie; OnboardingGuard verifiserer
        onboarding_completed; AppShell rendrer Settings-skjermen
   1.3. ErrorBoundary wraps Settings-route (samme pattern som Shopping)
2. Settings-skjermen mounter
   2.1. useSettingsData()-hook kalles
        2.1.1. fetch GET /api/family — returnerer { family, profileMembers,
               users, portionSum }
        2.1.2. Ingen blokkerende hovedfetch — system-prefs leses fra
               localStorage og i18n-config (eksisterende flyt)
        2.1.3. Hooks-state: { family, isLoading, error, ... }
   2.2. Loading-state: skeleton (3 placeholder-Card)
   2.3. Hvis error: error-card med retry
   2.4. Hvis data: rendr 4 seksjoner i rekkefølge
3. Bruker ser Settings
   3.1. SYSTEM-seksjon: språk-row (LanguageSwitcher), tema-row (ThemeToggle)
   3.2. FAMILIE-seksjon: navn-row (inline-edit), tidssone (disabled), måltids-tider
        (disabled), gamification (disabled) — disabled rader har "Coming soon"-hint
   3.3. BRUKER-seksjon: notifikasjoner (disabled, "Krever Resend — Sprint 7")
   3.4. KONTO-seksjon: "Last ned mine data" + "Slett konto" + versjon-footer
```

### Reise B: Bruker redigerer familienavn (inline-edit)

```
1. Bruker tapper "Endre" i familienavn-row eller klikker direkte på navnet
   1.1. SettingsRow's `right`-slot bytter fra "Endre"-knapp til input + Save/Cancel
        1.1.1. Inputen får autoFocus
        1.1.2. Eksisterende navn er pre-utfylt
        1.1.3. Validering: trim, ikke tom, max 100 tegn (matcher backend)
2. Bruker skriver nytt navn og trykker Enter (eller Save-knapp)
   2.1. handleSubmit kalkulerer endring
   2.2. Optimistic update: state.family.name = nyttNavn umiddelbart
   2.3. PUT /api/family { name: nyttNavn } kalles
   2.4. Suksess: row tilbake til read-mode med nytt navn, vis "Lagret"-toast
   2.5. Feil: rollback navn, vis error-toast med detail
3. Bruker trykker Esc / Cancel-knapp
   3.1. Forkast endring, tilbake til read-mode
4. Edge: bruker er ikke owner
   4.1. Backend returnerer 403 (requireRole('owner'))
   4.2. Frontend viser "Kun owner kan endre familienavn"
   4.3. Disable "Endre"-knappen for ikke-owner i første runde for å unngå feilen
```

### Reise C: Bruker laster ned data (GDPR eksport)

```
1. Bruker tapper "Last ned mine data" i Konto-seksjonen
   1.1. Knappen viser loading-spinner
2. Frontend kaller GET /api/me/export
   2.1. Backend returnerer JSON med user+family+all data
   2.2. Frontend lager Blob fra response
        2.2.1. type: application/json
   2.3. Frontend lager hidden <a download="familyassistant-export-YYYY-MM-DD.json">
        og klikker programmatisk
   2.4. Fil lastes ned i browser
3. Suksess: vis kort "Lastet ned"-toast
4. Feil: vis error-toast
```

### Reise D: Bruker sletter konto

```
1. Bruker tapper "Slett konto" i Konto-seksjonen
2. Owner-sjekk
   2.1. Hvis bruker er owner: vis tooltip "Du må overføre eierskap eller
        slette familien først" og blokker handlingen (knappen kan være enabled
        men handler viser toast i stedet for å sende DELETE)
   2.2. Andre: gå videre til 3
3. Bekreftelse via window.confirm()
   3.1. Tekst: "Slett konto? Du har 30 dager på å angre. Etter det er all
        data slettet permanent."
   3.2. Bruker avbryter: ingen handling
   3.3. Bruker bekrefter: gå videre
4. Frontend kaller DELETE /api/me
   4.1. Backend soft-deleter brukeren med 30-dagers grace
   4.2. Backend logger ut sessionen
   4.3. Frontend redirecter til /v2/login med "Konto slettet"-melding
5. Edge: nettverks-feil
   5.1. Vis error-toast, ingen state-endring
```

### Reise E: Bruker prøver disabled "Coming soon"-row

```
1. Bruker tapper en disabled row (f.eks. tidssone)
   1.1. Pointer-events er none → ingen aksjon
   1.2. Visuelt: row har lavere opacity, "Kommer snart"-badge til høyre
   1.3. Hint-tekst under label: "Kommer i Sprint 7" (eller relevant sprint)
2. Bruker forstår at funksjonen er ikke aktiv
```

---

## 2.2 Domenemodell-påvirkning

### Backend (uendret — ingen ny kode)

| Fil | Status | Notat |
|-----|--------|-------|
| `server/auth/family-routes.js` | uendret | `GET /api/family`, `PUT /api/family` |
| `server/auth/gdpr-routes.js` | uendret | `GET /api/me/export`, `DELETE /api/me` |
| `server/migrations/*.sql` | uendret | Ingen ny migrasjon (B1, B2) |

### Frontend (ny kode)

| Fil | Type | Notat |
|-----|------|-------|
| `client/src/app/settings/settingsApi.ts` | ny | `fetchFamily`, `renameFamily`, `exportMyData`, `deleteMyAccount` |
| `client/src/app/settings/settingsApi.test.ts` | ny | API-tester |
| `client/src/app/settings/useSettingsData.ts` | ny | Hook: family, loading, error, save/export/delete actions |
| `client/src/app/settings/useSettingsData.test.tsx` | ny | Hook-tester |
| `client/src/app/components/settings/SettingsSection.tsx` | ny | Card-container med tittel + valgfri beskrivelse |
| `client/src/app/components/settings/SettingsRow.tsx` | ny | Label + valgfri description + control + valgfri disabled-hint |
| `client/src/app/components/settings/InlineEditableText.tsx` | ny | Wrapper for inline-edit-pattern |
| `client/src/app/components/settings/DataExportButton.tsx` | ny | "Last ned"-knapp med blob-download |
| `client/src/app/components/settings/DeleteAccountButton.tsx` | ny | "Slett konto"-knapp med owner-sjekk + confirm |
| `client/src/app/components/settings/*.test.tsx` | ny (5 stk) | Komponent-tester |
| `client/src/app/screens/Settings.tsx` | endret | Bygges om fra placeholder til full skjerm |
| `client/src/app/screens/Settings.test.tsx` | ny | Integrasjons-test for hele skjermen |
| `client/src/app/App.tsx` | endret | ErrorBoundary rundt /settings-route |
| `client/src/app/i18n/locales/no/settings.json` | endret | Utvid med system + user + konto + comingSoon-keys |
| `client/src/app/i18n/locales/en/settings.json` | endret | Speil endringene |
| `design/2026-04-redesign/design-gaps.md` | endret | Ny entry "Settings forenklet for pilot" |

### DOMAIN_MODEL.md

Ingen ny entitet. `families`-tabellen og `users`-tabellen finnes fra før — denne PR-en konsumerer eksisterende skjema. Ingen oppdatering.

---

## 2.3 Edge-cases

1. **Bruker er ikke owner og prøver navn-edit:** "Endre"-knappen er disabled for ikke-owner; backend ville returnert 403 uansett. Vi har user.role tilgjengelig fra `GET /api/family` response.

2. **Bruker er owner og sletter konto:** Backend returnerer 403 ("Transfer ownership..."). Frontend forhåndssjekker `user.role === 'owner'` og viser inline-hint i stedet for å sende DELETE som vi vet feiler.

3. **Familienavn over 100 tegn:** Backend Zod rejecter (errors.badRequest). Frontend forhåndssjekker `name.trim().length <= 100` og blokker submit.

4. **Familienavn tom string:** Tilsvarende — frontend blokker submit, backend ville rejected med "Family name is required".

5. **Familienavn samme som forrige (ingen endring):** Submit no-op (ingen API-kall, exit edit-mode med Cancel-effekt).

6. **GDPR export feiler (network/500):** Vis error-toast med retry-mulighet. Ingen state-endring.

7. **GDPR export returnerer ekstremt stor JSON (10+MB):** Browser håndterer det via Blob; ingen ekstra logikk i pilot. Pilot-data er små.

8. **DELETE /api/me feiler etter user trykket OK:** Vis error-toast, ikke redirect. Bruker kan prøve igjen.

9. **Bruker mister nett midt i delete:** Backend kan ha utført soft-delete eller ikke. Frontend viser error; ved neste login vil de enten være låst ute (delete fungerte) eller komme inn (delete feilet) — backend er kilde til sannhet.

10. **LanguageSwitcher i Settings vs i header:** Begge bør oppdatere samme localStorage-key (`fa:language`). Eksisterende komponent håndterer dette.

11. **ThemeToggle i Settings vs i header:** Tilsvarende — eksisterende komponent håndterer.

12. **Disabled rad-klikk:** Pointer-events: none så onClick aldri trigges. Tab-tast skipper også (tabIndex={-1}).

13. **Loading av /api/family timeout:** Standard fetch-feil → error-card med retry.

14. **API returnerer family.name som null:** Defensive null-handling viser placeholder "—" og disable edit til neste fetch.

15. **Bruker har ingen family (orphaned user):** Backend returnerer 403 ("User is not currently in a family") — vis error-card med relevant melding. Skal ikke skje for normalt onboardet bruker, men forsvar mot edge-case.

16. **Mobile viewport:** Card-stack vertikalt, full bredde. SettingsRow lar control wrappe under label hvis trangt.

17. **Desktop viewport:** Maks-bredde 800px, sentrert. Card-padding standard `--p-md`.

18. **Tab-navigasjon:** Hver row er tabbable; disabled rows skipped; inline-edit-mode trapper fokus.

19. **Bruker logger ut mens den er på Settings:** UserMenu håndterer dette; AppShell unmounter Settings.

20. **Bruker bytter språk midt i edit-mode:** i18n-keys oppdateres reaktivt; input-state beholdes.

---

## 2.4 Konsekvenser på tvers

| Område | Endring | Notat |
|--------|---------|-------|
| Frontend-komponenter | 7 nye, 1 endret (Settings.tsx), 1 endret (App.tsx for ErrorBoundary) | settings-mappa speiler shopping/pantry-mappa |
| API-endepunkter | Ingen nye | Konsumerer eksisterende family + GDPR |
| Database-migrasjoner | Ingen | B1+B2 bekreftet |
| OpenAPI-oppdatering | Ingen | Endepunkter uendret |
| Tester (frontend) | ~50 nye tester | hooks + 7 komponenter + integrasjon |
| Tester (backend) | Ingen nye | Eksisterende GDPR + family-tester dekker det vi konsumerer |
| `docs/DOMAIN_MODEL.md` | Ikke oppdatert | Ingen ny entitet |
| `design/2026-04-redesign/design-gaps.md` | 1 ny entry | "Settings forenklet for pilot" |
| Bundle-størrelse | Estimert +4-6 KB gzipped | Tilsvarer forrige Pantry-impact |
| Routing | Uendret rute | `/v2/settings` finnes; ErrorBoundary legges på |
| ErrorBoundary | Ny wrap rundt /settings | Samme pattern som /shopping |

---

## 2.5 Beslutninger (Christer-bekreftet)

### BESLUTNING 1: Migrasjon for family-prefs?

**VALG:** Ingen migrasjon. Vis timezone/meal_times/gamification som "Coming soon"-rader (disabled).

**HVORFOR:** Christer-bekreftet. Pilot-feedback skal drive datamodell-låsing.

### BESLUTNING 2: Migrasjon for user-prefs (notifications)?

**VALG:** Ingen migrasjon. Vis notifikasjons-toggles som disabled med "Krever Resend (Sprint 7)".

**HVORFOR:** Christer-bekreftet. Resend designer prefs-modellen sammen med send-modellen.

### BESLUTNING 3: Familienavn-edit?

**VALG:** Inline-edit (input erstatter tekst, blur eller Enter lagrer).

**HVORFOR:** Christer-bekreftet. Unngår modal-scope-creep.

### BESLUTNING 4: GDPR-funksjoner?

**VALG:** Koble til eksisterende `GET /api/me/export` og `DELETE /api/me`. `window.confirm()` for slett-bekreftelse er OK for pilot.

**HVORFOR:** Christer-bekreftet. GDPR er kritisk for norsk personvern-pilot. Endepunktene finnes og er testet.

### BESLUTNING 5: Scope-omfang?

**VALG:** Tett-scope. 4 seksjoner: System, Familie, Bruker, Konto. Disabled stubs for Coming soon-funksjoner.

**HVORFOR:** Christer-bekreftet. Lever ærlig pilot-MVP, ikke halvferdig kode.

### BESLUTNING 6 (impliseres): ErrorBoundary

**VALG:** Wrap /settings-route med ErrorBoundary, samme pattern som /shopping.

**HVORFOR:** Konsistent med tidligere skjermer. Beskytter mot uventede render-feil i embedded LanguageSwitcher/ThemeToggle.

### BESLUTNING 7 (impliseres): Disabled-rad-design

**VALG:** Reduser opacity til 0.6, tilbake-grunn `bg-canvas-1`, disable pointer-events. Vis "Kommer snart"-badge til høyre med relevant sprint-tekst.

**HVORFOR:** Brukeren skal forstå at funksjonen er kjent men ikke aktiv. Matcher mockup-pattern for "Coming soon"-stub.

### BESLUTNING 8 (impliseres): Owner-restriksjoner i UI

**VALG:** Disable "Endre"-knapp for familienavn når `user.role !== 'owner'`. Disable "Slett konto"-knapp når bruker er owner OG har family (matcher backend 403). Vis tooltip/inline-hint som forklarer.

**HVORFOR:** Konsistent UX — ikke la brukeren prøve handlinger som er garantert å feile.

---

## 2.6 Portainer-oppstartsrisiko-sjekk

| Fil | Berørt? |
|-----|---------|
| `Dockerfile` | Nei |
| `.dockerignore` | Nei |
| `docker-compose.yml` | Nei |
| `server/http/bootstrap.js` | Nei |
| `server/config.js` (oppstartsvalidering) | Nei |
| `server/index.js` (startup-sekvens) | Nei |
| `server/db.js` eller `server/migrations/**` | Nei (B1+B2 bekreftet, ingen migrasjon) |
| `install.sh` | Nei |
| `bootstrap.json`-lesning eller -skriving | Nei |
| Miljøvariabel-krav for oppstart | Nei |

**Konklusjon:** Ingen Portainer-oppstartsrisiko. Ren frontend-PR. Ingen DEL 3 Steg 3b-prosedyre.

---

## 2.7 ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Begrunnelse |
|---------------|-----|-------|-------------|
| Funksjonell egnethet | 8.8 | 8.9 (+0.1) | Settings fyller mangelen "kontroll over personlig + familie-konfig". GDPR aktivert. |
| Brukbarhet | 8.7 | 8.8 (+0.1) | Inline-edit er smidig; "Coming soon"-stubs gir transparent forventning. |
| Pålitelighet | 8.5 | 8.5 (uendret) | ErrorBoundary + optimistic-rollback-pattern er etablert. |
| Ytelse | 8.4 | 8.4 (uendret) | +4-6KB bundle ubetydelig. Én GET /api/family ved mount. |
| Sikkerhet | 8.2 | 8.3 (+0.1) | GDPR-kobling lukker pilot-launch-blocker. Owner-sjekk forhindrer 403-uth-loops. |
| Vedlikeholdbarhet | 8.6 | 8.6 (uendret) | Settings-mappa speiler shopping/pantry. Test-coverage > 85%. |
| Portabilitet | 8.6 | 8.6 (uendret) | Ingen runtime/dependency-endringer. |
| Kompatibilitet | 8.5 | 8.5 (uendret) | Ingen API-endring. |

**Snitt:** 8.51 → 8.55 (+0.04). Ingen karakteristikk under 8.0.

---

## 2.8 Plan (commits i rekkefølge)

| # | Commit | Beskrivelse | Estimert diff |
|---|--------|-------------|----------------|
| 1 | `docs(analysis): add analysis for fase-2f-settings` | Dette dokumentet | +400 linjer |
| 2 | `feat(client/settings): add settingsApi + useSettingsData hook` | API + hook + tester | +500 linjer |
| 3 | `feat(client/settings): add SettingsSection + SettingsRow + InlineEditableText` | Container + row + inline-edit | +400 linjer |
| 4 | `feat(client/settings): add DataExportButton + DeleteAccountButton` | GDPR-knapper med tester | +300 linjer |
| 5 | `feat(client/settings): integrate Settings screen + i18n + ErrorBoundary` | Settings.tsx full implementation, App.tsx wrap, i18n-utvidelser | +500 linjer |
| 6 | `docs(design): log Settings simplification as design-gap` | design-gaps entry | +30 linjer |

**Total estimert:** ~6 commits, +2130 linjer (mest tester og JSON-bundles).

---

## 2.9 Kompleksitet-vurdering

Christer's CONTEXT.md sier "Sprint 5 Settings — siste skjerm". Christer's prompt (Prompt 11) er detaljert og bekreftet alle 5 beslutninger.

- **>3 domeneområder berørt:** Frontend-settings, frontend-i18n, ErrorBoundary-wrap, design-gaps. Som forventet for siste skjerm i en sprint.
- **Datamodell-endring:** Nei (B1+B2 bekreftet).
- **Ny forretningsregel:** Nei. Owner-restriksjon er eksisterende backend-regel som UI bare reflekterer.
- **Edge-cases:** 20 dokumentert (over 8 minimum).

**Konklusjon:** Middels-stor oppgave (~6 commits, ~2100 linjer mest tester). Ingen scope-overraskelser. Fortsetter til kode.

---

## 3. Sikkerhets-sjekkliste (utfylles i PR)

| Punkt | Status | Notat |
|-------|--------|-------|
| All brukerinput valideres via Zod (server) | Ja | Eksisterende Zod på `PUT /api/family` |
| SQL parameterisert | Ja | Ingen ny SQL skrives |
| Filopplastinger | Ikke relevant | Ingen filopplasting |
| Nye endepunkter har auth-sjekk | Ikke relevant | Ingen nye endepunkter |
| Cross-tenant data-lekkasje | Ja, sjekket | Eksisterende family-context-scoping |
| API-nøkler i kode | Nei | Ingen secrets |
| PII logges ikke | Ja | GDPR-eksport går direkte til klient, ingen server-side logging |
| Feilmeldinger lekker ikke intern info | Ja | Eksisterende error-pattern |
| Sensitive felter aldri i API-respons | Ja | session ids er masked i export per backend-test |
| Ingen `innerHTML` med user-data | Ja | React eskaperer default; familienavn er ren tekst |
| Eksterne lenker `noopener` | Ikke relevant | Ingen eksterne lenker |
| CSP ikke svekket | Ja | Ingen nye inline scripts |

---

## 4. Manuell test-instruksjoner (for Christer post-merge)

1. Logg inn som owner (admin@example.com).
2. Naviger til `/v2/settings`.
3. Verifiser 4 seksjoner: System, Familie, Bruker, Konto.
4. **System:** Bytt språk (NO/EN) — UI skal oppdatere alle tekster reaktivt.
5. **System:** Bytt tema — UI skal skifte light/dark umiddelbart.
6. **Familie:** Tap "Endre" på familienavn → skriv nytt navn → trykk Enter → "Lagret"-toast.
7. **Familie:** Tap "Endre" → skriv navn → trykk Esc → endring forkastes.
8. **Familie:** Verifiser at tidssone, måltids-tider, gamification er disabled med "Kommer snart"-badge.
9. **Bruker:** Verifiser at notifikasjons-toggles er disabled med "Krever Resend (Sprint 7)".
10. **Konto:** Tap "Last ned mine data" → JSON-fil skal lastes ned.
11. **Konto:** Tap "Slett konto" → siden owner: vis tooltip "Du må overføre eierskap først".
12. **Konto:** Logg inn som ikke-owner-bruker (krever et test-medlem eller manuell DB-edit).
13. **Konto:** Tap "Slett konto" → window.confirm() → bekreft → redirect til /v2/login.
14. Mobile (390x844): seksjoner stack vertikalt, full bredde.
15. Desktop (1280+): maks-bredde 800px, sentrert.

**Slutt på analyse.**

# Fase 2B — Family screen (Sprint 4 fortsetter)

> Dato: 2026-04-30
> Branch: `feat/fase-2b-family`
> Forfatter: Claude (autonom agent)
> Anbefalt PR-tittel: `feat: Fase 2B — Family screen (Sprint 4 continues)`

## Bakgrunn

Sprint 4 fortsetter etter at Fase 2A Dashboard ble merget i PR #78
(2026-04-29). Andre hovedskjerm i Fase 2 er Family — en dedikert
oversikt over alle familie-medlemmer med live-justerbar
porsjonsfaktor per medlem.

Ruten `/v2/family` finnes allerede i [client/src/app/App.tsx:96](../../client/src/app/App.tsx)
men peker mot en placeholder-versjon av `Family.tsx`. Denne fasen
erstatter placeholder med en funksjonell skjerm.

## 2.1 Reisen

```
Bruker (innlogget Christer) klikker "Familie" i bunnmeny / sidemeny
1.1. AppShell rendrer Family-skjerm under /v2/family
1.2. Family-skjermen mounter
  1.2.1. useFamilyData() trigger fetch mot GET /api/family
  1.2.2. Imens vises skeleton-state for medlems-grid
1.3. Backend returnerer { family, profileMembers, users, portionSum }
  1.3.1. Hooket transformerer dataen: hver profile_member
         dekoreres med linket user (matchet via user.profileMemberId)
  1.3.2. Christer's bruker (matchet via authContext.user.profileMemberId)
         markeres som "currentUser=true"
  1.3.3. Skjermen rendrer header med familie-navn + grid med
         MemberCard-er

Bruker drar slider på sin egen MemberCard
2.1. PortionFactorSlider native input fyrer onChange med ny verdi
  2.1.1. Snapping skjer automatisk via input[type=range] step=0.1
  2.1.2. Verdien kommer som number, range 0.2-2.0
2.2. MemberCard kaller props.onPortionChange(newValue)
  2.2.1. Optimistic update: lokal state for medlemmet oppdateres umiddelbart
  2.2.2. PUT /api/family/members/:id med body { portionFactor: newValue }
  2.2.3. Inline status under slider viser "Lagrer..." mens request er i flight
2.3. Backend-respons håndteres
  2.3.1. Suksess: status flippes til "Lagret" i ~1.5s, så fades vekk
  2.3.2. 4xx/5xx: rollback til forrige verdi, status flippes til "Kunne ikke lagre"
  2.3.3. 401 (utlogget under bruk): rollback + redirect til login via AuthContext
2.4. Etter suksess kunne summen "porsjons-budsjett" oppdateres
  (men det vises ikke i denne fasen — kun per-medlem-verdi)

Bruker klikker "Inviter medlem"
3.1. Inline-status under knappen viser "Kommer i Sprint 5+"
  3.1.1. Status auto-dismisses etter ~3s
  3.1.2. Knappen forblir aktiv (ikke disabled), men viser placeholder
3.2. Backend POST /api/family/invitations finnes, men UI-flyt
     designes i Sprint 5+ (krever invite-modal, link-kopiering, QR-kode)

Bruker klikker "Rediger" ved familie-navn
4.1. Inline-status under header viser "Kommer i Sprint 5+"
4.2. Backend PUT /api/family finnes, men rename-modal designes senere

Edge: bruker har bare seg selv som medlem (én person i familien)
5.1. listMembers returnerer [christer]
5.2. Empty-state vises IKKE — vi viser Christer's egen MemberCard
5.3. En subtil hint-tekst under medlems-grid: "Du er den eneste
     i familien. Inviter andre når funksjonen er klar."

Edge: backend returnerer 401 (session utløpt)
6.1. familyApi kaster FamilyApiError(401)
6.2. useFamilyData fanger feilen
6.3. Family-skjerm viser error-state med "Du må logge inn på nytt"
     + retry-knapp som re-trigger fetch (vil 401 igjen, men det er
     OK — AuthContext fanger det globalt og redirecter)

Edge: bruker er medlem (ikke owner) som åpner skjermen
7.1. Vi viser samme grid for alle roller
7.2. Inviter-/Rediger-knapp er synlige for alle (placeholder, ingen privilegie-
     gating siden de bare viser status-meldinger)
7.3. Portion-slider er aktiv for alle adults (PUT-endpointet krever
     role='adult' eller 'owner', children får 403 — vi håndterer det
     som vanlig API-feil)
```

## 2.2 Domenemodell-påvirkning

Ingen ny entitet, ingen ny migrasjon. Domenet eksisterer fra
migration 009 (family_profile) og 014 (auth_and_multi_family) +
023 (portion_factor_user_and_tighter_range).

Berørte filer:

- `server/auth/family-routes.js`: ingen endring — eksisterende
  `GET /api/family` + `PUT /api/family/members/:id` er tilstrekkelige
- `server/repositories/family.repo.js`: ingen endring
- `client/src/app/screens/Family.tsx`: erstatte placeholder
- `client/src/app/family/familyApi.ts`: NY — API-klient
- `client/src/app/family/familyApi.test.ts`: NY — tester
- `client/src/app/family/useFamilyData.ts`: NY — hook
- `client/src/app/family/useFamilyData.test.tsx`: NY — tester
- `client/src/app/components/family/MemberCard.tsx`: NY — komponent
- `client/src/app/components/family/MemberCard.test.tsx`: NY — tester
- `client/src/app/screens/Family.test.tsx`: NY — tester
- `client/src/app/i18n/locales/no/family.json`: utvid med ~25 keys
- `client/src/app/i18n/locales/en/family.json`: speil samme keys

Domenemodell-relasjon som klargjøres i denne fasen (men ikke endres):

```
families (1) ─< family_profile_members (N)  ─◇ users (0..1)
                                              via users.profile_member_id
```

Ett `family_profile_members`-rad er kanonisk. Et `users`-rad lenker
seg til en plass på rosteret hvis brukeren har egen login. Ikke alle
profile-members har en linket user (barn uten konto, ikke-godtatt
invitering, ...).

DOMAIN_MODEL.md får et entry for begge entiteter etter merge — først
gang vi formelt dokumenterer dem.

## 2.3 Edge-cases

1. **Familie med én person.** Christer alene. Vi viser hans MemberCard
   uten "(Deg)"-badge ramme rundt grid (badge vises fortsatt på navnet).
   Hint-tekst under grid om at andre kan inviteres senere.

2. **Profile-member uten linket user.** F.eks. barn som ikke har konto,
   eller invitering ikke akseptert ennå. Vises i grid uten rolle-badge,
   kun kategori (adult/teen/child).

3. **User uten linket profile-member.** Sjelden, men kan oppstå hvis
   `users.profile_member_id` er null (f.eks. invitering akseptert før
   profile-member-rad ble laget). Vi viser ikke disse — profile_members
   er kanonisk liste, så users uten profile_member faller utenfor.
   Logger et console-warn for debugging.

4. **Portion-factor PUT feiler 4xx (validering).** Backend kaster 400
   hvis verdi utenfor 0.1-2.0. Slider clamp-er til 0.2-2.0 client-side
   så dette skal aldri skje, men vi viser likevel "Kunne ikke lagre"
   og rollback-er.

5. **Portion-factor PUT feiler 401 (utløpt session).** AuthContext
   håndterer global redirect til login. Vi viser "Kunne ikke lagre"
   inline og rollback-er; AuthGuard tar brukeren videre.

6. **Portion-factor PUT feiler 403 (child prøver å endre).** Backend
   krever role='adult'+. Vi viser "Kunne ikke lagre" — faktisk
   error-string fra backend brukes ikke, kun generisk melding (per
   i18n).

7. **Concurrent updates.** Christer drar slider raskt: hver onChange
   trigger en ny PUT. Vi aborter forrige in-flight request via
   AbortController per medlem, så bare siste verdi når serveren.

8. **Network offline midt i drag.** Fetch kaster TypeError.
   useFamilyData fanger og setter error-state for det aktuelle
   medlemmet. Rollback til forrige verdi.

9. **Initial GET /api/family feiler.** Skjerm-nivå error-state med
   retry-knapp. Skeleton vises ikke etter feil; en error-card med
   tekst + retry-knapp.

10. **Bruker oppdaterer egen portion → andre brukere ser ikke endringen.**
    Vi har ingen real-time-synk i v1. Andre brukere ser endringen
    først ved neste page-load. Akseptabelt for pilot — multi-user
    samtidig redigering er ikke i scope.

11. **profile_member.portionFactor er ikke et tall.** Backend
    skal alltid returnere number (parsed), men vi defensivt clamp-er
    til [0.2, 2.0] og default-er til 1.0 ved NaN.

12. **Mobile: lang familie-liste blir lang vertikal scroll.** Grid
    bryter til 1 kolonne under sm-breakpoint (640px). Akseptabelt —
    typisk familie er 2-6 medlemmer.

## 2.4 Konsekvenser på tvers

- **Frontend (`client/`):**
  - `client/src/app/screens/Family.tsx`: erstattes
  - To nye undermapper: `family/` (api+hook) og `components/family/`
  - i18n-bundle vokser med ~25 keys per språk
- **API-endepunkter (`server/`):** ingen endring
- **Database-migrasjoner:** ingen
- **OpenAPI:** ingen endring (endepunktene er allerede dokumentert)
- **Tester:** ~4 nye test-filer på client-siden
  (familyApi, useFamilyData, MemberCard, Family-skjerm)
- **DOMAIN_MODEL.md:** vil få entry for `families` +
  `family_profile_members` + `users`-relasjonen ETTER merge — første
  formelle dokumentasjon

## 2.5 Beslutninger

### B1: Toast/notification for placeholder-meldinger

ANBEFALING: Inline-status per knapp, lokal state, auto-dismiss etter ~3s.

HVORFOR: Eneste forbruk er to placeholder-knapper + portion-slider
sukses/feil. Full Toast-system er scope-creep; lett å migrere senere.

ALTERNATIVER:
- Bygg full Toast-komponent + ToastProvider: ~50 linjer ekstra,
  konseptuelt riktig men utenfor MVP-scope
- `window.alert()`: a11y-mareritt, frarådet

KONSEKVENS HVIS ANNERLEDES: Christer foretrakk inline (bekreftet B1).

### B2: "Rediger familie-navn"-handler

ANBEFALING: Synlig knapp som viser inline-placeholder
"Kommer i Sprint 5+".

HVORFOR: Backend `PUT /api/family` finnes, men full rename-flyt med
validering + konfirmering + uppdatert state-propagering hører til
egen liten feature i Sprint 5+. Kan brukes med Modal-komponenten
(`overlay/Modal.tsx`) som finnes.

ALTERNATIVER:
- Inline-edit i header (input-felt på klikk): ~30 linjer ekstra
- Modal-flyt: scope-creep

KONSEKVENS HVIS ANNERLEDES: Christer bekreftet placeholder (B2).

### B3: Datamodell-mapping mellom profile_members og users

ANBEFALING: Vis `profileMembers` som kanonisk liste; for hver,
finn linket user via `user.profileMemberId === member.id`. Vis
rolle-badge bare når user finnes; "(Deg)"-badge når
`authContext.user.profileMemberId === member.id`.

HVORFOR: profile_members er roster-rader (alle har en plass på
familien), users er underset (kun de med login-konto). Bedre å
bygge UI rundt roster-konseptet enn user-konseptet.

ALTERNATIVER:
- Vis users som kanonisk: ekskluderer profile-members uten user
- Vis begge separat: forvirrende UI

KONSEKVENS HVIS ANNERLEDES: Christer bekreftet B3.

### B4: Optimistic update for portion-slider

ANBEFALING: Optimistic update + rollback ved feil. AbortController per
medlem-rad slik at hurtig drag ikke gir race-conditions.

HVORFOR: Slider-feedback må være instant for god UX. Backend-validering
er deterministisk (range 0.1-2.0), så optimistic er trygt — feil betyr
nesten alltid network/auth, ikke valideringsfeil.

ALTERNATIVER:
- Pessimistic (lock slider til respons kommer): laggy UX
- Debounced update (vent 500ms etter siste drag): bedre throughput
  men mer kompleks state-håndtering

KONSEKVENS HVIS ANNERLEDES: Forsinket UX, kompleksitets-tradeoff.

### B5: Skeleton vs full loading-spinner

ANBEFALING: Skeleton-grid for medlems-list under initial fetch
(samme pattern som DashboardCard).

HVORFOR: Konsistens med Dashboard. Skeleton signaliserer struktur,
spinner signaliserer "venter" — første gir bedre opplevelse.

ALTERNATIVER:
- Spinner: enklere men mindre informativ
- Ingen loading-indikator: dårlig UX

KONSEKVENS HVIS ANNERLEDES: Mindre konsistens, ikke kritisk.

## 2.6 Portainer-oppstartsrisiko-sjekk

| Område | Berøres? |
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

**Konklusjon: ingen Portainer-risiko.** Klient-only endring; backend
uendret. Container-oppstart, image-pull og bootstrap-flyt påvirkes
ikke. PORTAINER-RISIKO-prosedyren utløses ikke. PR kan godkjennes
gjennom vanlig DEL 5.3-flyt (feat/-prefiks krever Christer).

## 2.7 ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Begrunnelse |
|---|---|---|---|
| Funksjonell egnethet | 8.7 | 8.8 (+0.1) | Andre Fase-2-skjerm faktisk fungerer (ikke placeholder) |
| Brukbarhet | 8.5 | 8.6 (+0.1) | Live portion-justering, optimistic UX, konsistente loading-states |
| Vedlikeholdbarhet | 8.7 | 8.7 (uendret) | Følger Dashboard-pattern; ingen ny pattern introduseres |
| Pålitelighet | 8.5 | 8.5 (uendret) | Optimistic update + rollback er trygt; ingen ny failure-mode |
| Sikkerhet | 8.2 | 8.2 (uendret) | Ingen nye endepunkter, ingen ny auth-logikk |
| Ytelse | 8.3 | 8.3 (uendret) | Bundle +6-9 KB, langt under budsjett |
| Kompatibilitet | 8.6 | 8.6 (uendret) | Ingen ny browser-API |
| Portabilitet | 8.4 | 8.4 (uendret) | Ingen container/deploy-endringer |

**Snitt:** ~8.55 → ~8.57 (+0.02). Ingen karakteristikk under 8.0.

## 2.8 Plan

Commits i rekkefølge:

1. `docs(analysis): add analysis for Fase 2B family screen` (denne fila)
2. `feat(client/family): API client and data hook for family fetch + portion update`
   - `client/src/app/family/familyApi.ts` (~100 linjer)
   - `client/src/app/family/familyApi.test.ts` (~80 linjer)
   - `client/src/app/family/useFamilyData.ts` (~110 linjer)
   - `client/src/app/family/useFamilyData.test.tsx` (~120 linjer)
3. `feat(client/family): MemberCard with portion slider and optimistic update`
   - `client/src/app/components/family/MemberCard.tsx` (~140 linjer)
   - `client/src/app/components/family/MemberCard.test.tsx` (~150 linjer)
4. `feat(client/family): wire up Family screen + i18n keys`
   - `client/src/app/screens/Family.tsx` (~140 linjer, erstatter placeholder)
   - `client/src/app/screens/Family.test.tsx` (~150 linjer)
   - `client/src/app/i18n/locales/no/family.json` (utvidet)
   - `client/src/app/i18n/locales/en/family.json` (utvidet)
5. `docs(design): log family-screen design gap`
   - `design/2026-04-redesign/design-gaps.md` (entry for "Family-skjerm
     finnes som dedikert tab — mockup har list i Settings i stedet")

Hver commit kjører lokal CI tier 1 (lint+format+typecheck) før neste.
Tier 2/3 før push-batch.

## 2.9 Kompleksitet-vurdering

Christer's prompt klassifiserer dette som "stor sprint-fase" (likt
Fase 2A Dashboard som hadde 5 commits + ~600 linjer ny kode).

Min analyse bekrefter dette:
- ~8 nye filer (4 prod + 4 test)
- ~1000 linjer total (inkl. tester)
- Ingen ny backend-kode, ingen migrasjon, ingen nye dependencies
- 12 edge-cases identifisert
- 5 beslutninger (alle bekreftet med Christer eller åpenbare)
- Ingen Portainer-risiko

Analysen er full per CLAUDE.md DEL 11 (ingen snarvei).

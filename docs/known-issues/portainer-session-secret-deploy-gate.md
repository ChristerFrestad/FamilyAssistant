# Portainer deploy-gate: `SESSION_SECRET` crashloops på fresh install

**Status:** ÅPEN — utsatt til antatt uke 4.
**Rapportert:** 2026-04-22, rett etter merge av batch 1 (PR #64).
**Scope:** Infrastruktur / deploy-flyt.
**Risiko:** HØY — pilot-container nede inntil denne er løst.

---

## Symptom

Etter pull av image `ghcr.io/christerfrestad/familyassistant:main`
post-batch-1-merge, crashlooper containeren under oppstart med følgende
i loggen:

```
⚠️  SESSION_SECRET is required in production when Google OAuth,
    magic-link email, or MAGIC_LINK_CONSOLE is enabled.
   Either set SESSION_SECRET in env, or let the bootstrap wizard
   (/setup.html) generate one. Existing installs are self-healed on
   boot — see server/auth/bootstrap-session-secret.js.
```

Container exitter med kode 1. Portainer markerer stacken som
"unhealthy" og starter containeren på nytt i en loop til restart-
policy gir opp.

---

## Rot-årsak

C3-kode-endringen i PR #64 (`feat(auth): aktiver multi-tenant
session-flyt`) skjerpet `server/config.js`-validering slik at
`SESSION_SECRET` er påkrevd i `NODE_ENV=production` når én av disse
er aktiv:

- `GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`
- `MAGIC_LINK_CONSOLE=true`

Samtidig introduserte C1 en **self-heal-modul**
(`server/auth/bootstrap-session-secret.js`) som fyller inn
`sessionSecret` i **eksisterende** `bootstrap.json` hvis feltet
mangler.

Problemet: self-heal forutsetter at `bootstrap.json` **allerede
eksisterer** med et gyldig `authToken`. Den kode-stien dekker
upgrade-installasjoner (pilot-RPi som hadde phase 22-wizard kjørt
tidligere) — men IKKE fresh installs som skal gå gjennom wizarden
for første gang.

Fresh install-sekvensen:

1. Container starter med `BOOTSTRAP_ALLOWED=true`, `AUTH_TOKEN=` (tom)
2. `loadBootstrapFile()` returnerer `null` (ingen fil ennå)
3. `BOOTSTRAP_MODE` aktiveres fordi (a) tom DB + (b) ingen
   bootstrap.json + (c) ingen env-AUTH_TOKEN
4. Validering kjører **før** wizarden har fått lov til å kjøre
5. Hvis operatøren har satt `MAGIC_LINK_CONSOLE=true` i Portainer-
   stack-env (som dokumentert eksempel i docs), treffer C3-gaten
   og kaster pga. manglende SESSION_SECRET

Pilot-spesifikt: Christers deploy har `MAGIC_LINK_CONSOLE=true`
(per `.env.example` og docker-compose.yml) som **ville vært trygt**
før C3 men nå krever SESSION_SECRET.

### Hvorfor self-heal ikke redder fresh install

`ensureSessionSecretInBootstrapFile()` leser fra disk. Returnerer
`{ generated: false, secret: null }` hvis filen ikke eksisterer.
Intet å heal'e — det er ikke noe hull å fylle. Filen opprettes
først når wizarden fullfører, men wizarden kommer aldri i gang
fordi `config.js`-validering kaster før HTTP-server starter.

---

## Hvorfor vi IKKE løser dette med manuell workaround

Christer kunne umiddelbart satt `SESSION_SECRET` i Portainer-stack-
env som en env-variabel. Det ville løst containeren, men:

1. **Det er ikke en representativ deploy-flyt for eksterne familier.**
   De 4 neste pilot-familiene skal få installere appen selv. Hvis
   vi bypasser dette steget manuelt nå, går vi glipp av å teste
   at fresh-install-flyten faktisk virker end-to-end.
2. **Det er en midlertidig-i-navnet-evig workaround.** Én
   env-variabel som "bare må være der" blir lett glemt ved neste
   deploy eller neste operatør.
3. **Det skjuler symptomet, ikke årsaken.** Problemet ligger i
   sekvensen config-validering → bootstrap-wizard. Fiksen må
   adressere den sekvensen.

Derfor: **containeren er nede inntil vi løser dette ordentlig.**
Pilot-flyten tester seg selv ved å være realistisk.

---

## Midlertidig arbeidsflyt

Mens fixen venter:

- **Test-miljø:** lokal Node-kjøring (`npm start` med `NODE_ENV=
  development` og evt. `MAGIC_LINK_CONSOLE=true`). SESSION_SECRET
  auto-genereres i dev-mode (se `server/config.js:299-303`).
- **CI:** full lokal pyramide per CLAUDE.md DEL 5.2.2 + GitHub
  Actions som før.
- **Empirisk verifikasjon** (f.eks. B1 end-to-end tenant-
  isolation-test, B2 cross-family LLM-flyt) **utsettes** til
  containeren er oppe igjen. B5 datamodell + repo-tester kan
  kjøres lokalt.

---

## Når løses

Antatt uke 4 per B4-tidslinjen (Cloudflare Tunnel uke 4-5 →
eksterne familier kan invites → fresh-install-flyten må virke).

Den første familien som inviteres er også den første ordentlige
fresh-install-testen.

---

## Mitigations-alternativer (ikke valgt ennå)

### (a) Utvid self-heal til å opprette `bootstrap.json` hvis den ikke finnes

Endre `ensureSessionSecretInBootstrapFile()` til å returnere
et tomt objekt med gen-erert `sessionSecret` hvis filen mangler,
uten å skrive til disk. Da har `config.js` en valid verdi i env
mens `BOOTSTRAP_MODE` tar over og wizarden kjører normalt.
Wizarden's `handleComplete()` (som allerede genererer
`sessionSecret` via `generateSessionSecret()` i C1) skriver
endelig fil ved setup-fullførelse.

**Fordel:** Minimal kode-endring. Fresh-install-flyt fungerer
uten manuell env-config.

**Ulempe:** Midlertidig (pre-wizard) SESSION_SECRET er i
minne i runtime, men ikke skrevet ned. Hvis wizarden ikke
fullføres og containeren restarter, genereres nytt — alle
eventuelle pågående OAuth-state-cookies blir ugyldige.
Akseptabelt for fresh-install som skal fullføre wizarden
i én sitting.

### (b) Første-boot-wizard genererer alt før `config.js` validerer

Restrukturer oppstart-flyten slik at `BOOTSTRAP_MODE` sjekkes
FØR strengt-validering-gaten. Hvis bootstrap-mode er aktiv,
skippes production-kravene om SESSION_SECRET (og andre) fordi
wizarden vil populate dem før neste restart.

**Fordel:** Sømløs setup — operatøren ser aldri oppstart-feil
før han har fullført wizarden.

**Ulempe:** Litt mer invasiv endring i `config.js`-flyten.
Krever også at wizard-output skriver SESSION_SECRET, som
allerede er gjort i PR #64 `handleComplete`.

### (c) Dokumentere manuelt SESSION_SECRET-steg i installasjons-guide

Ingen kode-endring. DEPLOY.md forklarer at fresh install må sette
SESSION_SECRET i Portainer-stack-env før første start, ELLER
kjøre en dedikert "generate-secrets"-container først.

**Fordel:** Null kode-risiko.

**Ulempe:** Motsier "zero-config Docker deploy"-intensjonen i
phase 22. Ekstra manuelt steg for hver ny familie. Lett å
glemme.

---

## Foreløpig anbefaling

Når vi kommer tilbake til dette: **(b) er riktig arkitektonisk**,
men **(a) er raskeste vei til en fungerende fresh-install uten
å omstrukturere oppstart-flyten**. Kombinasjon: (a) som første
fix for å få containeren opp, (b) som del av en større refactor
hvis vi skalerer til flere tenants med egne deploys.

Endelig beslutning tas når fixen skrives — antatt i rammen av
uke 4 B4-arbeid.

---

## Referanser

- PR #64 (batch 1) — der C3 skjerpet validering og C1 la til
  self-heal. Merged som `d238bf2`.
- `server/config.js:279-310` — skjerpet produksjons-gate for
  HMAC-signerende features.
- `server/auth/bootstrap-session-secret.js` — self-heal-modul.
- `server/http/bootstrap.js:handleComplete` — wizard v2 som
  genererer SESSION_SECRET på fresh install.
- `docs/runbooks/b1-deploy-checklist.md` — deploy-sjekkliste
  som også må oppdateres når fixen lander.

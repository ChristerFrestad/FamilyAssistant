# B1 Deploy-sjekkliste: multi-tenant aktivering på Portainer/RPi

**Gjelder:** første pull etter at batch 1 (med commits `aff7a83`, `508c204`,
`586ddc9`) er merget til main. Må ikke hoppes over — Portainer-risiko var
vurdert HØY i analysen.

**Forutsetning:** du har tilgang til Portainer UI og til container-loggen.

**Utfør i rekkefølge.** Hvert steg har forventet resultat og rollback-
kriterium. Stopp og rapporter hvis noe avviker.

---

## Fase 1 — Før pull

Disse stegene kjøres på nåværende (pre-B1) container mens den fortsatt
er oppe.

### 1.1 Sikkerhetskopier `bootstrap.json`

```bash
# Via Portainer Console (app-containeren):
cp /app/data/bootstrap.json /app/data/bootstrap.json.pre-b1.bak
ls -la /app/data/bootstrap.json*
```

Forventet: to filer med identisk innhold, `bootstrap.json.pre-b1.bak` med
mtime lik original.

**Hvorfor:** Self-healing i C1 skriver om `bootstrap.json` ved første boot.
Hvis migreringen feiler må vi kunne gjenopprette den opprinnelige filen.

### 1.2 Noter nåværende schema-versjon

```bash
cat /app/data/bootstrap.json | grep version
```

Forventet (pilot-installasjonen): `"version": 1` (eldre wizard-output).
Hvis du ser `"version": 2` er dette en fresh install med C1 allerede
aktiv — ingen migrering trengs.

Hvis ingen `version`-nøkkel finnes: filen er fra aller første Phase 22-
wizard (før `version` ble lagt til). C1s self-heal håndterer dette
likt med versjon 1 — merger inn `sessionSecret` og bumper til `version: 2`.

### 1.3 Takt-sjekk: tester og eksisterende funksjon

```bash
curl -sH "Authorization: Bearer $AUTH_TOKEN" http://localhost:7777/api/auth/me | head
curl -sH "Authorization: Bearer $AUTH_TOKEN" http://localhost:7777/api/pantry | head
```

Forventet: begge returnerer 200 + gyldig JSON. Dette bekrefter at
"pre-B1"-state er funksjonell, så enhver regresjon vi oppdager etter
pull kan entydig tilskrives B1.

---

## Fase 2 — Pull + restart

### 2.1 Pull ny image i Portainer

Stack → Editor → "Pull and redeploy" (eller `docker compose pull && docker
compose up -d` fra host). Vent ~30-60 sekunder på at den gamle containeren
stenges og den nye starter.

### 2.2 Følg oppstart-loggen

```bash
docker logs -f familieassistenten 2>&1 | head -100
```

Se etter følgende linjer **i rekkefølge** (timestamps vil variere):

```
[DB YYYY-MM-DD HH:MM:SS] better-sqlite3 tilkoblet (WAL, FK=ON)
[MIGRATE YYYY-MM-DD HH:MM:SS] ✓ Applikert 018_reset_stale_bought_at.sql
  ...ingen NYE migrations (019+) i B1. Ren config-endring.
Starter Familieassistenten...
Familieassistenten kjører på http://localhost:7777
```

**Kritisk sjekk for B1:** ingen stack-trace, ingen `process.exit(1)`,
ingen linjer som starter med `⚠️`.

### 2.3 Bekreft at SESSION_SECRET er generert og persistert

```bash
cat /app/data/bootstrap.json
```

**Forventet resultat A — upgrade fra versjon 1:**

```json
{
  "completedAt": "2026-XX-XX...",
  "authToken": "<din uendrede token>",
  "allowedOrigins": "<uendret>",
  "llmBackend": "ollama",
  ...
  "sessionSecret": "<64 hex-chars — ny linje lagt til>",
  "sessionSecretGeneratedAt": "<timestamp fra akkurat nå>",
  "version": 1
}
```

MERK: `version` forblir 1 ved self-heal-sti (C1 bumper KUN ved
wizard-komplett; self-heal kun merger. Dette er med vilje — for å skille
self-healed fra wizard-fresh installasjoner i debug.)

**Forventet resultat B — fresh install som var i BOOTSTRAP_MODE:**

Hvis du deployet denne imagen fra scratch (uten pre-existing bootstrap.json
på dataobjekt), trenger du først kjøre setup-wizarden på `/setup.html`.
Etter fullført wizard:

```json
{
  "completedAt": "<timestamp fra wizard>",
  "authToken": "<generert av wizard>",
  "sessionSecret": "<64 hex>",
  "sessionSecretGeneratedAt": "<samme timestamp>",
  "version": 2,
  ...
}
```

`version: 2` bekrefter at wizarden kjørte C1-oppdaterte handleComplete.

### 2.4 Verifiser at auth fortsatt virker

```bash
# Fra host eller LAN — bør fortsatt gi 200 + samme bruker som før
curl -sH "Authorization: Bearer $AUTH_TOKEN" http://<rpi-ip>:7777/api/auth/me
```

Forventet: `{"authenticated":true,"user":{"id":0,...,"synthetic":true}}` —
den syntetiske LOCAL_USER-en for pilot-familien.

---

## Fase 3 — Logg-linjer som flagger problem

### 3.1 Self-heal FEILET (sjelden, men mulig)

Hvis `bootstrap.json` er read-only eller volum er fullt:

```
⚠️  SESSION_SECRET self-heal failed (EACCES: permission denied, ...).
   Set SESSION_SECRET in env or fix file permissions on bootstrap.json.
```

**Hva det betyr:** Serveren starter fortsatt, MEN auth-endepunkter som
trenger HMAC-signering (Google OAuth, magic-link) vil kaste ved første
bruk (ingen `dev-secret`-fallback i C3).

**Handling:**
1. Sjekk filrettigheter: `ls -la /app/data/bootstrap.json` — skal være
   0600 og eid av samme UID som containeren kjører som.
2. Sjekk ledig diskplass: `df -h /app/data` — skal ha >10 MB.
3. Reparer: sett `SESSION_SECRET` manuelt som env-variabel i Portainer-
   stack (`openssl rand -hex 32`), restart stack.
4. Etter neste boot — bootstrap.json blir eventuelt oppdatert ved
   suksessfull self-heal, eller du kan manuelt legge inn `sessionSecret`
   i filen med `jq` (se RUNBOOK §12.1).

### 3.2 Config-validering avslår oppstart

Hvis `NODE_ENV=production` og én av `GOOGLE_CLIENT_ID` / `RESEND_API_KEY`
/ `MAGIC_LINK_CONSOLE` er aktivert UTEN at `SESSION_SECRET` finnes:

```
⚠️  SESSION_SECRET is required in production when Google OAuth, magic-link
    email, or MAGIC_LINK_CONSOLE is enabled.
   Either set SESSION_SECRET in env, or let the bootstrap wizard
   (/setup.html) generate one. Existing installs are self-healed on boot
   — see server/auth/bootstrap-session-secret.js.
```

Container exiter med kode 1 og Portainer viser "unhealthy".

**Handling:**
1. Dette skjer KUN hvis self-heal også feilet i samme boot. Sjekk forrige
   feilmelding i logg (3.1).
2. Akutt-fix: sett `SESSION_SECRET` i Portainer stack env, restart.
3. Langvarig fix: følg 3.1 for å få self-heal til å virke.

### 3.3 OAuth state-cookie-feil

Hvis en innlogging mislykkes med:

```
Error: SESSION_SECRET is not configured. Refusing to sign OAuth state /
       magic-link tokens with a placeholder.
```

Dette er C3-hardening som kaster hvis kode-stien når signing-helper uten
verdi. Skulle IKKE skje i normal drift hvis 2.3 gikk grønt — bekreft at
`SESSION_SECRET` er populert, kanskje env-var ble overstyrt til tom.

---

## Fase 4 — Rollback hvis container ikke starter

Hvis container er rød i Portainer > 60 sekunder etter pull:

### 4.1 Første redning: env-override

Sett i Portainer stack env og redeploy:

```
SESSION_SECRET=<generer med openssl rand -hex 32>
```

Hvis dette fikser det: årsaken var self-heal-feil. Rapporter loggutsnitt
fra 3.1.

### 4.2 Andre redning: rull tilbake image

Hvis env-override ikke hjelper:

```bash
# Finn forrige image-SHA fra `docker images ghcr.io/christerfrestad/familyassistant`
docker tag ghcr.io/christerfrestad/familyassistant:<forrige-sha> \
           ghcr.io/christerfrestad/familyassistant:main
# Deretter Portainer → restart stack (NB: pull_policy: always vil
# overskrive tag-en ved neste redeploy, så dette er kun midlertidig)
```

Mer robust: bruk `TAG=<forrige-sha>` env i docker-compose.yml:

```
environment:
  TAG: "sha-abc1234"  # override :main
```

### 4.3 Tredje redning: gjenopprett pre-B1 bootstrap.json

Hvis containeren fortsatt ikke starter og du har forrige image aktiv
men bootstrap.json er korrupt:

```bash
docker exec familieassistenten sh -c "cp /app/data/bootstrap.json.pre-b1.bak /app/data/bootstrap.json"
docker compose restart app
```

### 4.4 Full rollback (siste utvei)

Hvis data-volum er korrupt:

1. Stopp containeren.
2. Restaurer `/app/data/` fra siste automatiske backup (se RUNBOOK §2.3).
3. Tag-pinn til kjent god image før neste forsøk.
4. Rapporter til Claude: logg + steg du kjørte + hva som faktisk feilet.

---

## Fase 5 — Smoke-test av B1-funksjonalitet

Etter at containeren er grønn:

### 5.1 Multi-tenant skal NÅ være aktiv

```bash
# Hent /api/auth/config — viser hvilke auth-backends som er tilgjengelig
curl -sH "Authorization: Bearer $AUTH_TOKEN" http://<rpi>:7777/api/auth/config
```

Forventet respons-shape:
```json
{
  "pilotBypass": false,
  "google": false,
  "magicLink": false   # eller true hvis MAGIC_LINK_CONSOLE=true
}
```

### 5.2 Hvis du vil kjøre empirisk tenant-isolation-test

Følg prosedyren i **RUNBOOK §12.6** eller kjør
`scripts/e2e-tenant-isolation.js` fra repo-roten lokalt mot RPi-
URL (krever at MAGIC_LINK_CONSOLE er aktivert midlertidig).

### 5.3 Hvis feilet testen

Se RUNBOOK §12.3 for debug-steg.

---

## Referanser

- `docs/analyses/2026-04-20-multi-tenant-activation.md` — B1-analysen
- `RUNBOOK.md` §12 — løpende multi-tenant-drift (etter deploy)
- `server/auth/bootstrap-session-secret.js` — self-heal-modulen
- `server/config.js` (linjer ~160-200, ~300-330) — validering og bootstrap-load
- `server/http/bootstrap.js` `handleComplete` — wizard v2 som genererer
  sessionSecret på fresh install

Denne sjekklisten oppdateres hvis Christer finner at et steg mangler
etter faktisk Portainer-deploy.

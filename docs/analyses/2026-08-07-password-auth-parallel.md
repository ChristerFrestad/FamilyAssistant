# ANALYSE: Passord-registrering + progressiv e-postverifisering

**Dato:** 2026-08-07  
**Branch:** `feat/password-auth-progressive-verify`  
**Type:** Feature (auth, full-stack)  
**Freeze:** DEL 6.1b soft-thaw — krever operatørgodkjenning før merge

## Produktmål

1. **Lav barrier to entry** — registrer med brukernavn + passord, bruk appen med en gang.
2. **E-post er valgfritt i starten** — ingen magic link påkrevd for første opplevelse.
3. **Progressiv verifisering** — innen en konfigurerbar frist (default **60 dager**) må e-post verifiseres via magic link.
4. **Operatør kan skru fristen** — f.eks. `86400` (24 t) eller `3600` (1 t) for pilot/test.
5. **Etter frist uten verifisering** — neste innlogging krever e-postverifisering **og** nytt passord (reset).
6. **Magic link beholdes** som innlogging *og* som verifiseringskanal.

## Reisen

### A. Første gangs bruk (innen grace)

1. Welcome → Login → «Opprett konto»
1.1. Brukernavn + passord (+ valgfritt navn, valgfri e-post)
1.2. POST `/api/auth/password/register`
1.3. Session-cookie settes umiddelbart
1.4. Onboarding (familie + profil) som i dag
2. Bruker utforsker appen uten e-post/verifisering
2.1. `/api/auth/me` returnerer `emailVerified: false`, `verificationDueAt`, `withinGrace: true`
2.2. Soft banner (valgfritt UI): «Verifiser e-post innen {dato}»

### B. Frivillig verifisering i grace

1. Bruker legger inn/bekrefter e-post
1.1. POST `/api/auth/password/start-verification` (med session ELLER username+password)
1.2. Magic link sendes med `purpose=email_verify`
1.3. Klikk → `email_verified_at=now`, session, dashboard (ingen tvungen passord-reset)

### C. Grace utløpt — hard gate ved neste login

1. POST `/api/auth/password/login` med gyldig passord
1.1. Credentials OK, men `!email_verified && past_grace`
1.2. **Ingen session** — 403 `{ code: 'email_verification_required', mustResetPassword: true, hasRealEmail }`
2. UI: «Perioden er over. Oppgi e-post og verifiser for å fortsette. Du må også sette nytt passord.»
2.1. POST `/api/auth/password/start-verification` med username + password + email
2.2. Magic link `purpose=email_verify_reset`
3. Klikk link:
3.1. Sett `email_verified_at`, `password_reset_required=1`
3.2. Session + redirect `/v2/set-password`
4. POST `/api/auth/password/set` → nytt hash, clear flag, full tilgang

### D. Magic-link-login (eksisterende)

Uendret for rene e-post-brukere. Ny bruker via magic link får `email_verified_at=now` (e-post bevist).

## Schema (migrasjon 031)

```sql
-- users
username TEXT UNIQUE COLLATE NOCASE
password_hash TEXT
email_verified_at TEXT          -- null = ikke verifisert
password_reset_required INTEGER NOT NULL DEFAULT 0

-- magic_link_tokens
purpose TEXT NOT NULL DEFAULT 'login'   -- login | email_verify | email_verify_reset
user_id INTEGER REFERENCES users(id)
```

Syntetisk e-post for konto uten ekte e-post: `local+{username}@password.local`  
(bevarer `email NOT NULL UNIQUE`).

## Config

| Env | Default | Betydning |
|-----|---------|-----------|
| `PASSWORD_AUTH_ENABLED` | `true` | Skru av hele passord-flyten |
| `PASSWORD_AUTH_OPEN_REGISTER` | `true` | Åpen self-register |
| `EMAIL_VERIFICATION_GRACE_SECONDS` | `5184000` (60 d) | Grace fra `users.created_at` |

Fristen er **env-drevet** (ikke lagret per bruker): operatør kan endre til 24t/1t uten migrasjon. Eksisterende uverifiserte brukere treffes umiddelbart av ny frist.

## Sikkerhet

- scrypt (Node crypto, ingen ny dep)
- Generisk 401 ved feil brukernavn/passord
- Strict rate limit på register/login/start-verification
- Verifiserings-start krever gyldig passord (bevis på konto)
- Dummy-scrypt ved ukjent bruker (timing)

## Filer

- `server/migrations/031_password_auth.sql`
- `server/auth/password.js` (ny)
- `server/auth/password-hash.js` (ny)
- `server/auth/magic-link.js` (purpose)
- `server/auth/routes.js`, `middleware.js`
- `server/http/security.js`, `server/config.js`
- `server/repositories/auth.repo.js`
- Frontend: Login, SetPassword, authApi, AuthContext, i18n
- `tests/auth-password.test.js`

## Godkjenning

Implementasjon på feature-branch. Merge krever operatør (DEL 6.1b).

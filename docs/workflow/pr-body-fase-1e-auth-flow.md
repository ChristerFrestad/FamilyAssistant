## Sammendrag

Sprint 3 / Fase 1e — komplett magic-link-auth-flyt fra registrering til innlogget bruker. Backend-magic-link-infrastrukturen var allerede ~85% bygget (oppdaget under inventering); denne PR-en hardener tokens (SHA-256 ved-rest) og legger på onboarding-flag, og bygger frontend-AuthContext + 6 skjermer som tar pilot-brukeren fra `/welcome` til `/dashboard`.

## Antall nye endepunkter

| Endepunkt | Status | Endring |
|-----------|--------|---------|
| `POST /api/auth/magic-link/start` | Eksisterte | Tokens hashes nå før lagring (migration 022) |
| `GET /api/auth/magic-link/verify` | Eksisterte | Hash-lookup; redirect-target: `/v2/dashboard` eller `/v2/onboarding/family` basert på `users.onboarding_completed` |
| `GET /api/auth/me` | Eksisterte | Payload utvidet med `onboardingCompleted` |
| **`POST /api/auth/onboarding/complete`** | **Ny** | Flipper flagget for innlogget bruker, idempotent |
| `POST /api/auth/logout` | Eksisterte | Match |
| `GET /api/auth/google/callback` | Eksisterte | Onboarding-aware redirect (samme som magic-link) |

## Antall nye skjermer (6)

Per "kun voksne logger inn"-beslutning droppet vi `FamilyMembers`-skjermen — barn og andre voksne legges til i Sprint 4 (Family-skjermen).

| Skjerm | Plassering | Funksjon |
|--------|-----------|----------|
| **Welcome** | `screens/auth/Welcome.tsx` | Landing, to CTAs til /login |
| **Login** | `screens/auth/Login.tsx` | Magic-link entry, email-validering, 429 rate-limit-hint |
| **MagicLinkSent** | `screens/auth/MagicLinkSent.tsx` | "Sjekk e-posten din", henter email fra route state |
| **AuthCallback** | `screens/auth/AuthCallback.tsx` | Håndterer ?error=expired/used/invalid med oversatte meldinger |
| **FamilySetup** | `screens/auth/FamilySetup.tsx` | Onboarding 1/2 — familie-navn |
| **UserProfile** | `screens/auth/UserProfile.tsx` | Onboarding 2/2 — navn, rolle, portion-factor |

(Login-placeholder fra Fase 1d slettet og erstattet.)

## Antall tester (totalt)

| Lag | Før | Etter |
|-----|----:|------:|
| **Backend** (`npm run test`) | 1266 | **1271** (+5) |
| **Klient** (`npm run test:client`) | 257 | **285** (+28) |

### Nye backend-tester
- 2 nye magic-link-tester (redirect-target-for-onboarded-user, plain-token-never-persisted)
- 3 nye onboarding-complete-tester (401-uten-session, happy path, idempotent)
- 11 eksisterende magic-link-tester oppdatert til hash-pattern uten å endre adferd

### Nye frontend-tester
- **AuthContext.test.tsx** (8 tester) — initial /me round-trip, initialState-skip, logout state-clear, requestMagicLink-API-call
- **OnboardingGuard.test.tsx** (4 tester) — loading/redirect/render/null-defensive
- **auth-screens.test.tsx** (16 tester) — render + key-interaction + submit-flow for alle 6 skjermer
- Eksisterende UserMenu/AppShell/screens-tester wrappet med AuthProvider initialState-fixtures

## Sikkerhets-beslutning landet

**Token-hash:** SHA-256-hash ved-rest per Christer's beslutning. Migration 022:
- `magic_link_tokens.token` → `token_hash`
- Plain tokens lever kun i e-post-URL-en. DB-leak kan ikke replay live magic-links.
- Eksisterende ufullkomne in-flight tokens slettes ved migration (15-min TTL — verste utfall: bruker ber om ny link).

**User-scoping:** kun voksne logger inn for pilot. UserProfile-skjermen viser likevel rolle-velger (adult/teen/child) — backend-schema støtter alle tre, og fremtidig pilot-iterasjon kan tin "teen logger inn"-flyten via samme felt uten kode-endring.

## Manuell test — Christer kan bekrefte etter PR-merge

```bash
# 1. Backend (Portainer/RPi5 eller lokal)
npm start
# 2. Frontend (separat terminal)
npm run dev:client
# 3. Naviger til http://localhost:7778/v2/welcome
# 4. Klikk "Kom i gang" → /login
# 5. Skriv inn email
# 6. Klikk "Send innloggings-link"
# 7. Sjekk backend-konsollen for "MAGIC LINK"-blokken (MAGIC_LINK_CONSOLE=true)
#    — ELLER bruk verifisert Resend-konto (RESEND_API_KEY)
# 8. Kopier URL-en og lim inn i nettleser
# 9. Verifiser: redirect til /v2/onboarding/family
# 10. Sett familie-navn → Opprett familien
# 11. Sett navn, rolle, portion-factor → Fullfør
# 12. Verifiser: redirect til /v2/dashboard
# 13. Klikk avatar → "Logg ut" → verifiser redirect til /login
# 14. Logg inn samme bruker igjen → verifiser direkte til /v2/dashboard (skipper onboarding)
```

## Lokal CI

- [x] `npm run lint` — clean
- [x] `npm run typecheck` — clean
- [x] `npm run typecheck:client` — clean
- [x] `npm run test` (server) — **1271/1273**, 2 skipped uendret
- [x] `npm run test:client` — **285/285**
- [x] `npm run audit:prod` — 0 vulnerabilities
- [x] `npm run build:client` — clean

**Bundle-impact:** 253.28 → 275.99 kB JS (+22.71 kB) / 81.67 → 87.60 kB gzipped (+5.93 kB). Kostnad av AuthContext + 6 skjermer + react-router useSearchParams/useNavigate-konsumenter.

## Coverage-økning

Backend-coverage stiger marginalt fra 83.69% → ~84% (5 nye tester ramme allerede-dekkede paths + onboarding-complete-endepunkt 100% dekket). Klient: nye filer er 100%-dekket; eksisterende tester oppdatert uten dekning-tap.

## Arkitektur-noter

**EmailSender-pattern:** eksisterende `server/services/email.service.js` har allerede ConsoleSender (via `MAGIC_LINK_CONSOLE=true`) og Resend-implementasjon (gjennom Resend HTTP API), og bruker `config.APP_NAME` for white-label (Sprint 2.5). Direktivets OPPGAVE 5.6 ("EmailSender-pattern") var derfor allerede oppfylt; ingen kode-endring nødvendig.

**3-tier routing (App.tsx):**
1. PUBLIC: /welcome, /login, /login/sent, /auth/callback (ingen guard)
2. ONBOARDING: /onboarding/family, /onboarding/profile (AuthGuard kun)
3. PROTECTED: /dashboard, /family, ..., /settings (AuthGuard + OnboardingGuard + AppShell)

**AuthProvider-plassering:** wrapper hele App inni BrowserRouter i `main.tsx`. Initial /me-roundtrip skjer ved mount; AuthGuard viser loading-state inntil response kommer (forhindrer flash-of-redirect-to-login når cookie er gyldig).

## Tilleggs-arbeid: pending-decisions

Lagt til entry "Backup-arkitektur skal være utvidbar for fremtidig ekstern backup" notert til Sprint 8 (Prompt 17). BackupTarget-pattern (interface med upload/list/delete) etableres når Sprint 8 implementerer `LocalBackupTarget`, slik at fremtidige `S3BackupTarget`/`B2BackupTarget` kan legges til som drop-in via env-vars.

## Etter merge

Klar for **Prompt 6 (Fase 2A — Dashboard)**. AuthContext, AuthGuard, OnboardingGuard, og 6 placeholder-skjermer er klare for at Fase 2 skal bygge faktisk innhold.

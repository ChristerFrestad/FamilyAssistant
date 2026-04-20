# Redesign Exploration (April 2026)

Eksplorativ UI-mockup fra claude.ai/design. Ikke for implementering
ennå – referanse for fremtidig frontend-redesign.

## Status

**PARKERT.** Dette er en design-utforskning, ikke et aktivt
implementerings-mål.

## Hva dette er

Mockup generert via claude.ai/design med React + Tailwind +
OKLCH-farger. Inneholder visuelle konsepter for:

- Dashboard (i dag-view)
- Ukesmeny
- Handletur + Pantry (kombinert)
- Gjøremål med gamification
- Kalender med person-filter og event-types
- Innstillinger med familiemedlems-administrasjon
- Onboarding-wizard

## Hvorfor det er parkert

Implementering krever grundige beslutninger som ikke er tatt ennå:

1. Frontend-stack: React/Tailwind vs dagens vanilla HTML/CSS/JS
2. Multi-tenant aktivering (backend må først støtte per-bruker
   profiler, roller, gamification)
3. Gamification-backend (XP, streaks, leaderboard, week goals)
4. Kalender-integrasjon (Google Calendar API, toveis synk)
5. Nye datamodell-felter (kcal på recipes, level på pantry,
   price/recipe på shopping-items, etc.)

Full gap-analyse mellom mockup og dagens backend dokumenteres i
prosjektets samtale-historikk.

## Plan for implementering

Uke 1-7 (april-juni 2026): Bygge backend-delene mockup-en
forutsetter. Frontend forblir dagens vanilla.

Uke 8+ (senere): Ta beslutning om frontend-stack og starte
implementering av mockup-en som ny UI.

## Filer

- `project/Familieassistenten.html` – hoved-mockup (React + Tailwind,
  2845 linjer)
- `project/uploads/` – skjermbilder og hjelpe-filer
- `README.original.md` – original README fra claude.ai/design bundle

## IKKE GJØR FØLGENDE

- Ikke implementer disse komponentene i nåværende frontend
- Ikke ekstraher CSS/farger fra mockup-en uten eksplisitt bestilling
- Ikke behandle dette som aktivt arbeidsomfang

Når fasen for frontend-redesign starter, vil denne README-en
oppdateres med konkret implementeringsplan.

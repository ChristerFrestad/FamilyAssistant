# ANALYSE: G0-5 Isolation attacker (swapped family ids)

**Dato:** 2026-08-14
**Branch:** `feat/g0-integrate`
**Type:** Security test (adversarial isolation)
**Freeze:** Ingen endring i `server/auth/` oppførsel. Testdekning utvider G0-1/G0-2.

## Produktmål

En innlogget bruker i familie A skal aldri kunne lese eller mutere
familie B sine data ved å:

1. bytte `family_id` i JSON-body
2. sende `family_id` / `familyId` i query
3. bruke B sine numeriske id-er i A's GET/PUT/DELETE
4. re-spille A's cookie mot B-ressurser
5. treffe en delt response-cache etter at A har varmet den
6. la et barn i A opprette kalenderhendelse eller oppgave
7. sende B sin family_id i header uten cookie (CSRF-ish)

Forventet: 401 / 403 / 404 / tomt — aldri 200 med fremmed data.

## 2.1 Reisen

### A. Oppsett (to ekte familier)

1. Register + onboarding via passord (samme sti som G0-1)
1.1. POST `/api/auth/password/register` for Alice
1.2. POST `/api/auth/onboarding/complete` → familie A
1.3. POST register + onboarding for Bjorn → familie B
2. Unike markører plantes i hver familie
2.1. Familie-unik oppskrift via `recipes.insert` (ingen public create)
2.2. PUT `/api/meals/swap` setter dagens/mandags-slot
2.3. POST `/api/calendar/events` (fremtid + i dag)
2.4. POST `/api/shopping/generate` + `/api/shopping/items`
2.5. POST `/api/pantry/add` med unik nøkkel
3. Barn i familie A
3.1. `auth.createUser` + `setFamily(..., 'child')` + session-cookie

### B. Angrep (hver probe er en egen test)

1. Body-swap
1.1. A POST kalender med `family_id: B` i body
1.2. A POST handleliste-item med `family_id: B` (schema `.strict()`)
1.3. A PUT `/api/meals/swap` med `family_id: B`
1.3.1. B sitt måltidsplan må være uendret
1.3.2. Responsen må ikke inneholde B sin unike oppskriftsstreng
2. Query-swap på listede GET-er
2.1. `?family_id=B` og `?familyId=B` på recipes, meals/current,
     calendar/events, pantry, me/export, family/export, today
2.2. 200 med A's egne data er OK; B-markører er aldri OK
3. IDOR via B sine numeriske id-er
3.1. GET `/api/recipes/:bRecipeId` som A
3.2. GET `/api/recipes/:bRecipeId/similar` som A etter at B har varmet cache
3.3. DELETE `/api/calendar/events/:bEventId` som A
3.4. GET/DELETE shopping list/item id som A
3.5. PUT `/api/chores/complete` med B sin choreId
3.6. POST `/api/meals/:bMealId/mark-eaten` som A
4. Cookie-replay: A's `fa_session` mot alle B-id-er over
5. Cache-probe: A GET `/api/today` deretter B GET `/api/today` samme query
6. Barn i A: POST calendar (403) og POST chore (404/405 er OK)
7. Uten cookie + `X-Family-Id` / `family_id` header → 401, aldri B-data

## 2.2 Domenemodell-påvirkning

Ingen ny entitet. Testdekning av eksisterende isolasjonsgaranti:

- `server/auth/family-context.js` — `getFamilyId()` fra ALS, ikke body/query
- `server/http/server.js` — `runWithFamily(ctx.familyId)` fra session
- `server/http/cache.js` — nøkkel `f{familyId}:{path}?{qs}` (G0-3)
- `server/schemas.js` — ingen schema har `family_id` / `familyId`
- `server/services/recipe-similarity.service.js` — prosess-cache på recipe id

## 2.3 Edge cases

1. Tom query vs `family_id=` vs `family_id=B` vs `familyId=B`
2. Extra JSON-felt `family_id` på Zod-default (strip) vs `.strict()` (400)
3. Numerisk id-kollisjon: aldri assert på rene tall i JSON-haystack
4. Cache HIT etter A, deretter B samme path+query
5. Similarity-cache varmet av B, deretter A GET same recipe id
6. Child cookie mot POST som krever adult
7. Ingen cookie + AUTH_TOKEN satt (må 401, ikke LOCAL_USER)
8. DELETE som 200-no-op: B-raden må fortsatt finnes
9. GET by id som 200 med tom `{ similar: [] }` er OK; 200 med B-navn er leak
10. Concurrent A/B GET today (samme prosess, delt `responseCache`)

## 2.4 Tverrgående konsekvenser

- Ny fil: `tests/g0-5-isolation-attacker.test.js`
- Ingen OpenAPI-endring
- Ingen migrasjon
- DOMAIN_MODEL.md: nei (ingen ny regel; BR er «session family wins»)
- Mulig en-linjes cache-fiks i recipe-similarity hvis probe 3.2 leaker

## 2.5 Beslutninger

```
DECISION: Finnes det endepunkter som leser family_id fra body/query/header?
RECOMMENDATION: Nei — session + ALS er eneste kilde. Tester skal likevel sende feltet.
WHY: Kodegjennomgang av schemas.js, routes.js, family-routes.js og middleware
viser ingen binding av family_id fra klienten. getFamilyId() kommer fra cookie.
ALTERNATIVES:
- Innføre eksplisitt reject av family_id i body: støy, Zod stripper allerede.
- RLS i SQLite: ikke tilgjengelig.
CONSEQUENCE IF DIFFERENT: Hvis et endepunkt senere tar family_id, feiler G0-5.
```

```
DECISION: Similarity-cache uten family i nøkkelen
RECOMMENDATION: Utført. getById kjører før cache; nøkkel er
`${getFamilyId()}:${id}`.
WHY: Probe 3b feilet rødt: etter at B varmet cachen returnerte
GET /api/recipes/:bId/similar 200 til A med B-only-Raspeball.
ALTERNATIVES:
- Fjerne cachen: tregere, unødvendig.
- La testen feile uten fiks: BLOCKER per oppdraget.
CONSEQUENCE IF DIFFERENT: A leser B sine lignende-oppskrifter etter B-GET.
```

## Funnet leak (fikset på branchen)

`server/services/recipe-similarity.service.js` cachet på recipe-id alene
og slå opp cachen *før* `recipes.getById`. B GET similar varmet cachen;
A GET samme id fikk 200 med B sine oppskriftsnavn.

Fiks: authorize via family-scoped `getById` først; cache-nøkkel inkluderer
`getFamilyId()`. Ikke Portainer-risiko.

Residual (ikke innhold-lekkasje): `PUT /api/meals/swap` sjekker ikke at
`recipeId` tilhører familien. A kan skrive B sin numeriske recipe-id inn
i A sin plan; `getById` returnerer null så navnet lekker ikke. G1-sak.

```
DECISION: Dual-family via passord-register, ikke createUser
RECOMMENDATION: Samme sti som G0-1 e2e-two-families-password.
WHY: Angriperen skal speile den ekte onboardingen, ikke bare repo-insert.
ALTERNATIVES:
- createUser+cookie: raskere, dekker ikke register/onboarding-kontrakt.
CONSEQUENCE IF DIFFERENT: Tester blir kortere men svakere mot auth-regresjon.
```

## 2.6 Portainer startup-risk

| Flate | Berørt? |
|---|---|
| Dockerfile / .dockerignore | nei |
| docker-compose.yml | nei |
| server/http/bootstrap.js | nei |
| server/config.js startup | nei |
| server/index.js | nei |
| server/db.js / migrations | nei |
| install.sh | nei |
| bootstrap.json | nei |
| Nye env-krav | nei |

Portainer-risiko: **nei**.

## 2.7 ISO 25010

- Security: bevis + eventuell similarity-cache-fiks. Ingen ny eksponering.
- Functional suitability: ikke affected
- Maintainability: + testdekning for IDOR/cache
- Ingen karakteristikk ≥ 8.0 trekkes under 8.0

## 2.8 Plan

1. `docs(analysis): add analysis for g0-5 isolation attacker` (denne filen)
2. `test(security): G0-5 isolation attacker for swapped family ids`

## 2.9 Kompleksitet

Ikke «small»: 7 probe-klasser, tverrgående cache, child-rolle.
Ingen domenemodell-endring. Analyse kan være middels lang; deretter tester.

# 2026-04-20 — Temporary diagnostic endpoint for shopping-bought-state

> Merket `liten` per CLAUDE.md DEL 11. Analyse holdes kort fordi
> oppgaven er ren infrastruktur: ett lese-endepunkt, ingen data-
> endring, ingen domene-utvidelse. Oppfølger av
> `2026-04-20-shopping-bought-state.md` §10.

---

## KONTEKST

Analyse-PR #53 krever to `sqlite3`-kommandoer mot produksjons-DB for
å skille mellom de tre hypotesene (H1 migrasjon 018 kjørte ikke,
H2 `is-pantry`-visuell forveksling, H3 SW-cache). Distroless-containeren
har ikke shell, og Christer har ikke ssh-adgang via Portainers
exec-konsoll. Et tidsavgrenset diagnostikk-endepunkt er raskeste
måte å hente de to tallene på uten å endre image-baselinjen.

## REISEN (kort)

```
Christer pull-er :main i Portainer
  → container restarter
  → GET /api/debug/shopping-state med Authorization: Bearer <token>
    → authenticate() i server/auth/middleware.js matcher Bearer
      → route-handler i server/routes.js leser tre tall via repos
        → JSON-respons med meta + migrations + shopping_list_items
          + pantry_entries
            → Christer limer output inn i samtalen
              → jeg kan skille H1/H2/H3
```

Ingen skrive-path. Ingen data muteres. Ingen cache-invalidering.

## EDGE-CASES

1. **Unauthenticated request (ingen Authorization-header).**
   Autentisering gjør at `authenticate()` faller gjennom til "Bearer
   auth not configured" HVIS AUTH_TOKEN er uskaffet; ellers "Authentication
   required" → 401. Dekket av standard-middleware, ingen ny logikk.
2. **Feil Bearer token.** `constantTimeEquals` fanger mismatch → 401
   via samme middleware. Dekket.
3. **DB ikke initialisert (tidlig oppstart-race).** Repos-metoder vil
   throw hvis tabeller mangler. Vi wrap i try/catch og returnerer
   HTTP 503 med `db_not_ready`-grunn slik at klient skjønner det.
4. **Tabell mangler (migrasjoner ikke kjørt).** `shopping_list_items`
   og `inventory` kommer fra migrasjon 007 og 001. Hvis de mangler,
   er hele systemet ødelagt — ikke vår sak. Men feilen skal lekke
   strukturert: try/catch rundt hver spørring, rapport som
   `{ error: <message>, code: <sqlite-code> }` i response-body.
5. **Readonly DB / filsystem-feil.** Kun lese-spørringer, så readonly
   er fint. Skulle disken være full eller WAL låst, rapporteres som
   generisk feil per §4.
6. **Enormt datasett.** Samplet er LIMIT 5. Count-spørringene bruker
   indeks på `bought_at` hvis den finnes; ellers full scan på noen
   tusen rader — akseptabelt for én-gangs bruk.
7. **pilot-bypass-modus uten AUTH_TOKEN.** Auth-middleware
   attacher LOCAL_USER som owner. Endepunktet returnerer data som i
   bearer-modus — forventet oppførsel siden Christer er eneste pilot
   og forventer dette responsen.
8. **Endepunktet glemmes i produksjon.** CHANGELOG + PR-tittel +
   endepunkt-tittel i OpenAPI sier "TEMPORARY". Oppfølgings-PR fjerner
   det senest 7 dager etter merge. Hvis glemt: statusquo er én
   diagnostisk GET-rute bak Bearer-auth som lekker count-tall og id-
   struktur uten PII — lav risiko.

## SIKKERHETSANALYSE

**PII-fri respons.** Responsen inneholder KUN:

- Heltall (counts, IDs).
- ISO-8601 tidsstempler.
- Floats (qty).
- Boolean (has_recipe_link).
- Konstant streng (db_path = '/app/data/familieassistenten.db').

Eksplisitt utelatt: `ingredient_name`, `ingredient_name_no`,
`product_key`, `brand_hint`, `notes`, `meals_json`, `source_ref`,
`family_id`, `created_by`, og alle strenger fra seed eller bruker-
input. Testene asserter at disse ikke finnes i responsen.

**Auth.** Standard middleware: Bearer token matching
`config.AUTH_TOKEN`. Hvis AUTH_TOKEN er blank (pilot-bypass), faller
autentisering gjennom til LOCAL_USER — samme oppførsel som resten av
`/api/*`. Spec-et sier "samme AUTH_TOKEN som resten av API-et"; vi
gjenbruker middleware uendret.

**Angrepsoverflate.** Én GET-rute. Ingen query-parametre. Ingen
write. Rate-limit håndteres av `rateLimit` i `server/http/security.js`
som dekker hele `/api/*`.

**Risiko ved å la endepunktet stå:** Lav. Counts-tall er ikke
sensitive. Endepunktet fjernes i oppfølgings-PR (maks 7 dager eller
ved PR #53-ferdigstilling, hva enn kommer først).

## PORTAINER-OPPSTARTSRISIKO-SJEKK

| Berøres | Ja/Nei |
|---------|--------|
| Dockerfile / .dockerignore | Nei |
| docker-compose.yml | Nei |
| server/http/bootstrap.js | Nei |
| server/config.js oppstartsvalidering | Nei |
| server/index.js startup-sekvens | Nei |
| server/db.js eller server/migrations/** | Nei |
| install.sh | Nei |
| bootstrap.json-lesning | Nei |
| Miljøvariabel-krav for oppstart | Nei |

**Resultat: ingen Portainer-oppstartsrisiko.** Kun ny lese-rute på
`/api/*`, ingen oppstartseffekt. Steg 3b ikke utløst.

## ISO 25010-PÅVIRKNING

- Functional Completeness: 8.7 → 8.7 (uendret — diagnostikk, ikke
  produkt-funksjon).
- Security: 8.2 → 8.2 (uendret — samme auth, ingen ny flate).
- Maintainability: 8.3 → 8.3 (uendret — midlertidig kode med
  eksplisitt fjernings-plan).

Ikke-relevant ellers.

## PLAN FOR FJERNING

Oppfølgings-PR `chore/remove-temporary-diagnostic-endpoint` åpnes og
merges senest 7 dager etter denne, eller umiddelbart etter at
PR #53-fixen er merget (hva enn kommer først).

Fjerningen skal:
- Slette `GET /api/debug/shopping-state` fra `server/routes.js`.
- Fjerne nye repo-metoder dersom ingen andre kallere finnes.
- Slette `tests/debug-endpoint.test.js`.
- Fjerne OpenAPI-oppføringen.
- Oppdatere CHANGELOG: `Removed: temporary /api/debug/shopping-state`.

## IMPLEMENTASJONS-PLAN (commits)

1. `chore(repos): add bought-state diagnostic queries` — nye repo-
   metoder på shopping og inventory (1 commit).
2. `chore(routes): add temporary /api/debug/shopping-state` — rute-
   handler + OpenAPI + CHANGELOG (1 commit).
3. `test(debug): verify auth, shape, and PII-free response` — tester
   (1 commit).

Tre små commits, < 100 linjer hver.

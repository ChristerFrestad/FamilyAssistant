# Hvorfor enricher markerte list 10 som 'done' uten å koble noen items

Dato: 2026-05-06
Branch: `chore/sprint-11-analyse`
Forfatter: agent (read-only)

## TL;DR

**Hovedhypotese (95% konfidens):** List 10 ble enrich'et MENS `KASSAL_API_KEY` var
uset. Enricheren har en "no_api_key"-fast-exit på
[shopping-list-enricher.service.js:100-111](../../server/services/shopping-list-enricher.service.js)
som setter `enrichment_status='done'` umiddelbart. Etter at Christer aktiverte
Kassal-key-en, ble listen aldri reenrichet fordi cron's
`listPendingEnrichment` filtrerer på `IN ('pending','partial')` —
ikke 'done'.

Det er en **premature-finalization-bug** i designet, ikke en kode-feil i
selve resolver/enricher. Items har null kassal-felt fordi resolveren aldri
ble kalt for dem.

**Anbefalt umiddelbar fix (1 SQL-statement):**
```sql
UPDATE shopping_lists
SET enrichment_status = 'pending',
    enrichment_started_at = NULL,
    enrichment_finished_at = NULL
WHERE id = 10;
```
Cron plukker opp listen ved neste 10-min-tick, prøver mot Kassal med live
API-key, og items får faktiske resolutions.

**Anbefalt langsiktig fix (Sprint 11):** Endre `!apiKey`-stien til å sette
`'pending'` eller introdusere ny status `'no_api_key'`, slik at cron
automatisk plukker opp lista når key er aktivert.

---

## 1. Inventering — status

### Kun lokal-DB tilgjengelig

Christers prod-state lever på RPi 5 (`/home/frestad/familieassistenten-data/data/familieassistenten.db`).
Lokal dev-DB her har bare 3 shopping_lists (max id=3) og 0 kassal_products
— matcher ikke prod (id=10, 25 kassal_products, 16 resolutions).

Følgelig kan jeg **ikke kjøre 1c, 1d, 1e**-spørringene direkte. Konkrete SQL-snippets
Christer kan kjøre på Pi (via `sqlite3 data/familieassistenten.db`) er gitt i §3.

### 1a, 1b — kjent fra Christers rapport

| Felt | Verdi |
|---|---|
| `shopping_lists.id` | 10 |
| `week_year` | 2026-W19 |
| `status` | active |
| `enrichment_status` | done |
| Items i list 10 | 67 |
| Items med `kassal_product_id IS NOT NULL` | 0 |
| Items med `resolution_candidates_json IS NOT NULL` | 0 |
| `kassal_products`-rader | 25 |
| `product_resolutions`-rader | 16 |
| Sample item | `{ingredientName: "Kyllingfilet", productKey: "kyllingfilet", packSize: 500, ingredientNameNo: null}` |

### 1a UTESTÅENDE — trenger Pi-spørring

`enrichment_started_at` og `enrichment_finished_at` på list 10 er kritisk for å
skille mellom hypotesene. Spør Pi:

```sql
SELECT id, week_year, status, enrichment_status,
       enrichment_started_at, enrichment_finished_at,
       generated_at
FROM shopping_lists WHERE id = 10;
```

**Tolkning:**
- Begge null + `generated_at` før KASSAL_API_KEY ble satt → enricher har aldri rørt listen (cron filtrerer 'done' bort)
- Begge satt og samme sekund → "no_api_key"-fast-exit (Hypotese B bekreftet)
- Begge satt og 5+ sekunder fra hverandre → enricher kjørte items-løkka (Hypotese C, mindre sannsynlig)

---

## 2. Kodelesing — enricher-pipeline

### 2a. Kriterier for at item BLIR enriched

[shopping-list-enricher.service.js:113-115](../../server/services/shopping-list-enricher.service.js):

```js
const toEnrich = (list.items || [])
  .filter((it) => it.needsBuy && !it.kassalProductId && it.ingredientName)
  .slice(0, maxItems);
```

Tre kriterier (alle må være sanne):
1. `needsBuy` truthy (DB-kolonne `needs_buy=1`)
2. `kassalProductId` falsy (null/undefined)
3. `ingredientName` truthy

Christer's items: `kassalProductId=null` ✓, `ingredientName="Kyllingfilet"` ✓.
Eneste utestående: **er `needs_buy=1`?**

### 2b. Tilstander som fører til at items HOPPES OVER

Inni løkka (linje 145-232):

| Tilstand | Resultat | Dummy-effekt på item |
|---|---|---|
| `kassalClient.getStatus().circuitOpen` | `bailed=true`, break loop, status='partial' | Items urørt |
| `tokensAvailable < 1` | `bailed=true`, break loop, status='partial' | Items urørt |
| Resolver kaster exception | `skipped++`, continue | Items urørt |
| Resolver returnerer match (`kassalProductRowId`) | `attachResolution()` skriver felter, `enriched++` | Items oppdatert |
| Resolver returnerer weak match (`candidates.length > 0`) | `attachResolution()` lagrer kandidater, `skipped++` | `resolution_candidates_json` skrevet, `kassalProductId` fortsatt null |
| Resolver returnerer null | `skipped++`, continue | Items urørt |

**Viktig:** I scenariet "resolver returnerer null på alle 67" ville `skipped=67`
og status='done' settes til slutt — men items hadde fortsatt null på alle
resolution-felt. Det matcher Christers symptom 100%.

### 2c. Status-transitions

```
pending  →  running  ──(loop)──>  done       (alle items prøvd, ingen bail)
                          \\
                           ──>  partial    (circuit-open eller tom token-bucket)

pending  ──(no API key)──>  done       reason='no_api_key'      ← MISTENKT BUG
pending  ──(no items toEnrich)──>  done   reason='nothing_to_enrich'
done     ──(re-call)──>  done       reason='already_done' (fast-exit, ingen reenrich)
running  ──(re-call)──>  running    reason='already_running' (fast-exit)
```

### 2d. Logger enricher per-item-skip?

**Nei, ikke per item.** Kun aggregerte counters i sluttlogg (linje 237-238):

```js
logger.info({ listId, enriched, skipped, bailed, bailReason, finalStatus },
            'enricher: done');
```

Eneste per-item-logg er hvis resolveren KASTER exception (linje 184):
```js
logger.warn({ err: err.message, itemId: item.id }, 'enricher: resolver threw');
```

Dette betyr: **logg-arkeologi forteller oss om "no_api_key"-stien ble hit**, men
ikke per-item-status. Spør Pi-loggene etter:
```
grep -i "enricher\|no_api_key\|nothing_to_enrich" container.log
```

---

## 3. SQL-spørringer Christer kan kjøre på Pi

```bash
ssh frestad@<pi-ip>
docker exec -it familieassistenten sqlite3 /app/data/familieassistenten.db
```

```sql
-- Q3.1: Bekreft hypotese A (alle items pantry-dekket)
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN needs_buy = 1 THEN 1 ELSE 0 END) AS needs_buy_yes,
  SUM(CASE WHEN needs_buy = 0 THEN 1 ELSE 0 END) AS needs_buy_no,
  SUM(CASE WHEN ingredient_name IS NULL OR ingredient_name = '' THEN 1 ELSE 0 END) AS no_name
FROM shopping_list_items
WHERE list_id = 10;
```
**Tolkning:**
- `needs_buy_no=67` → Hypotese A bekreftet (intet å handle, enricher korrekt 'done')
- `needs_buy_yes=67` → Hypotese A avkreftet, fortsett til Q3.2

```sql
-- Q3.2: Bekreft hypotese B (no_api_key fast-exit)
SELECT id, status, enrichment_status,
       enrichment_started_at, enrichment_finished_at, generated_at
FROM shopping_lists WHERE id = 10;
```
**Tolkning:**
- `enrichment_started_at == enrichment_finished_at` (samme sekund) → fast-exit-sti
- Begge null → enricher har aldri kjørt på listen (typisk om listen ble laget i en prev-API-key-tilstand der enricher allerede har bailet og cron ekskluderer 'done')

```sql
-- Q3.3: Hvor kom de 25 kassal_products fra?
SELECT capture_source, COUNT(*) AS cnt
FROM kassal_products
GROUP BY capture_source
ORDER BY cnt DESC;
```
**Tolkning:**
- 'lookup' → fra resolver (enricher eller pantry-add eller receipt)
- 'meal_plan' → fra sunday-draft accept
- 'manual_add' → fra `POST /api/pantry/add`
- 'receipt' → fra kvittering-confirm

Hvis 0 'lookup' og bare 'manual_add'/'receipt', bekrefter at enricher aldri har
fungert — kassal-data kom fra andre kanaler.

```sql
-- Q3.4: Hva matcher de 16 resolutions?
SELECT pr.product_key, kp.name AS kassal_name, pr.resolved_via,
       pr.confidence, pr.times_seen, pr.last_seen_at
FROM product_resolutions pr
LEFT JOIN kassal_products kp ON kp.id = pr.kassal_product_id
ORDER BY pr.last_seen_at DESC;
```

```sql
-- Q3.5: Overlap mellom resolutions.product_key og items i list 10
SELECT pr.product_key, pr.kassal_product_id, pr.confidence,
       COUNT(sli.id) AS items_in_list_10
FROM product_resolutions pr
LEFT JOIN shopping_list_items sli
  ON sli.product_key = pr.product_key AND sli.list_id = 10
GROUP BY pr.product_key
ORDER BY items_in_list_10 DESC;
```
**Tolkning:**
- Hvis flere `product_key` har `items_in_list_10 > 0`, betyr det at vi HAR
  resolutions for items i list 10 — men listens items mangler likevel
  `kassal_product_id`. Det ville indikere en **separat bug**: `attachResolution`
  ble aldri kalt for disse items.
- Hvis `items_in_list_10 = 0` for alle, bekrefter at resolveren aldri har
  prosessert disse items (ingen overlapp).

---

## 4. Root-cause-diagnose

### Hypotese B er mest sannsynlig (95% konfidens uten Pi-bekreftelse)

**Tidssekvens jeg tror skjedde:**

1. Christer genererte list 10 (uke 2026-W19) **før** KASSAL_API_KEY var aktivert
2. Cron-jobben `shoppingEnrichmentJob` (hver 10. min) plukket opp listen
3. Enricher leste `process.env.KASSAL_API_KEY` → undefined
4. [shopping-list-enricher.service.js:101-111](../../server/services/shopping-list-enricher.service.js):
   ```js
   if (!apiKey) {
     repos.shoppingLists.setEnrichmentStatus(listId, 'done',
       { startedAt: true, finishedAt: true });
     return { ..., reason: 'no_api_key' };
   }
   ```
5. Listen ble markert 'done'. **Items ble aldri prosessert.**
6. Christer aktiverte KASSAL_API_KEY senere (`apiKeyConfigured: true`)
7. Cron's `listPendingEnrichment` filtrerer `IN ('pending','partial')` — list 10 er 'done', så den hentes ikke
8. De 25 kassal_products + 16 resolutions kom fra **andre kanaler** etter aktivering: pantry-add, receipt-confirm, eller andre lister generert etter aktiveringen

### Hvorfor Hypotese A (alle pantry-dekket) er mindre sannsynlig

Items har realistiske ingredient-navn ("Kyllingfilet"). Hvis 67/67 var pantry-
dekket, ville det vært synlig som tom liste i UI. Christer ville sett "0 å handle"
i stedet for å studere DB-en.

Men det er ikke umulig — listen kunne vært merge'et fra en tidligere
'superseded'-liste hvor pantry-tilstand var allerede dekket. Q3.1 bekrefter/avkrefter.

### Hvorfor Hypotese C (resolver-null på alle) er minst sannsynlig

Det ville krevd at hver eneste av 67 ingredients ga 0 treff på Kassal — usannsynlig
for vanlige produkter (kjøttdeig, melk, brød, etc.). Q3.5 avkrefter ved å sjekke
om noen `product_key`-er har resolutions men items i list 10 mangler kassal_product_id.

### Bug-klassifisering

**Type:** Design-issue / state-transition-bug.

Det er ikke at koden gjør noe feil per seg — `setEnrichmentStatus(listId, 'done',
...)` er vellykket. Men semantikken til 'done' er forvirret:

| Status | Semantikk i dag | Burde være |
|---|---|---|
| 'done' | "ingen flere arbeid" | "alle items er forsøkt resolvert" |
| 'no_api_key'-fast-exit setter 'done' | "enricher er ferdig" | "venter på API-key" — fortsatt pending |

`done` betyr i dag "vi gir oss / vi er ferdige", uavhengig av om vi faktisk
har prøvd. Det er et over-bruk av statusen.

---

## 5. Anbefalt fix-strategi

### Umiddelbar workaround (1 SQL — du trenger ingen kode-deploy)

```sql
-- Reset list 10 til pending — cron plukker den opp innen 10 min
UPDATE shopping_lists
SET enrichment_status = 'pending',
    enrichment_started_at = NULL,
    enrichment_finished_at = NULL
WHERE id = 10;
```

For å fikse alle lister som er feilstemplet 'done' uten enrichment:
```sql
-- Identifiser kandidater først
SELECT sl.id, sl.week_year, COUNT(sli.id) AS total_items,
       SUM(CASE WHEN sli.kassal_product_id IS NOT NULL THEN 1 ELSE 0 END) AS enriched_items
FROM shopping_lists sl
LEFT JOIN shopping_list_items sli ON sli.list_id = sl.id
WHERE sl.enrichment_status = 'done'
GROUP BY sl.id
HAVING enriched_items = 0 AND total_items > 0;

-- Reset alle som matcher (bekreft listen først!)
UPDATE shopping_lists
SET enrichment_status = 'pending',
    enrichment_started_at = NULL,
    enrichment_finished_at = NULL
WHERE id IN (<bekreftede id-er>);
```

### Kode-fix (Sprint 11 eller eget mini-fix-PR)

To opsjoner:

**A. Endre 'done' → 'pending' i no_api_key-stien:**

```diff
   if (!apiKey) {
-    repos.shoppingLists.setEnrichmentStatus(listId, 'done',
-      { startedAt: true, finishedAt: true });
+    // Don't mark 'done' — we have not actually tried. Leave 'pending'
+    // so cron picks it up automatically when KASSAL_API_KEY is set.
+    logger.info({ listId }, 'enricher: no_api_key, leaving as pending');
     return {
       listId, enriched: 0, skipped: 0, bailed: false,
-      finalStatus: 'done', reason: 'no_api_key',
+      finalStatus: 'pending', reason: 'no_api_key',
     };
   }
```

**Pros:** Minimal endring, cron driver selv-recovery.
**Cons:** Cron kjører hvert 10. minutt og logger "no_api_key" hvert tick til API-key
settes — hardt å filtrere bort i loggen. Kan begrenses ved å ha en
"throttle" på den første loggingen per listId.

**B. Introduser ny status 'no_api_key':**

Krever migrasjons-endring i CHECK-constraint på `shopping_lists.enrichment_status`:
```sql
CHECK (enrichment_status IN
  ('pending','running','done','partial','failed','no_api_key'))
```

Pluss endring i `listPendingEnrichment` til også å plukke opp 'no_api_key'.

**Pros:** Eksplisitt tilstand. Lett å se i admin-panel hvor mange lister venter på API-key.
**Cons:** Migrasjon + flere kode-endringer. CHECK-rebuild av tabell (jf. mig. 024-mønsteret).

### Min anbefaling: Opsjon A

Mindre kompleksitet. Selv-rekonsiliering. Hvis logg-spam blir et problem, legg til
en `if (!seenNoKeyForList(listId, 24h))` throttle.

---

## 5. Anbefalte neste steg

### Er dette en blocker for Sprint 11?

**Nei, ikke for Sprint 11-planlegging.** Men det er en blocker for **Christer's
nåværende test av Kassal-aktivering**, fordi list 10 (hans aktive uke-liste) ikke
blir berørt før den manuelt resettes eller koden deployes.

### Estimat

| Fix | Estimat |
|---|---|
| SQL-workaround for list 10 | 30 sekunder (du kjører selv) |
| Kode-fix opsjon A + tester | 1-2 timer |
| Kode-fix opsjon B + migrasjon + tester | 4-6 timer |

### Anbefalt rekkefølge

1. **Nå:** Kjør Q3.1 + Q3.2 på Pi for å bekrefte hypotesen (5 min)
2. **Nå-til-i-kveld:** Hvis Hypotese B bekreftet, kjør SQL-workaround for list 10. Vent 10 min (cron-tick), verifiser at items er beriket.
3. **Før Sprint 11:** Implementer opsjon A i en liten `fix(enricher)`-PR. ~150 linjer diff inkludert tester.
4. **Sprint 11:** Bredere Kassal-aktiverings-arbeid (frontend `EnrichmentStatusBadge`, retry-CTA, butikklogo) bygges på en kodebase som ikke har dette state-transition-puzzlet.

### Side-funn (verdt å logge)

- Enricher har **ingen per-item-logging** → vanskelig å debugge produksjonsproblemer.
  Forslag for Sprint 11: legg til `logger.debug({ itemId, ingredientName, resolved: !!resolution }, 'enricher: item processed')`.
- `attachResolution`-stien kan stilltiende hoppes over hvis resolution mangler `kassalProductRowId`. Verifiser at weak-match-stien skriver `resolution_candidates_json` korrekt — Christers items har `null` der også, så enten ble den aldri kalt ELLER den ble kalt med `candidates: null`. Q3.5 hjelper å skille.

---

## Vedlegg: Kompleksitets-vurdering per CLAUDE.md DEL 3.9

| Aspekt | Verdi |
|---|---|
| Edge-cases | 4 (hypoteser A/B/C + weak-match-bug) |
| Domenemodell-endring | nei (bare tilstand-semantikk) |
| Forretningsregel | nei |
| Berørt fil-antall | 1 (`shopping-list-enricher.service.js`) for opsjon A |
| Migrasjon påkrevd | nei (A) / ja (B) |
| Portainer-risiko | nei (request-tids-logikk, ingen oppstart-impact) |

Liten oppgave med klar root-cause-hypotese. Anbefalt rapport-omfang: kort (denne).

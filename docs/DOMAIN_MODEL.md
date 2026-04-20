# DOMAIN_MODEL.md – Domenemodell og forretningsregler

> Dette dokumentet er systemets kollektive forståelse av seg selv.
> Claude leser det før hver oppgave og oppdaterer det når domenet
> utvides eller endres. Hvis denne filen og koden er i konflikt:
> STOPP og varsle Christer. En av dem er feil.

> Dette dokumentet er **bevisst startet tomt**. Prosjektet har allerede
> 22 services og rik domeneforståelse i koden – å backfille alt her
> ville være en flere-ukers oppgave på linje med ISO-løftet. I stedet
> vokser dokumentet når Claude berører domeneområder, én oppgave av gangen.

---

## HVORDAN LESE DETTE DOKUMENTET

Inntil en entitet, regel, eller edge-case er dokumentert her, er
kode-sannhet i `server/services/*.service.js` og `server/repositories.js`
den autoritative kilden. Når Claude jobber med en ny oppgave:

1. Sjekk om berørte entiteter/regler finnes her
2. Hvis ja: bruk som referanse, oppdater hvis endring
3. Hvis nei: når oppgaven er ferdig, dokumenter det som ble etablert
   eller oppdaget under arbeidet

---

## ENTITETER

> Hver entitet beskriver: felter, relasjoner, regler, livssyklus.
> Kort og konkret. Koden er sannheten; dette er forklaringen.

*(Ingen entiteter dokumentert ennå. Vokser organisk.)*

### Format å følge når du legger til en entitet

````markdown
### <EntityName>

**Kildefil:** `server/services/<name>.service.js`
**Repository:** `repos.<entity>` i `server/repositories.js`
**Tabell:** `<table_name>` (migrasjon `server/migrations/<NNN>_*.sql`)

**Hva er det:** 2–3 setninger som forklarer hva entiteten representerer
i familien/husholdningen.

**Felter:**
- `id` – PK
- `<felt>` (type) – kort forklaring
- `created_at`, `updated_at`

**Relasjoner:**
- 1 ↔ N med <AnnenEntity>
- ...

**Regler:**
- <regel 1>
- <regel 2>
- Referer BR-N hvis regel er dokumentert i forretningsregler

**Livssyklus:**
<Hvordan entiteten oppstår, endres, og forsvinner.>

**Berøres av tester:**
- `tests/<fil>.test.js`
````

---

## FORRETNINGSREGLER

> Regler som går på tvers av flere entiteter. Nummereres for referanse
> fra kode og tester. Format: BR-<nummer> (Business Rule).

*(Ingen forretningsregler dokumentert ennå. Vokser organisk.)*

### Format å følge når du legger til en regel

````markdown
### BR-001: <Kort tittel>

**Hva:** <Regelen i 1–2 setninger>

**Hvorfor:** <Bakgrunn og begrunnelse>

**Detaljert flyt:**
1. <steg>
2. <steg>
3. <steg>

**Berørte filer:**
- `server/services/<navn>.service.js` (implementasjon)
- `tests/<fil>.test.js` (verifikasjon)

**Dokumentert:** <dato, PR-nummer>
**Sist endret:** <dato, PR-nummer>
````

---

## EDGE-CASES PÅ TVERS

> Edge-cases som berører flere entiteter og må håndteres konsistent
> overalt. Nummereres for referanse.

*(Ingen edge-cases dokumentert ennå.)*

---

## GLOSSAR

> Når Christer eller koden bruker ord, skal de bety det samme.

*(Ingen termer definert ennå. Bygges opp etter hvert.)*

### Format å følge

````markdown
- **<Term>:** <Kort definisjon>. (Referanse: `<fil>`)
````

---

## RELASJONER PÅ HØYT NIVÅ

*(Diagram/oversikt kommer når nok entiteter er dokumentert.)*

---

## REFERANSER TIL EKSISTERENDE ID-SYSTEMER

Prosjektet har allerede etablert flere ID-systemer fra ISO-planen.
DOMAIN_MODEL.md bruker **BR-N** for forretningsregler, og refererer
til eksisterende ID-er der relevant – **introduserer ikke parallelle
systemer**:

- **SAF-N** – safety (se `docs/SAFETY_CASE.md`, f.eks. SAF-1 =
  deterministisk allergi-post-filter)
- **SBOM-N** – supply chain (f.eks. SBOM-6 = audit_log)
- **OBS-N** – observability
- **PERF-N** – ytelse
- **PORT-N** – portabilitet
- **TS-N** – type-sikkerhet
- **R-N** – risks (se `docs/RISK_REGISTER.md`, R1-R12)

En forretningsregel kan referere en SAF eller R der det gir mening,
f.eks.:
> BR-005 implementerer SAF-1 (deterministisk allergi-sjekk) for
> shopping-list-entries. Se også R1.
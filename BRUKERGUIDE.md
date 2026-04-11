# Brukerguide — Familieassistenten

**Versjon:** 1.3.0
**Sist oppdatert:** 2026-04-11
**Målgruppe:** Familier som bruker Familieassistenten på eget hjemmenett (typisk Raspberry Pi 5)

Denne guiden dekker de seks viktigste brukerflytene. Den forutsetter at
serveren allerede er installert og kjører (se `DEPLOY.md` for installasjon).

---

## Innholdsfortegnelse

1. [Første gang — velkomst-turen](#1-første-gang--velkomst-turen)
2. [Planlegge ukens middager](#2-planlegge-ukens-middager)
3. [Handletur](#3-handletur)
4. [Husarbeid](#4-husarbeid)
5. [Importere oppskrifter](#5-importere-oppskrifter)
6. [Familieprofil og allergier](#6-familieprofil-og-allergier)

---

## 1. Første gang — velkomst-turen

Når du åpner Familieassistenten for første gang, får du automatisk en
firetrinns velkomst-tur som viser deg:

1. **Hva appen kan gjøre** — planlegging, handleliste, husarbeid, chat
2. **Hvordan fanene fungerer** — i bunn av skjermen
3. **Kontrollrommet** — tannhjulet oppe i høyre hjørne
4. **Tips for daglig bruk** — emoji-knappene og stemmestyring

**Tastatur-snarveier under turen:**

| Tast | Handling |
|------|----------|
| `Enter` | Neste steg |
| `Tab` | Bytt mellom "Hopp over" og "Neste" |
| `Esc` | Hopp over hele turen |

Turen vises kun én gang per nettleser (lagres i `localStorage`). For å se
den igjen, åpne browserens devtools (F12) og kjør:

```javascript
window._resetOnboarding()
```

---

## 2. Planlegge ukens middager

### Hovedflyt: Automatisk søndagspush

Hver søndag kl 14:00 bygger systemet automatisk et forslag til neste
ukes middager basert på:

- Dine preferanser og tidligere valg
- Det du allerede har i pantry
- Variasjon (ikke samme rett to dager på rad)
- Familieprofilen (allergier, mislikt mat)

Du får et varsel — åpne appen, og forslaget vises. Du kan:

- **✓ Godta forslaget** — middagene låses og handleliste lages automatisk
- **🔄 Nytt forslag** — be om et helt nytt sett
- **Avbryt** — lukk uten å endre noe

### Manuell planlegging

I **Ukesmeny**-fanen ser du alle syv dager. For hver dag kan du:

1. **Klikke "Bytt middag"** — se 5 forslag basert på variasjon
2. **Skrive inn ønsket rett** — søker i eksisterende oppskrifter
3. **Markere "🏖️ Borte"** — ingen middag denne dagen (f.eks. bortreise)
4. **↑↓-knapper** — flytte en middag til en annen dag

### Se ingredienser

Klikk **"▶ Vis ingredienser"** under en middag for å se oppskriften.
Du kan også klikke **"↻ Lignende oppskrift →"** for å finne varianter.

---

## 3. Handletur

### Automatisk handleliste

Når alle dagene i ukesmenyen er satt, bygger systemet automatisk en
handleliste som:

- Trekker ingredienser fra alle oppskriftene
- Sjekker pantry og fjerner det du allerede har
- Runder opp til pakkemengder (f.eks. 250g hvis oppskriften trenger 180g)
- Grupperer etter kategori (Kjøtt, Meieri, Frukt & grønt, etc.)
- Beregner estimert totalpris via Kassal-integrasjon (hvis aktivert)

### Hovedflyt: Å kjøpe

I **Handletur**-fanen (velg "🛒 Å kjøpe") ser du hele listen. For hver vare:

- **✓ Kjøpt** — marker som kjøpt + flytter automatisk til pantry
- **"Dekket av pantry"** — vises hvis du allerede har varen
  - **"↩ Trenger likevel"** — flytter den tilbake til kjøpslisten

### Legge til ekstra varer manuelt

Under handlelisten finner du et skjema hvor du kan:

1. Skrive inn et varenavn
2. Velge kategori
3. Klikke "Legg til"

Varen dukker opp i listen som "consumable" og kan markeres som kjøpt
som alle andre.

### Pantry (det du har hjemme)

Velg **"🏠 Pantry"**-fanen i Handletur-visningen. Her ser du alt du
har hjemme med:

- **Progresjonsbar** — hvor mye er igjen av pakken
- **⚠ lav-badge** — varsel hvis under terskel (f.eks. 20%)

**Legge til i pantry:**
- Skriv varenavn i søkefeltet øverst
- Velg mengde og enhet
- Klikk "Lagre"

**Fjerne fra pantry:** Klikk ✗-knappen. Du får en bekreftelsesdialog
(siden uke 4) før varen fjernes.

---

## 4. Husarbeid

### Ukens oppgaver

I **Husarbeid**-fanen ser du alle oppgavene gruppert etter dag. Hver
oppgave har:

- 🧹 Ikon (støvsuging, vask, handling, etc.)
- Beskrivelse
- **✓ Gjort**-knapp
- **"Utsett"**-knapp (flytter til neste ledige dag)

### Automatisk planlegging

Hver mandag morgen planlegges ukens husarbeid automatisk basert på
familiens rutiner i `seed.js`. Du kan endre dette via systemd-jobben
hvis du vil justere planen.

### Varsler

Når en oppgave nærmer seg deadline (holdbarhet på pantry-varer,
forsinkede oppgaver, etc.), får du en bekreftelsesdialog øverst.
Klikk **"Marker som lest"** for å dismisse.

---

## 5. Importere oppskrifter

Klikk **📖**-knappen (Floating Action Button nederst høyre) i Ukesmeny-fanen.

### Tekst-import

1. Velg **"Tekst"**-fanen i modalen
2. Lim inn hele oppskriften — tittel, ingredienser, fremgangsmåte
3. Klikk **"Importer"**

LLM-en parser teksten og finner:

- Oppskriftsnavn
- Ingredienser med mengde og enhet
- Fremgangsmåte-steg
- Antall porsjoner
- Anslått koke-tid

Oppskriften lagres og blir tilgjengelig for meal-planning.

### Bilde-import (OCR)

1. Velg **"Bilde"**-fanen
2. Klikk på dropzone-en
3. Velg et bilde eller ta et nytt via mobilkameraet
4. Bildet skaleres automatisk til maks 800px bredde
5. Klikk **"Importer"**

LLM-en utfører OCR (tesseract eller lignende) og parser teksten.

**Tips:** Fungerer best med flate sider (ikke oppslag) og god belysning.

### Oppskriftskilder

I **Kontrollrommet** (tannhjul øverst) → **"Oppskriftskilder"** kan du
legge til faste kilder som synkes automatisk hver 6. time:

- Pinterest-boards (public)
- godt.no-profiler
- RSS-feeds
- Vanlige HTML-sider

---

## 6. Familieprofil og allergier

I **Kontrollrommet** → **"Familieprofil"** kan du sette:

### Familiemedlemmer

- Navn og alder på hver
- Brukes av LLM-en for porsjons-beregning

### Allergier (kritisk!)

- Legg til hver allergi som et tag
- Eksempel: `nøtter`, `laktose`, `gluten`, `skalldyr`

**Hva som skjer med allergier:**

- LLM-en unngår oppskrifter som inneholder allergenene
- Meal-planning filtrerer bort matchende oppskrifter
- Meta-filtre genereres automatisk ("Laktosefri", "Glutenfri", etc.)

**⚠ Viktig advarsel:** LLM-genererte oppskrifter skal alltid
dobbeltsjekkes mot allergier. Systemet er "beste innsats", ikke
garantert trygt. Uke 9 i ISO/IEC 25010-forbedringsplanen introduserer
en deterministisk post-filter som hard-blokkerer allergi-brudd.

### Mislikt mat

- Samme format som allergier
- LLM-en deprioriterer disse i forslag, men blokkerer dem ikke hardt

### Preferanser

- Frie tekst-preferanser som "vi er vegetariske søndager"
- Brukes i LLM-konteksten for bedre forslag

---

## Tastatur-snarveier (globalt)

| Tast | Handling |
|------|----------|
| `Esc` | Lukk åpen modal, eller gå tilbake fra Kontrollrommet |
| `Enter` i chat | Send melding |
| `Enter` i dialoger | Bekreft (hvis fokus er på bekreft-knappen) |
| `Tab` | Navigere mellom knapper og felter |

---

## Stemmestyring

I **Chat**-fanen, klikk **🎤**-knappen for å starte opptak.

**To moduser:**

1. **Backend STT (whisper.cpp)** — hvis `STT_BACKEND=whisper` er satt
   - Lagrer opptak som `audio/webm` og sender til server
   - Høyere presisjon, norsk støtte
2. **Nettleser STT (Web Speech API)** — fallback, ingen installasjon
   - Fungerer på de fleste nettlesere
   - Kvalitet avhenger av din Google/Apple-konto

**For å stoppe opptaket:** Klikk ⏹-knappen eller bare stopp å snakke
(auto-stopp etter 2 sek stillhet).

---

## Offline-modus

Familieassistenten har en Progressive Web App (PWA) med service worker.
Det betyr:

- **Første besøk:** alt caches automatisk
- **Senere besøk uten nett:** appen laster fortsatt, viser siste kjente data
- **Offline-banner** dukker opp øverst når tilkobling mangler
- **Automatisk reconnect** når nettet er tilbake

For å installere som "app" på mobilen, bruk nettleserens "Legg til
på startskjermen"-funksjon.

---

## Feilsøking

### "LLM ikke tilgjengelig"

Dette betyr at Ollama (eller alternativ backend) ikke svarer. Sjekk:

1. **I Kontrollrommet → LLM-motor:** se hvilken backend som er valgt
2. **Kjør `systemctl status ollama` på RPi5** for å verifisere prosessen
3. **Test direkte:** `curl http://localhost:11434/api/tags`

Midlertidig kan du bytte til Anthropic/OpenAI/xAI hvis du har API-nøkler
satt i Kontrollrommet.

### "Ingen forbindelse"

Service worker har mistet kontakt med backend. Prøv:

1. **Last siden på nytt** (Ctrl+R / ⌘R)
2. **Sjekk Wi-Fi/nettverk** på enheten
3. **Sjekk at RPi5 er tilgjengelig:** `ping familieassistenten.local`

### Handlelisten er tom

- Ukesmenyen må være **fullstendig** (alle 7 dager)
- Ingen dag kan være satt til "Borte"
- Hvis aktiv, sjekk i Kontrollrommet → Om → DB-helse

---

## Hvor lagres dataene mine?

Alle data ligger i SQLite-filen på RPi5:

```
/home/pi/Familieassistenten/data/familieassistenten.db
```

**Ingen data sendes til tredjepart** med mindre du:

- Aktiverer Kassal (for pris-oppslag) — sender kun varenavn
- Bruker Anthropic/OpenAI/xAI som LLM-backend — sender chat-meldinger

Ollama og whisper.cpp kjører lokalt — ingen data forlater RPi5.

**Backup:** Daglig online-backup skrives til `data/backups/` og (hvis
konfigurert) synkes off-site via `rsync` til en annen maskin. Se
`RUNBOOK.md` for gjenoppretting.

---

## Flere ressurser

| Dokument | Formål |
|----------|--------|
| `DEPLOY.md` | Installasjon på RPi5 |
| `RUNBOOK.md` | Drift, feilsøking, DR |
| `SECURITY.md` | Sikkerhetsmodell |
| `CHANGELOG.md` | Hva er nytt per versjon |
| `openapi.yaml` | API-dokumentasjon |
| `CI.md` | Kvalitetsgater og bidrag |

**Spørsmål eller feil?**
Åpne en issue på GitHub: https://github.com/ChristerFrestad/FamilyAssistant/issues

# Known issues

Åpne, ikke-kritiske bugs som er besluttet utsatt. Alle innslag skal ha
reproduksjons-steg, beslutning om utsettelse, og referanse til samtale
eller PR der utsettelsen ble avtalt.

---

## "Lignende oppskrifter"-knapper er ikke klikkbare (meals-visning)

- **Rapportert av:** Christer, 2026-04-22
- **Symptom:** I ukesmeny-visningen vises knapper for "lignende
  oppskrifter" ved siden av hver rett. Klikk på knappen gjør ingenting —
  ingen modal åpnes, ingen navigasjon skjer, ingen request går ut.
- **Scope:** Frontend-only (ingen backend-endring mistenkt).
- **Antatt årsak:** Event-delegering i `public/js/meals.js`
  ([meals.js:5-13](../public/js/meals.js#L5)) leter etter
  `[data-action="show-similar"]` via `e.target.closest(...)`, men
  knappene har muligens feil `data-action`-verdi, feil DOM-
  struktur, eller preventer ikke default form-submission.
  Ikke diagnostisert nøyaktig.
- **Beslutning (Christer, 2026-04-22):** Ikke fiks nå.
  "Jeg antar dette er frontend-only og skal behandles i ny frontend
  senere." Sitat fra PR #59-kontekst.
- **Utsatt til:** Frontend-redesign-fasen (uke 8+ per uke-1-planen i
  `docs/workflow/batch-1-pr-description.md`). Mockup ligger parkert i
  `design/redesign-exploration-2026-04/`.
- **Workaround for brukere:** Ingen — funksjonen er inaktiv men ikke
  blokkerende for appens hovedflyt (meals / shopping / chores virker).

---

## Mal for nye innslag

```md
## <kort tittel>

- **Rapportert av:** <navn>, <dato>
- **Symptom:** <hva brukeren ser>
- **Scope:** <frontend-only / backend / begge>
- **Antatt årsak:** <kort vurdering + fil-referanse hvis mulig>
- **Beslutning (<navn>, <dato>):** <fiks nå / utsett / forkast>
- **Utsatt til:** <fase / release / aldri>
- **Workaround for brukere:** <hva de kan gjøre i mellomtiden>
```

Skal kun inneholde bugs som er bevisst utsatt. Rapporter som krever
umiddelbar oppmerksomhet hører hjemme i PR-er eller analyser, ikke her.

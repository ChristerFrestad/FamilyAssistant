-- Migration 008: Fase F2 — pantry total_size for progress-bar og lav-terskel
--
-- Legger til én ny kolonne på inventory:
--   * total_size REAL NULL — "embalsjen/pakkens total", uavhengig av
--     last_pack_size (som er historisk, siste kjøpte forpakning).
--
-- Når brukeren sier "jeg har 300 ml av 1 L igjen" lagrer vi 300 i
-- qty_remaining og 1000 i total_size (begge i samme enhet).
-- Ratio = qty_remaining / total_size brukes til:
--   * Progress-bar i pantry-UI (Fase F2)
--   * Lav-beholdning-auto-trigger til handleliste (Fase F2)
--
-- Eksisterende rader får NULL som total_size. Ingen data-migrasjon
-- trengs siden både qty_remaining og unit allerede er REAL/TEXT.
--
-- Denne migrasjonen er reversibel: DROP COLUMN total_size (SQLite 3.35+)
-- eller tabell-rebuild. Ingen andre tabeller eller views peker på denne
-- kolonnen, så endringen er trygg.

ALTER TABLE inventory ADD COLUMN total_size REAL;

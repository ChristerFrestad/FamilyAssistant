-- Migration 013: Kjede-preferanser i family_profile
--
-- Brukeren velger foretrukket dagligvarekjede (f.eks. Kiwi) og ev.
-- sekundærkjede (f.eks. Rema 1000). Produkter fra foretrukket kjede
-- rangeres høyest i handleliste og søk, deretter sekundærkjede,
-- deretter alfabetisk.
--
-- Nullable: systemet fungerer som før hvis ingen kjede er valgt.

ALTER TABLE family_profile ADD COLUMN preferred_chain TEXT;
ALTER TABLE family_profile ADD COLUMN secondary_chain TEXT;

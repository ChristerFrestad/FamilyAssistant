/**
 * Fase F – Canonical productKey slugification.
 *
 * All produktnavn som kommer inn fra UI (pantry, shopping, manuell add)
 * MÅ gå gjennom denne funksjonen. Mål: samme vare = samme key uansett
 * om den kom fra Kassal, pantry-historikk eller et fritt skrevet navn.
 *
 * Regler:
 *  - Lowercase
 *  - Æ → e, Ø → o, Å → a (norsk → ASCII)
 *  - Bindestrek og underscore → ingenting
 *  - Whitespace → bindestrek
 *  - Alt annet ikke-alfanumerisk fjernes
 *  - Trim til maks 64 tegn
 */
function slugifyProductKey(name) {
  if (!name || typeof name !== 'string') return '';
  return (
    name
      .toLowerCase()
      .trim()
      // Norske tegn
      .replace(/æ/g, 'e')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      // Alle diakritiske tegn
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Whitespace → bindestrek
      .replace(/\s+/g, '-')
      // Fjern alt som ikke er a-z, 0-9 eller bindestrek
      .replace(/[^a-z0-9-]/g, '')
      // Collapse gjentagende bindestreker
      .replace(/-+/g, '-')
      // Fjern leading/trailing
      .replace(/^-+|-+$/g, '')
      // Maks lengde
      .slice(0, 64)
  );
}

module.exports = { slugifyProductKey };

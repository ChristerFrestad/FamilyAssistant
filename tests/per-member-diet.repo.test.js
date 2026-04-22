'use strict';

// Tests for B7 — per-member diet extensions to family.repo.js
// (migration 020 + getMemberDiet/updateMemberDiet).
//
// Verifies:
//   - Schema: 4 new columns present with correct defaults
//   - Round-trip: getMemberDiet → updateMemberDiet → getMemberDiet
//   - Fallback semantics: null vs [] distinction preserved
//   - Update semantics: undefined keeps, null clears, array replaces
//   - diet_tags enum validation (reject unknown tags)
//   - Tenant-isolation: updating family A's member cannot touch family B
//   - Round-trip listMembers() parses JSON columns correctly
//   - updateMember (roster) does NOT clobber diet fields
//   - updateMemberDiet does NOT clobber roster fields

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

let server;

function createFamily(name) {
  return Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(name).lastInsertRowid
  );
}

before(async () => {
  server = await startTestServer({ authToken: 'per-member-diet-test-token-0123456789abcdef' });
});

after(async () => {
  await server.close();
});

// ============================================================
// Schema (migration 020)
// ============================================================

test('migration 020 added allergies/dislikes/diet_tags/custom_diet_note columns', () => {
  const cols = server.repos._db.prepare('PRAGMA table_info(family_profile_members)').all();
  const names = cols.map((c) => c.name).sort();
  for (const required of ['allergies', 'dislikes', 'diet_tags', 'custom_diet_note']) {
    assert.ok(names.includes(required), `missing column ${required}; got: ${names.join(', ')}`);
  }
});

test('diet_tags column is NOT NULL with default []', () => {
  const cols = server.repos._db.prepare('PRAGMA table_info(family_profile_members)').all();
  const dietTagsCol = cols.find((c) => c.name === 'diet_tags');
  assert.equal(dietTagsCol.notnull, 1, 'diet_tags must be NOT NULL');
  assert.equal(dietTagsCol.dflt_value, "'[]'", 'diet_tags default must be empty JSON array');
});

test('allergies and dislikes default to NULL (for fallback semantics)', () => {
  const cols = server.repos._db.prepare('PRAGMA table_info(family_profile_members)').all();
  const allergiesCol = cols.find((c) => c.name === 'allergies');
  const dislikesCol = cols.find((c) => c.name === 'dislikes');
  assert.equal(allergiesCol.notnull, 0, 'allergies must allow NULL');
  assert.equal(dislikesCol.notnull, 0, 'dislikes must allow NULL');
});

// ============================================================
// Default values on new members
// ============================================================

test('addMember creates row with NULL allergies/dislikes, [] dietTags, NULL customDietNote', () => {
  const familyId = createFamily('Add-Default');
  const member = server.repos.family.addMember(familyId, { name: 'Anna' });
  assert.equal(member.allergies, null, 'allergies should default to NULL');
  assert.equal(member.dislikes, null, 'dislikes should default to NULL');
  assert.deepEqual(member.dietTags, [], 'dietTags should default to []');
  assert.equal(member.customDietNote, null, 'customDietNote should default to NULL');
});

test('listMembers returns parsed JSON for all diet columns', () => {
  const familyId = createFamily('List-Parse');
  server.repos.family.addMember(familyId, { name: 'Kari' });
  const m = server.repos.family.addMember(familyId, { name: 'Ola' });
  server.repos.family.updateMemberDiet(familyId, m.id, {
    allergies: ['Laktose'],
    dietTags: ['vegetarian'],
  });
  const members = server.repos.family.listMembers(familyId);
  assert.equal(members.length, 2);
  // Kari: untouched defaults
  const kari = members.find((x) => x.name === 'Kari');
  assert.equal(kari.allergies, null);
  assert.deepEqual(kari.dietTags, []);
  // Ola: updated
  const ola = members.find((x) => x.name === 'Ola');
  assert.deepEqual(ola.allergies, ['Laktose']);
  assert.deepEqual(ola.dietTags, ['vegetarian']);
});

// ============================================================
// getMemberDiet / updateMemberDiet round-trip
// ============================================================

test('updateMemberDiet round-trip: set all 4 fields, read back', () => {
  const familyId = createFamily('Round-Trip');
  const m = server.repos.family.addMember(familyId, { name: 'Lise' });
  const updated = server.repos.family.updateMemberDiet(familyId, m.id, {
    allergies: ['Gluten', 'Nøtter'],
    dislikes: ['Sopp'],
    dietTags: ['vegetarian', 'laktosefri'],
    customDietNote: 'Foretrekker norsk kortreist mat',
  });
  assert.equal(updated.memberId, m.id);
  assert.deepEqual(updated.allergies, ['Gluten', 'Nøtter']);
  assert.deepEqual(updated.dislikes, ['Sopp']);
  assert.deepEqual(updated.dietTags, ['vegetarian', 'laktosefri']);
  assert.equal(updated.customDietNote, 'Foretrekker norsk kortreist mat');

  // Read back via getMemberDiet
  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.deepEqual(got, updated);
});

test('getMemberDiet returns null for non-existent member', () => {
  const familyId = createFamily('Missing-Member');
  const result = server.repos.family.getMemberDiet(familyId, 999999);
  assert.equal(result, null);
});

test('updateMemberDiet returns null for non-existent member', () => {
  const familyId = createFamily('Update-Missing');
  const result = server.repos.family.updateMemberDiet(familyId, 999999, {
    allergies: ['X'],
  });
  assert.equal(result, null);
});

// ============================================================
// Fallback semantics: null vs [] distinction
// ============================================================

test('allergies = null explicitly clears (different from []) — fallback-ready', () => {
  const familyId = createFamily('Fallback-Null');
  const m = server.repos.family.addMember(familyId, { name: 'Per' });

  // Set concrete allergies
  server.repos.family.updateMemberDiet(familyId, m.id, { allergies: ['Egg'] });
  assert.deepEqual(server.repos.family.getMemberDiet(familyId, m.id).allergies, ['Egg']);

  // Clear to null → should be NULL (will trigger fallback in filter layer later)
  server.repos.family.updateMemberDiet(familyId, m.id, { allergies: null });
  assert.equal(server.repos.family.getMemberDiet(familyId, m.id).allergies, null);
});

test('allergies = [] is distinct from null — explicit "no allergies"', () => {
  const familyId = createFamily('Fallback-Empty');
  const m = server.repos.family.addMember(familyId, { name: 'Siv' });

  server.repos.family.updateMemberDiet(familyId, m.id, { allergies: [] });
  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.deepEqual(got.allergies, []);
  assert.notEqual(got.allergies, null, 'empty array must not coerce to null');
});

test('dietTags has no fallback: null clears to [] (not NULL)', () => {
  const familyId = createFamily('DietTags-NoFallback');
  const m = server.repos.family.addMember(familyId, { name: 'Erik' });

  server.repos.family.updateMemberDiet(familyId, m.id, { dietTags: ['vegan'] });
  assert.deepEqual(server.repos.family.getMemberDiet(familyId, m.id).dietTags, ['vegan']);

  server.repos.family.updateMemberDiet(familyId, m.id, { dietTags: null });
  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.deepEqual(got.dietTags, [], 'dietTags null must clear to []');
});

// ============================================================
// Partial update (undefined = keep)
// ============================================================

test('updateMemberDiet with undefined fields keeps existing values', () => {
  const familyId = createFamily('Partial-Update');
  const m = server.repos.family.addMember(familyId, { name: 'Mona' });

  // Initial state
  server.repos.family.updateMemberDiet(familyId, m.id, {
    allergies: ['Fisk'],
    dislikes: ['Kål'],
    dietTags: ['pescetarian'],
    customDietNote: 'Initial note',
  });

  // Partial update — only dislikes changed
  server.repos.family.updateMemberDiet(familyId, m.id, { dislikes: ['Kål', 'Rosenkål'] });
  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.deepEqual(got.allergies, ['Fisk'], 'allergies should be untouched');
  assert.deepEqual(got.dislikes, ['Kål', 'Rosenkål']);
  assert.deepEqual(got.dietTags, ['pescetarian'], 'dietTags should be untouched');
  assert.equal(got.customDietNote, 'Initial note', 'customDietNote should be untouched');
});

// ============================================================
// diet_tags enum validation
// ============================================================

test('updateMemberDiet rejects unknown dietTags', () => {
  const familyId = createFamily('Invalid-Tags');
  const m = server.repos.family.addMember(familyId, { name: 'Tor' });

  assert.throws(
    () => server.repos.family.updateMemberDiet(familyId, m.id, { dietTags: ['made-up-diet'] }),
    /invalid dietTags.*made-up-diet/
  );
});

test('updateMemberDiet accepts all 13 documented D3 enum values', () => {
  const familyId = createFamily('All-13-Tags');
  const m = server.repos.family.addMember(familyId, { name: 'Siri' });

  const allTags = server.repos.family.VALID_DIET_TAGS;
  // D3 enum is 13 values — 'diabetiker-vennlig' was excluded from the
  // original proposal because diabetes requires per-recipe nutrient data
  // and per-user carb/sugar thresholds (pending phase 2).
  assert.equal(allTags.length, 13, 'expected 13 diet tags per D3');

  // Apply all at once — should not throw
  server.repos.family.updateMemberDiet(familyId, m.id, { dietTags: allTags });
  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.deepEqual(got.dietTags.sort(), [...allTags].sort());
});

test('updateMemberDiet rejects diabetiker-vennlig (deferred to phase 2)', () => {
  // Regression guard: ensure this tag is not silently re-added later.
  const familyId = createFamily('No-Diabetiker-Tag');
  const m = server.repos.family.addMember(familyId, { name: 'Kai' });
  assert.throws(
    () =>
      server.repos.family.updateMemberDiet(familyId, m.id, {
        dietTags: ['diabetiker-vennlig'],
      }),
    /invalid dietTags.*diabetiker-vennlig/
  );
});

test('updateMemberDiet deduplicates dietTags', () => {
  const familyId = createFamily('Dedupe-Tags');
  const m = server.repos.family.addMember(familyId, { name: 'Ida' });

  server.repos.family.updateMemberDiet(familyId, m.id, {
    dietTags: ['vegetarian', 'vegan', 'vegetarian', 'vegan'],
  });
  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.equal(got.dietTags.length, 2, 'duplicates should be removed');
});

// ============================================================
// Type validation
// ============================================================

test('updateMemberDiet rejects non-array allergies', () => {
  const familyId = createFamily('Invalid-Type-A');
  const m = server.repos.family.addMember(familyId, { name: 'Jon' });
  assert.throws(
    () => server.repos.family.updateMemberDiet(familyId, m.id, { allergies: 'Gluten' }),
    /allergies must be null or array/
  );
});

test('updateMemberDiet rejects non-string customDietNote', () => {
  const familyId = createFamily('Invalid-Type-C');
  const m = server.repos.family.addMember(familyId, { name: 'Eva' });
  assert.throws(
    () => server.repos.family.updateMemberDiet(familyId, m.id, { customDietNote: 42 }),
    /customDietNote must be null or string/
  );
});

test('updateMemberDiet trims and coerces empty customDietNote to null', () => {
  const familyId = createFamily('Empty-Note');
  const m = server.repos.family.addMember(familyId, { name: 'Liv' });

  server.repos.family.updateMemberDiet(familyId, m.id, { customDietNote: '   ' });
  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.equal(got.customDietNote, null, 'whitespace-only should coerce to null');
});

// ============================================================
// Isolation: updateMember (roster) vs updateMemberDiet (diet)
// ============================================================

test('updateMember (roster) does not clobber diet fields', () => {
  const familyId = createFamily('Roster-Isolated');
  const m = server.repos.family.addMember(familyId, { name: 'Geir' });

  server.repos.family.updateMemberDiet(familyId, m.id, {
    allergies: ['Nøtter'],
    dietTags: ['vegan'],
  });

  // Rename — should not touch diet
  server.repos.family.updateMember(familyId, m.id, { name: 'Geir Olav' });

  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.equal(got.name, 'Geir Olav');
  assert.deepEqual(got.allergies, ['Nøtter']);
  assert.deepEqual(got.dietTags, ['vegan']);
});

test('updateMemberDiet does not clobber roster fields (name/category/portion)', () => {
  const familyId = createFamily('Diet-Isolated');
  const m = server.repos.family.addMember(familyId, {
    name: 'Nils',
    category: 'teen',
    portionFactor: 0.75,
  });

  server.repos.family.updateMemberDiet(familyId, m.id, { allergies: ['Laktose'] });

  const members = server.repos.family.listMembers(familyId);
  const nils = members.find((x) => x.id === m.id);
  assert.equal(nils.name, 'Nils');
  assert.equal(nils.category, 'teen');
  assert.equal(nils.portionFactor, 0.75);
  assert.deepEqual(nils.allergies, ['Laktose']);
});

// ============================================================
// Tenant isolation
// ============================================================

test('updateMemberDiet cannot update another family\u2019s member', () => {
  const familyA = createFamily('Fam-A-Isolation');
  const familyB = createFamily('Fam-B-Isolation');
  const memberA = server.repos.family.addMember(familyA, { name: 'A-only' });

  // Attempt to update member A with family B's id — must return null (no-op)
  const result = server.repos.family.updateMemberDiet(familyB, memberA.id, {
    allergies: ['Hijacked'],
  });
  assert.equal(result, null, 'cross-family update must be a no-op');

  // Verify member A's diet is untouched
  const aDiet = server.repos.family.getMemberDiet(familyA, memberA.id);
  assert.equal(aDiet.allergies, null, 'member A should remain untouched');
});

test('getMemberDiet cannot read another family\u2019s member', () => {
  const familyA = createFamily('Fam-A-GetDiet');
  const familyB = createFamily('Fam-B-GetDiet');
  const memberA = server.repos.family.addMember(familyA, { name: 'Private' });
  server.repos.family.updateMemberDiet(familyA, memberA.id, { allergies: ['Secret'] });

  // Read from family B — must return null
  const leaked = server.repos.family.getMemberDiet(familyB, memberA.id);
  assert.equal(leaked, null, 'cross-family read must be blocked');
});

// ============================================================
// String cleaning (trim + filter empty)
// ============================================================

test('updateMemberDiet trims and filters empty allergy strings', () => {
  const familyId = createFamily('Trim-Allergies');
  const m = server.repos.family.addMember(familyId, { name: 'Trim' });

  server.repos.family.updateMemberDiet(familyId, m.id, {
    allergies: ['  Gluten  ', '', '   ', 'Nøtter'],
  });
  const got = server.repos.family.getMemberDiet(familyId, m.id);
  assert.deepEqual(got.allergies, ['Gluten', 'Nøtter']);
});

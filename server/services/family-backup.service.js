'use strict';

// Owner-only family backup (schemaVersion 2) and import.
//
// Export is a portable JSON snapshot: family name, roster members,
// login users without secrets, recipes (active+inactive), chores,
// meal plans, shopping lists, pantry, and local calendar events.
// Never includes password hashes, session ids, invitation tokens,
// or per-family LLM keys.
//
// Import always targets the caller's current family. payload.family.id
// is rejected (never used as-is). All row ids are remapped.

const { errors } = require('../http/errors');

const SCHEMA_VERSION = 2;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const IMPORT_LIMIT = 3;
const IMPORT_WINDOW_MS = 60 * 60 * 1000;

const importHits = new Map();

function assertImportRateLimit(familyId) {
  const now = Date.now();
  const hits = (importHits.get(familyId) || []).filter((t) => now - t < IMPORT_WINDOW_MS);
  if (hits.length >= IMPORT_LIMIT) {
    throw errors.tooManyRequests('Backup import is limited to 3 per hour per family.');
  }
  hits.push(now);
  importHits.set(familyId, hits);
}

function portableRecipe(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    prepTime: r.prepTime ?? r.prep_time ?? null,
    source: r.source ?? null,
    url: r.url ?? null,
    pinterestUrl: r.pinterestUrl ?? r.pinterest_url ?? null,
    servings: r.servings ?? 2,
    equipment: Array.isArray(r.equipment) ? r.equipment : [],
    notes: r.notes ?? null,
    sourceType: r.sourceType || r.source_type || 'manual',
    active: r.active !== 0 && r.active !== false,
    ingredients: (r.ingredients || []).map((ing) => ({
      name: ing.name,
      qty: ing.qty ?? null,
      unit: ing.unit ?? null,
      productKey: ing.productKey ?? ing.product_key ?? null,
      optional: !!ing.optional,
    })),
  };
}

function portableChore(c) {
  return {
    id: c.id,
    task: c.task,
    details: c.details ?? null,
    frequency: c.frequency,
    defaultDay: c.defaultDay ?? c.default_day ?? null,
    icon: c.icon ?? null,
    assigneeMemberId: c.assigneeMemberId ?? c.assignee_member_id ?? null,
    intervalDays: c.intervalDays ?? c.interval_days ?? null,
    active: c.active !== 0 && c.active !== false,
  };
}

function portableMember(m) {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    portionFactor: m.portionFactor,
    sortOrder: m.sortOrder,
    allergies: m.allergies,
    dislikes: m.dislikes,
    dietTags: m.dietTags || [],
    customDietNote: m.customDietNote ?? null,
  };
}

function portableUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    profileMemberId: u.profile_member_id ?? u.profileMemberId ?? null,
  };
}

function portableShoppingItem(it) {
  return {
    sourceType: it.sourceType || 'manual',
    sourceRef: it.sourceRef || null,
    ingredientName: it.ingredientName,
    ingredientNameNo: it.ingredientNameNo || null,
    productKey: it.productKey || null,
    qty: it.qty ?? null,
    unit: it.unit || null,
    brandHint: it.brandHint || null,
    category: it.category || null,
    packSize: it.packSize ?? null,
    packUnit: it.packUnit || null,
    packCount: it.packCount ?? null,
    estPrice: it.estPrice ?? null,
    pantryHas: !!it.pantryHas,
    pantryQty: it.pantryQty ?? null,
    needsBuy: it.needsBuy !== 0 && it.needsBuy !== false,
    mealsJson: it.mealsJson || null,
    dairyNote: it.dairyNote || null,
    notes: it.notes || null,
  };
}

function listAllShoppingLists(repos, familyId) {
  const ids = repos._db
    .prepare('SELECT id FROM shopping_lists WHERE family_id = ? ORDER BY week_year, id')
    .all(familyId)
    .map((r) => r.id);
  return ids.map((id) => repos.shoppingLists.getById(id)).filter(Boolean);
}

function listAllMealPlans(repos, familyId) {
  const weeks = repos._db
    .prepare(
      'SELECT DISTINCT week_year AS weekYear FROM meal_plans WHERE family_id = ? ORDER BY week_year'
    )
    .all(familyId)
    .map((r) => r.weekYear);
  const out = [];
  for (const weekYear of weeks) {
    for (const slot of repos.mealPlans.getWeek(weekYear)) {
      out.push(slot);
    }
  }
  return out;
}

function buildFamilyBackup(repos, familyId) {
  const family = repos.family.findFamilyById(familyId);
  if (!family) throw errors.notFound('Family not found.');
  const recipes = repos.recipes.getAll({ includeInactive: true }).map(portableRecipe);
  const chores = repos.chores.getAll({ includeInactive: true }).map(portableChore);
  const members = repos.family.listMembers(familyId).map(portableMember);
  const users = repos.auth.listByFamily(familyId).map(portableUser);
  const pantryMap = repos.inventory.getAll();
  const pantry = Object.entries(pantryMap || {}).map(([productKey, row]) => ({
    productKey,
    qtyRemaining: row.qtyRemaining,
    unit: row.unit || '',
    lastPurchased: row.lastPurchased ?? null,
    lastPackSize: row.lastPackSize ?? row.packSize ?? null,
    totalSize: row.totalSize ?? null,
    expiresEst: row.expiresEst ?? null,
    purchaseCount: row.purchaseCount ?? 0,
  }));
  const calendarEvents = repos.calendar
    .getEvents('2000-01-01', '2100-12-31')
    .filter((e) => (e.source || 'local') === 'local')
    .map((e) => ({
      title: e.title,
      date: e.date,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
      location: e.location ?? null,
      allDay: !!e.allDay,
      notes: e.notes ?? null,
      source: 'local',
    }));
  const shoppingLists = listAllShoppingLists(repos, familyId).map((list) => ({
    weekYear: list.weekYear,
    status: list.status,
    totalEstPrice: list.totalEstPrice ?? null,
    notes: list.notes ?? null,
    items: (list.items || []).map(portableShoppingItem),
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    family: { name: family.name },
    members,
    users,
    recipes,
    chores,
    mealPlans: listAllMealPlans(repos, familyId),
    shoppingLists,
    pantry,
    calendarEvents,
  };
}

function assertSafePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw errors.badRequest('payload must be a JSON object.');
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw errors.payloadTooLarge(`Backup payload exceeds ${MAX_PAYLOAD_BYTES} bytes.`);
  }
  if (payload.schemaVersion !== SCHEMA_VERSION) {
    throw errors.badRequest(`Unsupported schemaVersion (expected ${SCHEMA_VERSION}).`);
  }
  if (payload.family && Object.prototype.hasOwnProperty.call(payload.family, 'id')) {
    throw errors.badRequest(
      'payload.family.id must not be used as-is; import remaps into this family.'
    );
  }
}

function wipeImportableData(repos, familyId) {
  const tables = [
    'shopping_list_items',
    'shopping_lists',
    'shopping_extras',
    'meal_plans',
    'recipe_ingredients',
    'recipes',
    'chore_schedules',
    'chore_completions',
    'chores',
    'inventory',
  ];
  for (const table of tables) {
    repos._db.prepare(`DELETE FROM ${table} WHERE family_id = ?`).run(familyId);
  }
  repos._db
    .prepare(
      `DELETE FROM calendar_events WHERE family_id = ? AND (source = 'local' OR source IS NULL)`
    )
    .run(familyId);
}

function importMembers(repos, familyId, members, memberIdMap) {
  if (!Array.isArray(members)) return;
  for (const m of members) {
    if (!m || typeof m.name !== 'string' || !m.name.trim()) continue;
    try {
      const created = repos.family.addMember(familyId, {
        name: m.name,
        category: m.category || 'adult',
        portionFactor: m.portionFactor ?? 1.0,
      });
      if (m.id != null) memberIdMap.set(Number(m.id), created.id);
      if (
        m.allergies !== undefined ||
        m.dislikes !== undefined ||
        m.dietTags !== undefined ||
        m.customDietNote !== undefined
      ) {
        repos.family.updateMemberDiet(familyId, created.id, {
          allergies: m.allergies,
          dislikes: m.dislikes,
          dietTags: m.dietTags,
          customDietNote: m.customDietNote,
        });
      }
    } catch {
      // Skip invalid roster rows rather than aborting the whole import.
    }
  }
}

function importRecipes(repos, recipes, recipeIdMap) {
  if (!Array.isArray(recipes)) return;
  for (const r of recipes) {
    if (!r || typeof r.name !== 'string' || !r.name.trim()) continue;
    const newId = Number(
      repos.recipes.insert({
        name: r.name,
        category: r.category || 'rask',
        prepTime: r.prepTime ?? null,
        source: r.source ?? null,
        url: r.url ?? null,
        pinterestUrl: r.pinterestUrl ?? null,
        servings: r.servings ?? 2,
        equipment: r.equipment,
        notes: r.notes ?? null,
        sourceType: r.sourceType,
        ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
      })
    );
    if (r.id != null) recipeIdMap.set(Number(r.id), newId);
    if (r.active === false) {
      repos.recipes.update(newId, { active: false });
    }
  }
}

function importChores(repos, chores, memberIdMap) {
  if (!Array.isArray(chores)) return;
  for (const c of chores) {
    if (!c || typeof c.task !== 'string' || !c.task.trim()) continue;
    let assignee = c.assigneeMemberId ?? null;
    if (assignee != null && memberIdMap.has(Number(assignee))) {
      assignee = memberIdMap.get(Number(assignee));
    } else if (assignee != null) {
      assignee = null;
    }
    try {
      repos.chores.insert({
        task: c.task,
        details: c.details ?? null,
        frequency: c.frequency || 'ukentlig',
        defaultDay: c.defaultDay ?? null,
        icon: c.icon ?? null,
        assigneeMemberId: assignee,
        intervalDays: c.intervalDays ?? null,
        active: c.active !== false,
      });
    } catch {
      // Skip invalid chore rows.
    }
  }
}

function importMealPlans(repos, mealPlans, recipeIdMap) {
  if (!Array.isArray(mealPlans)) return;
  for (const slot of mealPlans) {
    if (!slot || !slot.weekYear || slot.dayOfWeek == null) continue;
    const rawId = slot.recipeId ?? slot.recipe_id;
    const recipeId = rawId == null ? null : (recipeIdMap.get(Number(rawId)) ?? null);
    if (recipeId == null) continue;
    repos.mealPlans.setRecipe(slot.weekYear, slot.dayOfWeek, recipeId, slot.status || 'planned');
  }
}

function importShoppingLists(repos, lists, recipeIdMap) {
  if (!Array.isArray(lists)) return;
  for (const list of lists) {
    if (!list || !list.weekYear || !Array.isArray(list.items)) continue;
    const items = list.items.map((it) => {
      let sourceRef = it.sourceRef || null;
      if (sourceRef != null && recipeIdMap.has(Number(sourceRef))) {
        sourceRef = String(recipeIdMap.get(Number(sourceRef)));
      }
      return {
        sourceType: it.sourceType || 'manual',
        sourceRef,
        ingredientName: it.ingredientName || it.name || 'Item',
        ingredientNameNo: it.ingredientNameNo || null,
        productKey: it.productKey || null,
        qty: it.qty ?? null,
        unit: it.unit || null,
        brandHint: it.brandHint || null,
        category: it.category || null,
        packSize: it.packSize ?? null,
        packUnit: it.packUnit || null,
        packCount: it.packCount ?? null,
        estPrice: it.estPrice ?? null,
        pantryHas: !!it.pantryHas,
        pantryQty: it.pantryQty ?? null,
        needsBuy: it.needsBuy !== false,
        mealsJson: it.mealsJson || null,
        dairyNote: it.dairyNote || null,
        notes: it.notes || null,
      };
    });
    repos.shoppingLists.createActive(list.weekYear, items, {
      totalEstPrice: list.totalEstPrice ?? null,
      notes: list.notes ?? null,
    });
  }
}

function importPantry(repos, pantry) {
  const entries = Array.isArray(pantry)
    ? pantry
    : pantry && typeof pantry === 'object'
      ? Object.entries(pantry).map(([productKey, row]) => ({ productKey, ...row }))
      : [];
  for (const row of entries) {
    if (!row || !row.productKey) continue;
    const qty = Number(row.qtyRemaining);
    if (!Number.isFinite(qty) || qty === 0) continue;
    repos.inventory.upsertManual(row.productKey, {
      qtyAdded: qty,
      unit: row.unit || '',
      expiresEst: row.expiresEst ?? null,
    });
  }
}

function importCalendar(repos, events) {
  if (!Array.isArray(events)) return;
  for (const ev of events) {
    if (!ev || !ev.title || !ev.date) continue;
    if (ev.source && ev.source !== 'local') continue;
    repos.calendar.insert({
      title: ev.title,
      date: ev.date,
      startTime: ev.startTime ?? null,
      endTime: ev.endTime ?? null,
      location: ev.location ?? null,
      allDay: !!ev.allDay,
      notes: ev.notes ?? null,
      source: 'local',
    });
  }
}

function importFamilyBackup(repos, familyId, { mode, payload }) {
  assertImportRateLimit(familyId);
  assertSafePayload(payload);

  const recipeIdMap = new Map();
  const memberIdMap = new Map();

  const run = () => {
    if (mode === 'replace') {
      wipeImportableData(repos, familyId);
    }
    importMembers(repos, familyId, payload.members, memberIdMap);
    importRecipes(repos, payload.recipes, recipeIdMap);
    importChores(repos, payload.chores, memberIdMap);
    importMealPlans(repos, payload.mealPlans, recipeIdMap);
    importShoppingLists(repos, payload.shoppingLists, recipeIdMap);
    importPantry(repos, payload.pantry);
    importCalendar(repos, payload.calendarEvents);
  };

  repos._db.transaction(run)();

  return {
    ok: true,
    mode,
    remapped: {
      recipes: recipeIdMap.size,
      members: memberIdMap.size,
    },
  };
}

module.exports = {
  SCHEMA_VERSION,
  MAX_PAYLOAD_BYTES,
  buildFamilyBackup,
  importFamilyBackup,
  assertSafePayload,
};

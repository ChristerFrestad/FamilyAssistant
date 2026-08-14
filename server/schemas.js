// Zod-skjemaer for alle API-endepunkter som tar input.
// Sentralisert her s\u00e5 valideringen er konsistent og dokumenterbar.

const { z } = require('zod');

// ============================================================
// Felles
// ============================================================

const dayOfWeek = z.number().int().min(0).max(6);
const weekYear = z
  .string()
  .regex(/^\d{4}-W\d{2}$/, 'Ugyldig weekYear (f.eks. 2026-W15)')
  .refine(
    (v) => {
      const w = Number(v.slice(6));
      return w >= 1 && w <= 53;
    },
    { message: 'Week number must be between 01 and 53' }
  );
const positiveId = z.number().int().positive();
const category = z.string().min(1).max(50);
const mealStatus = z.enum(['planned', 'cooked', 'skipped', 'away', 'removed']);

/** Validate that a YYYY-MM-DD string represents a real date */
function isValidDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// ============================================================
// Meals
// ============================================================

const mealsSwapBody = z.object({
  weekYear: weekYear.optional(),
  dayOfWeek,
  recipeId: positiveId,
});

const mealsStatusBody = z.object({
  weekYear: weekYear.optional(),
  dayOfWeek,
  status: mealStatus,
});

/**
 * Sprint 6 — meal-cooked deduction body. Used by
 * POST /api/meals/:id/apply-deduction. Each entry is one ingredient
 * the user kept in the dialog with a (possibly edited) amount.
 */
const mealApplyDeductionBody = z
  .object({
    items: z
      .array(
        z
          .object({
            productKey: z.string().min(1).max(100),
            amountToDeduct: z.number().nonnegative().max(100000),
          })
          .strict()
      )
      .max(50)
      .default([]),
  })
  .strict();

const mealsReorderBody = z.object({
  weekYear: weekYear.optional(),
  fromDay: dayOfWeek,
  toDay: dayOfWeek,
});

const pantrySuggestionBody = z
  .object({
    category: z.enum(['rask', 'comfort', 'helg']),
  })
  .strict();

const pantrySuggestionAcceptBody = z
  .object({
    meals: z
      .array(
        z.object({
          dayOfWeek,
          recipeId: positiveId,
        })
      )
      .min(1)
      .max(7),
  })
  .strict();

// ============================================================
// Shopping
// ============================================================

const shoppingCheckBody = z.object({
  productKey: z.string().min(1).max(100),
  packSize: z.number().positive().optional(),
});

const shoppingAddBody = z.object({
  name: z.string().min(1).max(200),
  category: category.optional(),
  quantity: z.number().positive().optional(),
});

const shoppingGenerateBody = z
  .object({
    weekYear: weekYear.optional(),
    force: z.boolean().optional(),
    // 'merge' (default): preserve bought + manual rows, add fresh
    // meal-ingredients. 'replace': wipe and regenerate from scratch.
    mode: z.enum(['merge', 'replace']).optional(),
  })
  .strict();

const shoppingItemBoughtBody = z
  .object({
    qty: z.number().positive().optional(),
  })
  .strict();

// POST /api/shopping/items — manually add a single item to the active
// shopping list. The active list must exist (no implicit creation here).
// Phase 2D Shopping screen uses this for the QuickAdd input. Items
// inserted this way are stored with source_type='manual' and stay on
// the list until bought or deleted.
const shoppingItemAddBody = z
  .object({
    name: z.string().min(1).max(200),
    qty: z.number().positive().optional(),
    unit: z.string().min(1).max(20).optional(),
    category: category.optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

// ============================================================
// Chores
// ============================================================

const chorePostponeBody = z.object({
  weekYear: weekYear.optional(),
  choreId: positiveId,
});

const choreCompleteBody = z.object({
  weekYear: weekYear.optional(),
  choreId: positiveId,
});

const choreStatsQuery = z.object({
  week: weekYear.optional(),
});

const familyGamificationBody = z
  .object({
    enabled: z.boolean().optional(),
    weekGoal: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.weekGoal !== undefined, {
    message: 'enabled or weekGoal is required',
  });

const familyBackupImportBody = z
  .object({
    mode: z.enum(['merge', 'replace']),
    payload: z.record(z.unknown()),
  })
  .strict();

const choreFrequency = z.enum(['ukentlig', '14_dager', 'etter_behov', 'weekly', 'interval']);

const choreCreateBody = z
  .object({
    task: z.string().min(1).max(200),
    details: z.string().max(1000).optional().nullable(),
    frequency: choreFrequency,
    defaultDay: dayOfWeek.optional().nullable(),
    icon: z.string().max(16).optional().nullable(),
    assigneeMemberId: positiveId.optional().nullable(),
    intervalDays: z.number().int().positive().optional().nullable(),
    active: z.boolean().optional(),
  })
  .strict();

const choreUpdateBody = z
  .object({
    task: z.string().min(1).max(200).optional(),
    details: z.string().max(1000).optional().nullable(),
    frequency: choreFrequency.optional(),
    defaultDay: dayOfWeek.optional().nullable(),
    icon: z.string().max(16).optional().nullable(),
    assigneeMemberId: positiveId.optional().nullable(),
    intervalDays: z.number().int().positive().optional().nullable(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });

// ============================================================
// Consumables
// ============================================================

const consumableUpdateBody = z
  .object({
    name: z.string().optional(),
    autoAdd: z.boolean().optional(),
    depletionRate: z.number().nonnegative().optional(),
    reorderThreshold: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    estPrice: z.number().nonnegative().optional(),
    packName: z.string().optional(),
    packSize: z.number().positive().optional(),
  })
  .strict();

const consumableBoughtBody = z.object({
  qty: z.number().positive().optional(),
});

// ============================================================
// Calendar
// ============================================================

const calendarEventBody = z.object({
  title: z.string().min(1).max(200),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato (YYYY-MM-DD)')
    .refine(isValidDate, { message: 'Datoen finnes ikke' }),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Ugyldig tid (HH:MM)')
    .optional()
    .nullable(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Ugyldig tid (HH:MM)')
    .optional()
    .nullable(),
  location: z.string().max(200).optional().nullable(),
  allDay: z.boolean().optional(),
  notes: z.string().max(1000).optional().nullable(),
});

const calendarQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidDate, { message: 'Ugyldig fra-dato' })
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidDate, { message: 'Ugyldig til-dato' })
    .optional(),
});

// ============================================================
// LLM / KB
// ============================================================

const llmChatBody = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      })
    )
    .max(100)
    .optional(),
  saveToKB: z.boolean().optional(),
});

const llmRecipeBody = z.object({
  query: z.string().min(1).max(500),
});

// ============================================================
// Recipe import (Iterasjon 3b fase D)
// ============================================================

const recipeImportTextBody = z
  .object({
    text: z.string().min(20).max(8000),
    title: z.string().min(1).max(200).optional(),
    sourceUrl: z.string().url().max(500).optional(),
    language: z.enum(['no', 'en', 'auto']).optional(),
  })
  .strict();

const recipeIngredientBody = z
  .object({
    name: z.string().min(1).max(200),
    qty: z.number(),
    unit: z.string().min(1).max(50),
    optional: z.boolean().optional(),
    productKey: z.string().min(1).max(100).optional(),
  })
  .strict();

const recipeCreateBody = z
  .object({
    name: z.string().min(1).max(200),
    category: z.enum(['rask', 'comfort', 'helg']),
    prepTime: z.string().optional(),
    servings: z.number().int().positive().optional(),
    notes: z.string().optional(),
    url: z.string().optional(),
    ingredients: z.array(recipeIngredientBody).optional(),
  })
  .strict();

const recipeUpdateBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    category: z.enum(['rask', 'comfort', 'helg']).optional(),
    prepTime: z.string().optional(),
    servings: z.number().int().positive().optional(),
    notes: z.string().optional(),
    url: z.string().optional(),
    ingredients: z.array(recipeIngredientBody).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const kbSearchQuery = z.object({
  q: z.string().max(500).optional(),
});

// ============================================================
// Pantry (Iterasjon 1 — manuell inventory-justering)
// ============================================================

// Phase F: productKey and query are now alternatives — if productKey is missing
// the server runs the resolver on query. qty can be integer or decimal.
// total + unit er nye valgfrie felter for Fase F progress-bar og lav-terskel.
const pantryAddBody = z
  .object({
    productKey: z.string().min(1).max(100).optional(),
    query: z.string().min(1).max(200).optional(),
    qty: z.number().positive(),
    total: z.number().positive().optional(),
    unit: z.string().max(20).optional(),
    shelfDays: z.number().int().positive().max(3650).optional(),
    expiresEst: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato (YYYY-MM-DD)')
      .refine(isValidDate, { message: 'Datoen finnes ikke' })
      .optional(),
    // Optional purchase date — when set, overrides last_purchased (default = today).
    purchasedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato (YYYY-MM-DD)')
      .refine(isValidDate, { message: 'Datoen finnes ikke' })
      .optional(),
    category: z.string().min(1).max(50).optional(),
    notes: z.string().max(500).optional(),
    reason: z.enum(['manual', 'initial_seed', 'correction']).optional(),
  })
  .strict()
  .refine((d) => !!d.productKey || !!d.query, { message: 'productKey or query must be provided' });

const pantryCorrectBody = z
  .object({
    productKey: z.string().min(1).max(100),
    newQty: z.number().nonnegative(),
    newTotal: z.number().positive().optional(),
    newUnit: z.string().max(20).optional(),
    // Optional update of the purchase date.
    purchasedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato (YYYY-MM-DD)')
      .refine(isValidDate, { message: 'Datoen finnes ikke' })
      .optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

// PR A.2 — shelf-life observations.
// POST /api/shopping/items/:id/expiry — body carries only the expiry.
// The server resolves purchasedAt from the shopping row's bought_at.
const shoppingItemExpiryBody = z
  .object({
    expiresAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato (YYYY-MM-DD)')
      .refine(isValidDate, { message: 'Datoen finnes ikke' }),
  })
  .strict();

// PUT /api/pantry/expiry — body carries productKey + expiresAt and an
// optional purchasedAt override (defaults to inventory.last_purchased).
const pantryExpiryBody = z
  .object({
    productKey: z.string().min(1).max(100),
    expiresAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato (YYYY-MM-DD)')
      .refine(isValidDate, { message: 'Datoen finnes ikke' }),
    purchasedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato (YYYY-MM-DD)')
      .refine(isValidDate, { message: 'Datoen finnes ikke' })
      .optional(),
  })
  .strict();

// ============================================================
// Receipts (Iterasjon 2)
// ============================================================

const receiptConfirmBody = z
  .object({
    receiptId: positiveId,
    items: z
      .array(
        z.object({
          id: positiveId,
          productKey: z.string().min(1).max(100).nullable().optional(),
          productName: z.string().min(1).max(200).optional(),
          qty: z.number().positive().optional(),
          unit: z.string().max(20).optional(),
          totalPrice: z.number().nonnegative().optional(),
          confirmed: z.boolean().optional(),
        })
      )
      .optional(),
  })
  .strict();

const receiptListQuery = z.object({
  status: z.enum(['pending', 'confirmed', 'rejected', 'failed']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

// ============================================================
// Price references (Iterasjon 1)
// ============================================================

const priceLookupQuery = z.object({
  productKey: z.string().min(1).max(100).optional(),
  ean: z.string().min(6).max(20).optional(),
});

const priceSearchQuery = z.object({
  q: z.string().min(1).max(200),
});

// ============================================================
// Family profile (Fase F3 + Migration 013)
// ============================================================

const profileMember = z.union([
  z.string(),
  z.object({ name: z.string(), age: z.number().optional() }),
]);

const profileUpdateBody = z.object({
  members: z.array(profileMember).optional(),
  allergies: z.array(z.string()).optional(),
  dislikes: z.array(z.string()).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  preferredChain: z.string().min(1).max(100).nullable().optional(),
  secondaryChain: z.string().min(1).max(100).nullable().optional(),
});

// ============================================================
// Auth / onboarding
// ============================================================

// POST /api/auth/onboarding/complete
//
// Atomic onboarding payload. The frontend collects family-name (Step 1)
// and personal profile (Step 2) into local state and submits both in a
// single request once the user clicks "Done". The handler then runs
// one transaction that creates the family, the matching profile-member
// row, sets the user's role to 'owner', stores the slider value on
// users.portion_factor, flips onboarding_completed=1, and writes an
// audit-log entry. Either everything commits or nothing does — closing
// the tab between steps no longer leaves a zombie family behind.
//
// portion_factor range follows the tightened CHECK constraint from
// migration 023 (0.1-2.0). category is the display category for portion
// scaling and is independent from users.role; the role is always set to
// 'owner' inside the handler because the user is creating their own
// family.
const onboardingCompleteBody = z
  .object({
    family: z
      .object({
        name: z.string().trim().min(1).max(100),
      })
      .strict(),
    user: z
      .object({
        name: z.string().trim().min(1).max(100),
        category: z.enum(['adult', 'teen', 'child']),
        portionFactor: z.number().min(0.1).max(2.0),
      })
      .strict(),
  })
  .strict();

// ============================================================
// Sunday push
// ============================================================

const sundayAcceptBody = z.object({
  weekYear,
  meals: z
    .array(
      z.object({
        dayOfWeek,
        recipeId: positiveId.optional(),
        status: mealStatus.optional(),
        recipe: z.object({ id: positiveId }).optional(),
      })
    )
    .length(7),
});

// ============================================================
// Params
// ============================================================

const idParam = z.object({ id: z.coerce.number().int().positive() });
const weekYearParam = z.object({ weekYear });
const dayOfWeekParam = z.object({ dayOfWeek: z.coerce.number().int().min(0).max(6) });

module.exports = {
  mealsSwapBody,
  mealsStatusBody,
  mealsReorderBody,
  mealApplyDeductionBody,
  pantrySuggestionBody,
  pantrySuggestionAcceptBody,
  shoppingCheckBody,
  shoppingAddBody,
  shoppingGenerateBody,
  shoppingItemBoughtBody,
  shoppingItemAddBody,
  chorePostponeBody,
  choreCompleteBody,
  choreStatsQuery,
  familyGamificationBody,
  familyBackupImportBody,
  choreCreateBody,
  choreUpdateBody,
  consumableUpdateBody,
  consumableBoughtBody,
  calendarEventBody,
  calendarQuerySchema,
  llmChatBody,
  llmRecipeBody,
  kbSearchQuery,
  sundayAcceptBody,
  pantryAddBody,
  pantryCorrectBody,
  shoppingItemExpiryBody,
  pantryExpiryBody,
  priceLookupQuery,
  priceSearchQuery,
  profileUpdateBody,
  onboardingCompleteBody,
  receiptConfirmBody,
  receiptListQuery,
  recipeImportTextBody,
  recipeCreateBody,
  recipeUpdateBody,
  idParam,
  weekYearParam,
  dayOfWeekParam,
};

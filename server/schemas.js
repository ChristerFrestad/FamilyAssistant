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
    { message: 'Ukenummer må være mellom 01 og 53' }
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
  })
  .strict();

const shoppingItemBoughtBody = z
  .object({
    qty: z.number().positive().optional(),
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

const kbSearchQuery = z.object({
  q: z.string().max(500).optional(),
});

// ============================================================
// Pantry (Iterasjon 1 — manuell inventory-justering)
// ============================================================

// Fase F: productKey og query er nå alternative — hvis productKey mangler
// kjører server-siden resolver på query. qty kan være hel- eller decimaltall.
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
    category: z.string().min(1).max(50).optional(),
    notes: z.string().max(500).optional(),
    reason: z.enum(['manual', 'initial_seed', 'correction']).optional(),
  })
  .strict()
  .refine((d) => !!d.productKey || !!d.query, { message: 'productKey eller query må være satt' });

const pantryCorrectBody = z
  .object({
    productKey: z.string().min(1).max(100),
    newQty: z.number().nonnegative(),
    newTotal: z.number().positive().optional(),
    newUnit: z.string().max(20).optional(),
    notes: z.string().max(500).optional(),
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
  pantrySuggestionBody,
  pantrySuggestionAcceptBody,
  shoppingCheckBody,
  shoppingAddBody,
  shoppingGenerateBody,
  shoppingItemBoughtBody,
  chorePostponeBody,
  choreCompleteBody,
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
  priceLookupQuery,
  priceSearchQuery,
  profileUpdateBody,
  receiptConfirmBody,
  receiptListQuery,
  recipeImportTextBody,
  idParam,
  weekYearParam,
  dayOfWeekParam,
};

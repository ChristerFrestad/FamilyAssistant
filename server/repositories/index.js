'use strict';

const { createProductRepos } = require('./product.repo');
const { createRecipeRepos } = require('./recipe.repo');
const { createInventoryRepos } = require('./inventory.repo');
const { createMealRepos } = require('./meal.repo');
const { createChoreRepos } = require('./chore.repo');
const { createChoreCompletionRepos } = require('./chore-completion.repo');
const { createShoppingRepos } = require('./shopping.repo');
const { createPricingRepos } = require('./pricing.repo');
const { createReceiptRepos } = require('./receipt.repo');
const { createSystemRepos } = require('./system.repo');
const { createAuthRepo } = require('./auth.repo');
const { createFamilyRepo } = require('./family.repo');
const { createLlmConfigRepo } = require('./llm-config.repo');
const { createFeedbackRepo } = require('./feedback.repo');
const { createShelfObservationRepo } = require('./shelf-observation.repo');
const { createPilotPasswordAttemptsRepo } = require('./pilot-password-attempts.repo');
const { createCalendarRepos } = require('./calendar.repo');

function tryParseJson(s) {
  if (typeof s !== 'string' || s.length === 0) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function createRepositories(db) {
  const { products } = createProductRepos(db);
  const { recipes, recipeSources } = createRecipeRepos(db, tryParseJson);
  const { inventory, inventoryLog } = createInventoryRepos(db);
  const { mealPlans, mealHistory, sundayDrafts } = createMealRepos(db, tryParseJson);
  const { chores, choreSchedules } = createChoreRepos(db);
  const { choreCompletions } = createChoreCompletionRepos(db);
  const { shoppingLists, shoppingExtras } = createShoppingRepos(db, tryParseJson);
  const { consumables, purchaseLog, priceReferences, priceHistory } = createPricingRepos(db);
  const { receipts, receiptItems, kassalProducts, productResolutions, kassalCache } =
    createReceiptRepos(db);
  const {
    kb,
    notifications,
    llmCache,
    llmAudit,
    stateSnapshots,
    familyProfile,
    filterUsage,
    auditLog,
    hasFTS,
  } = createSystemRepos(db, tryParseJson);
  const { calendar, calendarIntegrations } = createCalendarRepos(db);
  const auth = createAuthRepo(db);
  const family = createFamilyRepo(db);
  const llmConfig = createLlmConfigRepo(db);
  const feedback = createFeedbackRepo(db);
  const shelfObservations = createShelfObservationRepo(db);
  const pilotPasswordAttempts = createPilotPasswordAttemptsRepo(db);

  return {
    _db: db,
    auth,
    family,
    llmConfig,
    feedback,
    products,
    recipes,
    inventory,
    mealPlans,
    chores,
    choreSchedules,
    choreCompletions,
    shoppingExtras,
    shoppingLists,
    consumables,
    kb,
    calendar,
    calendarIntegrations,
    notifications,
    purchaseLog,
    mealHistory,
    sundayDrafts,
    llmAudit,
    llmCache,
    inventoryLog,
    priceReferences,
    priceHistory,
    stateSnapshots,
    receipts,
    receiptItems,
    kassalProducts,
    productResolutions,
    kassalCache,
    familyProfile,
    filterUsage,
    recipeSources,
    auditLog,
    shelfObservations,
    pilotPasswordAttempts,
    hasFTS,
    transaction: (fn) => db.transaction(fn),
  };
}

module.exports = { createRepositories };

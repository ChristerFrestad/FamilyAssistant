'use strict';

const { runWithFamily } = require('../auth/family-context');

function mondayOf(weekYear) {
  const year = Number(String(weekYear).slice(0, 4));
  const week = Number(String(weekYear).slice(6));
  if (!year || !week) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (dow - 1) + (week - 1) * 7);
  return monday;
}

function isoDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function agendaForFamily(repos, familyId, from, to) {
  return runWithFamily(familyId, () => {
    const weeks = repos._db
      .prepare(
        `SELECT DISTINCT week_year AS weekYear FROM meal_plans
          WHERE family_id = ? AND meal_type = 'middag'`
      )
      .all(familyId)
      .map((row) => row.weekYear);
    const items = [];
    for (const weekYear of weeks) {
      const monday = mondayOf(weekYear);
      if (!monday) continue;
      for (const slot of repos.mealPlans.getWeek(weekYear)) {
        if (!slot.recipeId) continue;
        if (slot.status === 'away' || slot.status === 'skipped' || slot.status === 'removed')
          continue;
        const date = isoDate(addDays(monday, slot.dayOfWeek));
        if (date < from || date > to) continue;
        const recipe = repos.recipes.getById(slot.recipeId);
        items.push({
          id: `dinner-${weekYear}-${slot.dayOfWeek}`,
          kind: 'dinner',
          date,
          title: `Middag: ${recipe?.name || 'Middag'}`,
          startTime: '17:00',
          readOnly: true,
        });
      }
      for (const slot of repos.choreSchedules.getWeek(weekYear)) {
        const dayIndex =
          slot.postponedTo != null && slot.postponedTo >= 0 ? slot.postponedTo : slot.scheduledDay;
        if (dayIndex == null || dayIndex < 0) continue;
        const date = isoDate(addDays(monday, dayIndex));
        if (date < from || date > to) continue;
        const chore = repos.chores.getAll().find((item) => item.id === slot.choreId);
        items.push({
          id: `chore-${weekYear}-${slot.choreId}`,
          kind: 'chore',
          date,
          title: `Gjøremål: ${chore?.task || 'Gjøremål'}`,
          allDay: true,
          readOnly: true,
        });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'nb'));
    return items;
  });
}

module.exports = { agendaForFamily };

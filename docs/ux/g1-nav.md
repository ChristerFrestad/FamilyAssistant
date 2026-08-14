# G1 UX spec — Navigation

Companion to `docs/ux/g1-chores-recipes.md`. Implementers change
`nav-items.ts`, `BottomNav`, `SideNav`, and `UserMenu` to this map.
Visual language is unchanged: ink pill on mobile, ink row on desktop,
mint focus ring.

Recipes stay **off** every primary rail. They remain reachable from
Meals (`meals:actions.openLibrary`) and from in-app back links.

---

## Locked IA

### Mobile BottomNav — still exactly 5

| Order | `id` | `to` | Icon (lucide) | i18n |
|---|---|---|---|---|
| 1 | `dashboard` | `/dashboard` | `Home` | `common:nav.dashboard` |
| 2 | `chores` | `/chores` | `CheckSquare` | `common:nav.chores` |
| 3 | `meals` | `/meals` | `Utensils` | `common:nav.meals` |
| 4 | `shopping` | `/shopping` | `ShoppingCart` | `common:nav.shopping` |
| 5 | `calendar` | `/calendar` | `Calendar` | `common:nav.calendar` |

Family **leaves** the bar. Five touch targets is the ceiling
(`BottomNav.test.tsx` already locks `PRIMARY_NAV_ITEMS.length === 5`).

Active treatment unchanged: only the current item shows its label;
inactive items are icon + `aria-label`. `/` still highlights Dashboard.
`/chores/...` highlights Chores the same way `/meals/add` highlights
Meals.

### Desktop SideNav

**Primary** (top, no divider)

| Order | `id` | `to` | Icon | i18n |
|---|---|---|---|---|
| 1 | `dashboard` | `/dashboard` | `Home` | `common:nav.dashboard` |
| 2 | `family` | `/family` | `Users` | `common:nav.family` |
| 3 | `chores` | `/chores` | `CheckSquare` | `common:nav.chores` |
| 4 | `meals` | `/meals` | `Utensils` | `common:nav.meals` |
| 5 | `shopping` | `/shopping` | `ShoppingCart` | `common:nav.shopping` |
| 6 | `calendar` | `/calendar` | `Calendar` | `common:nav.calendar` |

**Secondary** (bottom, existing hairline + `mt-auto`)

| `id` | `to` | Icon | i18n |
|---|---|---|---|
| `settings` | `/settings` | `Settings` | `common:nav.settings` |

Family stays on desktop because the rail has room. It is **not** a
sixth BottomNav item.

### UserMenu (mobile home for Family)

Family moves next to Settings, same menu dialect as
`common:userMenu.account`.

Current items:

1. Header (name + email)
2. `userMenu.account` → `/settings`
3. `userMenu.logout`

G1 items:

1. Header (name + email)
2. `userMenu.family` → `/family`  **new**
3. `userMenu.account` → `/settings`
4. `userMenu.logout`

Both Family and Account are `role="menuitem"` `Link`s. Click still
closes the menu (existing `onClick={() => setOpen(false)}`).

Child and adult see the same menu. Family screen already handles
child read-only.

On **desktop**, UserMenu still lists Family. Duplicate with SideNav is
acceptable — same as Account duplicating the Settings row.

---

## Source of truth in code

Split the single `PRIMARY_NAV_ITEMS` array. Suggested shape in
`client/src/app/components/layout/nav-items.ts`:

```ts
export const MOBILE_NAV_ITEMS = [
  dashboard, chores, meals, shopping, calendar,
] as const; // length 5

export const DESKTOP_NAV_ITEMS = [
  dashboard, family, chores, meals, shopping, calendar,
] as const; // length 6

export const SECONDARY_NAV_ITEMS = [settings] as const;
```

- `BottomNav` maps `MOBILE_NAV_ITEMS`.
- `SideNav` maps `DESKTOP_NAV_ITEMS` + `SECONDARY_NAV_ITEMS`.
- Keep a deprecated alias only if tests need a rename commit split;
  prefer updating tests in the same change.

**Tests to update (do not weaken)**

- `BottomNav.test.tsx`: still 5 items; **Familie** assertion becomes
  **Gjøremål** (`common:nav.chores`). Add `/chores` highlight case.
  `/family` must **not** highlight any bottom item.
- `SideNav.test.tsx`: 6 primary + Settings. Assert Family + Chores
  both present. `/family` highlights Family; `/chores` highlights
  Chores.
- `UserMenu.test.tsx`: open menu exposes Family + Min konto + Logg ut.
- `a11y.test.tsx`: still passes axe on both navs.

---

## Copy

Add to `common` (both locales). Do not edit JSON in the spec PR.

| Key | EN | NO |
|---|---|---|
| `nav.chores` | Chores | Gjøremål |
| `userMenu.family` | Family | Familie |

Existing `nav.family`, `nav.meals`, `nav.shopping`, `nav.calendar`,
`nav.settings`, `userMenu.account` stay.

---

## What does not move

| Surface | Rule |
|---|---|
| `/recipes`, `/recipes/new`, `/recipes/:id` | No nav item, no UserMenu entry |
| `/admin` | Unchanged, out of band |
| `/settings` | UserMenu + SideNav secondary only |
| Wordmark | Still `/dashboard` |
| Theme + language | Still header utilities, not nav items |

---

## Follow-through on other screens

When Chores ships:

- Dashboard empty-chore CTA (`dashboard:empty.addChore`) navigates to
  `/chores`, not `/family`.
- Dashboard “today’s chores” card title can link through to `/chores`
  (optional; if added, use the existing `dashboard:actions.viewAll`
  pattern, do not invent a fourth CTA style).

---

## Child vs adult

Nav chrome is identical for both roles. Permission differences live
**inside** the screens (see the chores/recipes spec), not in the rail.

---

## Visual non-goals

- Do not add a sixth BottomNav item “because desktop has Family”.
- Do not put Recipes on the rail “because G1 is recipes”.
- Do not restyle the ink active pill or the glass bar.
- Do not add XP / streak badges on the Chores nav icon.

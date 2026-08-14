# G1 UX spec — Chores + Recipes

Implementers code these screens from this document. Do not invent a
second visual system. Extend the existing forest/cream tokens in
`client/src/app/styles/tokens.css` and `docs/BRAND_SYSTEM.md`.

**Routes**

| Path | Screen | Nav |
|---|---|---|
| `/chores` | Chores week board | Primary (mobile + desktop) |
| `/recipes` | Recipe library | Off primary nav; linked from Meals |
| `/recipes/new` | Recipe editor (create) | Adult only |
| `/recipes/:id` | Recipe editor / detail | Adult edit, child read-only |

**Locked product rules**

- Existing fonts only (`font-display` = Instrument Serif, `font-body` =
  Geist). No new webfonts.
- No purple gradients. No second radius/shadow scale. No XP, streak,
  leaderboard, or `Ring` UI.
- BottomNav stays five items. Recipes stay off primary nav. See
  `docs/ux/g1-nav.md`.
- Copy goes through `react-i18next`. This spec lists keys and example
  strings — **do not edit locale JSON in the spec PR**.
- Roles: `owner` and `adult` share the adult surface. `child` is the
  reduced surface. Never hide a control with CSS; omit it from the tree.

**Breakpoints (code against these two widths)**

| Width | Name | Shell |
|---|---|---|
| 375 | Mobile | BottomNav, `px-4`, FAB for adult create |
| 1280 | Desktop | SideNav, `md:px-6`, header primary button instead of FAB |

Content lives in AppShell `<main>` (`max-w-7xl`, `pb-24` mobile /
`md:pb-8` desktop). Do not change shell padding.

---

## 0. Shared visual language

Reuse, do not restyle.

| Token / utility | Use |
|---|---|
| `font-display text-display-md text-text-1` | Screen `h1` |
| `font-display text-card text-text-1` | Card / section `h2` |
| `font-body text-body text-text-1` | Task / recipe names, body |
| `font-body text-meta text-text-2` / `text-text-3` | Subtitle, meta |
| `font-body text-meta uppercase tracking-wider text-text-3` | Eyebrow (Meals week label) |
| `bg-surface` + `border-stroke` + `rounded-lg` | `Card` default |
| `bg-mint` / `text-ink-contrast` | Primary actions |
| `--brand-dot` `#7BA05B` | Complete settle colour |
| `text-rose-deep` + `bg-rose/10` + `border-rose/30` | Overdue (muted, not alarm) |
| `focus-visible:ring-2 focus-visible:ring-mint` | All controls |
| Modal 200 ms enter/exit | Existing `Modal` — do not retune |

**Motion**

- Complete: 180 ms scale-to-dot, then settle. See §2.5.
- Modal: keep `Modal` 200 ms.
- `prefers-reduced-motion: reduce` → skip scale; snap to the settled
  state. No other decorative motion.

**Child vs adult (applies on every screen in this spec)**

| Control | Child | Adult / owner |
|---|---|---|
| Read list / detail | Yes | Yes |
| Complete / undo | Yes, with assignment rule §2.5 | Yes, any chore |
| Postpone | No | Yes, pending only |
| Add / edit chore definition | No | Yes |
| Add / edit / import / deactivate recipe | No | Yes |
| FAB / header create | Omit | Show |

---

## 1. `/chores` — Chores screen

### 1.1 Layout

```
<section aria-labelledby="chores-heading" class="flex flex-col gap-4">
  <header>                          <!-- eyebrow + h1 + week + adult CTA -->
  DayStrip                          <!-- 7 day pills, Meals visual contract -->
  selected-day list                 <!-- ChoreRow cards -->
  week summary                      <!-- 7 compact rows, Meals WeekList language -->
</section>
FAB                                 <!-- adult, mobile only, portal/fixed -->
AddChoreModal                       <!-- adult -->
```

**Header (375)**

```
[ Gjøremål / Chores          ]          h1#chores-heading
[ Uke 2026-W33               ]          text-meta text-text-2
```

Eyebrow above the title, same as Meals:

- `chores:weekHeader.label` — EN `This week` / NO `Denne uken`
- `h1` — `chores:title`
- Week line when `weekYear` is known — `chores:weekHeader.week`

XP / streak **placeholder only**: a code comment in the header

```tsx
{/* G2: chores-xp-slot — Ring + week goal. Do not render. */}
```

Do not render a hidden node, a `Ring`, a flame, or a count of XP.

**Header (1280)**

Same stack, plus an adult primary `Button` on the right:

- `chores:actions.add` — EN `Add chore` / NO `Ny oppgave`
- `data-testid="chores-add"`

Use `flex items-start justify-between` like Meals’ title + library link.

**Day strip**

Reuse the **Meals DayStrip visual contract**, not a new chip style.

Do **not** pass `MealSlot[]` into `DayStrip`. Build
`client/src/app/components/chores/ChoresDayStrip.tsx` that copies the
class strings, sizes, and ARIA from
`client/src/app/components/meals/DayStrip.tsx`:

- Pill: `min-w-[72px]`, `rounded-lg`, `border`, `px-3 py-2`
- Selected: `border-mint bg-surface-strong text-text-1`
- Idle: `border-stroke bg-surface text-text-2`
- Short day labels: reuse `meals:daysShort.0..6` (do not duplicate)
- Today: `meals:todayLabel` under the day name, `text-mint`
- Dot:
  - `bg-mint` — selected day has at least one **pending** chore
  - `bg-rose` — selected day has at least one **overdue** pending chore
    (overdue wins over mint)
  - `bg-stroke-strong` — no pending chores
- `aria-pressed` on the selected pill
- `aria-current="date"` on today
- `nav aria-label={t('chores:dayStripAria')}`
- Horizontal scroll on 375 (`-mx-4 overflow-x-auto px-4`); no scroll
  needed at 1280 if seven pills fit.

Default selection: today. Persist only in component state (not URL) in
G1, matching Meals.

**Selected-day list**

A `ul` of `ChoreRow` cards (`Card padding="md" shadow="low"`).

Order: overdue pending → pending → done. Stable secondary sort:
`choreId`.

**Week summary**

Below the list, a `WeekList`-shaped section (`chores:weekList.heading`).
Seven rows: long day name, `N pending` / empty, tap selects that day.
Overdue days: pending count in `text-rose-deep`, not coral. Today gets
the same mint “today” meta as Meals `WeekList`.

**FAB (375, adult only)**

```
position: fixed
right: 1rem          /* 16px */
bottom: 5.5rem       /* above BottomNav + gradient */
size: 56 × 56
shape: rounded-full
bg-mint text-ink-contrast shadow-mid
icon: lucide Plus, 24, aria-hidden
aria-label: chores:actions.add
data-testid: chores-fab
```

Omit on `md+` and for children. Do not add a second create control on
mobile (header button is desktop-only).

**Modal**

`Modal` from `overlay/Modal.tsx`.

- 375: `position="bottom"` `size="full"`
- 1280: `position="center"` `size="md"`
- Title: `chores:addModal.title`
- Focus: first field (`task`) on open — `Modal` already focuses the
  first focusable. Keep the close button. Escape / backdrop close
  discards unsaved fields without a confirm in G1 (form is short).

### 1.2 Component reuse map

| Piece | Existing component | Notes |
|---|---|---|
| Page chunk | `layout/Card` | default, `padding="md"`, `shadow="low"` |
| Actions | `base/Button` | primary / secondary / ghost |
| Fields | `form/Field` + `form/Input` | Calendar add-event language |
| Overlay | `overlay/Modal` | InviteMemberModal footer pattern |
| Day pills | New `chores/ChoresDayStrip` | Copy DayStrip classes 1:1 |
| Week rows | New `chores/ChoresWeekList` | Copy `meals/WeekList` spacing |
| Assignee | `display/Avatar` `size="sm"` | Only if `assignedUserId` present |
| Frequency | `display/Badge` | `mint` weekly, `cyan` biweekly, `amber` as-needed |
| Overdue mark | `display/Badge variant="rose"` | Text only, no icon illustration |
| Empty / error | `Card` + `Button variant="secondary"` | Same as Recipes / Meals |
| Member list | `GET /api/family` via `familyApi` | Assignee picker |

Do not use `Ring`. Do not add a chores-specific colour token.

### 1.3 Data contract (what the screen consumes)

`GET /api/chores/current` already returns (see `openapi.yaml` `Chore`):

```
weekYear, chores[]: {
  choreId, task, icon, frequency, details?,
  scheduledDay, postponedTo, effectiveDay, dayName,
  status: 'pending' | 'done' | 'postponed'
}
```

**Overdue (client-computed)**

```
status === 'pending'
&& effectiveDay < todayIndex
&& effectiveDay >= 0
```

`postponed` with `postponedTo === -1` (Friday → next week) is **not**
shown on this week’s strip. Do not invent a “next week” column in G1.

**Assignee (optional G1 backend)**

If the implementer adds `assignedUserId: number | null` and
`assignedName: string | null` to the current-week payload, render
`Avatar`. If those fields are absent, omit the avatar slot — do not
fake assignment from seed icons.

**Create (adult) — backend does not exist yet**

`POST /api/chores` `requireRole('adult')`. Body the modal submits:

```json
{
  "task": "Take out the rubbish",
  "details": "Thursday evening, ready for Friday collection",
  "frequency": "ukentlig",
  "defaultDay": 3,
  "icon": "🗑️",
  "assignedUserId": 12
}
```

| Field | Required | Rules |
|---|---|---|
| `task` | yes | trim, 2–80 chars |
| `details` | no | trim, max 240 |
| `frequency` | yes | `ukentlig` \| `14_dager` \| `etter_behov` (existing seed enum) |
| `defaultDay` | yes unless `etter_behov` | `0..6` (Mon..Sun). Hidden + sent `null` when as-needed |
| `icon` | no | one emoji from the preset list; default `✅` |
| `assignedUserId` | no | family `users[].id` or omit |

On 201, close modal, refetch `GET /api/chores/current`, select
`defaultDay` (or today if as-needed).

### 1.4 States

Every state below is required. Mirror Meals testids.

#### Loading

`role="status" aria-live="polite" data-testid="chores-skeleton"`

- 7 pulse pills `h-16 w-[72px] rounded-lg bg-stroke-strong`
- 3 `Card` skeletons (meta bar + title bar), same as Recipes
- `sr-only` `common:status.loading`

Header title still renders (not inside the skeleton).

#### Error

`Card data-testid="chores-error"` `role="alert"`

- Body: `chores:errors.loadFailed`
- `Button variant="secondary"` `chores:actions.retry`

No strip, no FAB action that depends on week data (FAB may stay; submit
fails with the same error surface inside the modal).

#### Empty week (200, `chores.length === 0`)

`Card data-testid="chores-empty"`

- `h2` `chores:empty.weekTitle`
- Body `chores:empty.weekBody`
- Adult: primary `chores:actions.add` opens the modal
- Child: no CTA; body only

Still render the DayStrip (all dots muted) so the week is tangible.

#### Empty selected day (week has chores, this day has none)

`Card data-testid="chores-day-empty"`

- `chores:empty.dayTitle` / `chores:empty.dayBody`
- Adult secondary “Add for this day” pre-fills `defaultDay` with the
  selected index

#### Data — adult

Full row controls. FAB / header add visible.

#### Data — child

Same list. No FAB, no header add, no postpone, no assignee picker.
Complete control follows §2.5.

### 1.5 `ChoreRow` — anatomy

```
[ complete ]  [ icon + task                    ] [ avatar ]
              [ RecurBadge · assignee · overdue ]
              [ postpone | undo ]                 <!-- adult / allowed -->
```

- Complete control: 44×44 hit target (padding around a 22×22 circle).
  Unchecked: `border-stroke` circle. Done: filled `--brand-dot`.
- Title: `font-body text-body`. Done → `text-text-3` +
  `line-through decoration-stroke-strong`.
- Icon is the seed emoji, `aria-hidden`. Do not invent new illustrations.
- `data-testid={`chore-row-${choreId}`}`
- Complete: `data-testid={`chore-complete-${choreId}`}`

**Overdue treatment (muted rose, not alarmist)**

- Card: `border-rose/30` and `bg-rose/10` (keep `bg-surface` underneath
  — use `className` on `Card`, do not introduce a new variant).
- Badge `variant="rose"`: `chores:status.overdue`
- No pulse, no shake, no `coral`, no uppercase “OVERDUE!!”, no banner
  at the top of the screen.

**Postponed pending** (status `postponed`, `effectiveDay` still this
week): same as pending, plus meta `chores:status.postponedTo` with the
long day name.

### 1.6 Interactions

#### Complete

`PUT /api/chores/complete` `{ weekYear?, choreId }`

Who:

- Adult / owner: any pending chore.
- Child: pending chore that is **unassigned** or **assigned to the
  current user**. If `assignedUserId` is not on the payload, treat every
  chore as unassigned (matches today’s API: any member may complete).
- Child cannot complete a chore assigned to someone else — hide the
  control, do not disable-and-explain.

Optimistic: flip to done immediately, run the 180 ms animation, then
settle. On 4xx/5xx: revert and `role="alert"` `chores:errors.completeFailed`.

**Animation (locked)**

```
duration: 180ms
easing: cubic-bezier(0.22, 1, 0.36, 1)
0ms   scale(1.00)  border-stroke, fill transparent
~70ms scale(1.16)  background: var(--brand-dot)   /* #7BA05B */
180ms scale(1.00)  background: var(--brand-dot)   /* settle */
```

Then apply title mute + strikethrough. Do not bounce. Do not play a
second check-draw animation.

`aria-pressed="true"` when done, `"false"` when pending. Accessible
name: `chores:actions.complete` / `chores:actions.completed` with
`{{task}}`.

Announce via a visually hidden `aria-live="polite"` region:
`chores:live.completed`.

#### Undo

`PUT /api/chores/undone` `{ weekYear?, choreId }`

- Visible on `done` rows.
- Adult: always.
- Child: only if they are allowed to complete that chore (same rule).
- Instant revert to pending. No reverse scale. Live: `chores:live.undone`.
- No time window in G1.

#### Postpone

`PUT /api/chores/postpone` `{ weekYear?, choreId }` — **already
`requireRole('adult')`**.

- Adult + `status === 'pending'` only.
- Ghost `Button size="sm"` `chores:actions.postpone`.
- Existing server rule (do not reimplement in the client):
  - `effectiveDay < 4` (Mon–Thu) → next calendar day this week
  - `effectiveDay === 4` (Fri) → next week Monday, this week row
    disappears (`postponedTo = -1`)
  - Sat/Sun (`> 4`): server no-ops — hide the button those days
- After success: live `chores:live.postponed` with the destination
  day, or `chores:live.postponedNextWeek` for the Friday case.
- On error: `chores:errors.postponeFailed`.

Do not open a day-picker. One tap = one day later. That is the G1
product.

#### Add chore modal fields

Match Calendar’s `Field` + `Input` stack and InviteMemberModal’s
footer (`flex-row-reverse`, primary then secondary).

| Field | Control | i18n | Validation |
|---|---|---|---|
| Task | `Input` required | `chores:fields.task` | 2–80, trim |
| Details | `textarea` 3 rows | `chores:fields.details` | max 240, counter like invite |
| Frequency | 3 `aria-pressed` cards | `chores:frequency.*` | one required |
| Default day | 7 day pills (reuse strip classes, compact) | `chores:fields.defaultDay` | required if not as-needed |
| Icon | 8–12 emoji buttons, `aria-pressed` | `chores:fields.icon` | optional |
| Assignee | radio list: Anyone + `users[]` with `Avatar` | `chores:fields.assignee` | optional |

Frequency card copy:

| value | EN | NO |
|---|---|---|
| `ukentlig` | Weekly | Ukentlig |
| `14_dager` | Every 2 weeks | Hver 14. dag |
| `etter_behov` | As needed | Etter behov |

Icon preset (existing seed, do not grow):
`🧹 🏠 ✨ 🌿 🛏️ 🚿 🗑️ ❄️ ♻️ 👕 🍽️ ✅`

Submit: primary `chores:addModal.submit`, disabled until task valid
and (frequency ≠ as-needed ⇒ day chosen). `loading` while POST in
flight. Cancel: `common:actions.cancel`.

Child: this modal is never mounted.

### 1.7 Accessibility

- One `h1#chores-heading`. Day groups and week list use `h2`.
- Strip: `aria-pressed` on the selected day (already in DayStrip).
- Complete: real `<button>`, `aria-pressed`, not a checkbox input
  (keeps the scale animation on one element).
- Modal: existing focus trap, initial focus on task `Input`, restore
  focus to FAB / header button on close.
- Overdue is not colour-only: rose badge text is present.
- Touch targets ≥ 44 px on complete / postpone / FAB.
- Skip-link already in AppShell; do not add another.

### 1.8 i18n keys — `chores` namespace (new)

Do **not** add this file in the spec PR. Implementers add
`client/src/app/i18n/locales/{en,no}/chores.json` and register the
namespace in `config.ts` + `bundles.test.ts`.

Reuse `meals:daysShort.*`, `meals:daysLong.*`, `meals:todayLabel`,
`common:status.loading`, `common:status.tryAgain`,
`common:actions.cancel`.

| Key | EN | NO |
|---|---|---|
| `title` | Chores | Gjøremål |
| `weekHeader.label` | This week | Denne uken |
| `weekHeader.week` | Week {{weekYear}} | Uke {{weekYear}} |
| `dayStripAria` | Choose a day this week | Velg dag denne uken |
| `weekList.heading` | Whole week | Hele uka |
| `weekList.pending` | {{count}} to do | {{count}} igjen |
| `weekList.emptyRow` | Nothing planned | Ingenting planlagt |
| `empty.weekTitle` | No chores this week | Ingen gjøremål denne uken |
| `empty.weekBody` | Add a chore to start the week. | Legg til en oppgave for å komme i gang. |
| `empty.dayTitle` | Nothing on this day | Ingenting denne dagen |
| `empty.dayBody` | Other days still have chores. | Andre dager har fortsatt oppgaver. |
| `errors.loadFailed` | Could not load chores. | Kunne ikke hente gjøremål. |
| `errors.completeFailed` | Could not mark this done. | Kunne ikke markere som gjort. |
| `errors.undoFailed` | Could not undo. | Kunne ikke angre. |
| `errors.postponeFailed` | Could not postpone. | Kunne ikke utsette. |
| `errors.saveFailed` | Could not save the chore. | Kunne ikke lagre oppgaven. |
| `actions.retry` | Try again | Prøv igjen |
| `actions.add` | Add chore | Ny oppgave |
| `actions.addForDay` | Add for this day | Legg til denne dagen |
| `actions.complete` | Mark {{task}} done | Marker {{task}} som gjort |
| `actions.completed` | {{task}} is done. Undo | {{task}} er gjort. Angre |
| `actions.undo` | Undo | Angre |
| `actions.postpone` | Postpone | Utsett |
| `status.overdue` | Overdue | Forfalt |
| `status.postponedTo` | Moved to {{day}} | Flyttet til {{day}} |
| `status.done` | Done | Gjort |
| `live.completed` | {{task}} marked done | {{task}} markert som gjort |
| `live.undone` | {{task}} is open again | {{task}} er åpen igjen |
| `live.postponed` | {{task}} moved to {{day}} | {{task}} flyttet til {{day}} |
| `live.postponedNextWeek` | {{task}} moved to next Monday | {{task}} flyttet til neste mandag |
| `addModal.title` | New chore | Ny oppgave |
| `addModal.submit` | Save chore | Lagre oppgave |
| `fields.task` | Chore | Oppgave |
| `fields.details` | Details | Detaljer |
| `fields.detailsHint` | Optional. What “done” looks like. | Valgfritt. Hva «gjort» betyr. |
| `fields.frequency` | How often | Hvor ofte |
| `fields.defaultDay` | Default day | Fast dag |
| `fields.icon` | Icon | Ikon |
| `fields.assignee` | Assigned to | Tildelt |
| `fields.anyone` | Anyone | Alle |
| `frequency.ukentlig` | Weekly | Ukentlig |
| `frequency.14_dager` | Every 2 weeks | Hver 14. dag |
| `frequency.etter_behov` | As needed | Etter behov |

Also add `common:nav.chores`:

| Key | EN | NO |
|---|---|---|
| `nav.chores` | Chores | Gjøremål |

Dashboard empty CTA currently routes to `/family`. When `/chores`
ships, point `dashboard:empty.addChore` at `/chores`.

---

## 2. Recipes — library + editor

G0-4 shipped a read-only list at `/recipes` with an adult G1 note.
G1 replaces that note with real create / edit / import, and adds
`/recipes/new` and `/recipes/:id`.

Recipes stay **off** BottomNav and SideNav. Entry points:

- Meals header link `meals:actions.openLibrary` (already shipped)
- In-app links from the editor back to `/recipes`

### 2.1 `/recipes` — library

#### Layout

```
<section aria-labelledby="recipes-heading" class="flex flex-col gap-4">
  <header>                 <!-- h1 + description + adult actions -->
  <filter row>             <!-- search + category chips + source chips -->
  <list | empty | error | skeleton>
</section>
ImportUrlSheet             <!-- adult -->
```

**Header (375)**

```
h1#recipes-heading     recipes:title
p                      recipes:description
[ adult only ]         stack: primary New, secondary Import URL
```

**Header (1280)**

Title + description left; adult actions right, same `justify-between`
as Meals.

Remove `recipes:g1Note` from the tree. Keep the key unused until a
later locale cleanup — do not show it.

**Filters** (both roles)

Copy `RecipePickerDialog` language, not a new toolbar.

1. Search `Input` — `recipes:filters.search` placeholder
2. Category chips (`aria-pressed` toggle, multi): `rask` / `comfort` /
   `helg` using existing `recipes:category.*` and the same Badge
   colours (`mint` / `cyan` / `amber`)
3. Source chips (adult + child): `all` | `mine` | `imported` | `ai`
   mapping to `GET /api/recipes?source=` (already on the server).
   Default `all`.

Allergy annotations already on `RecipeSummary`: if
`hiddenByAllergy` or `shownWithDislikeWarning`, show `Badge variant="amber"`
`recipes:meta.allergyWarning`. Do not hide the row — the picker greys
them; the library still lists them so an adult can edit.

**List row**

Upgrade G0-4 `RecipeListItem` to a link:

```tsx
<li>
  <Link to={`/recipes/${id}`} data-testid={`recipe-row-${id}`}>
    <Card> Badge + prepTime + servings ; h2 name ; optional source meta
  </Link>
</li>
```

- Entire card is the hit target. `focus-visible:ring-2 ring-mint` on
  the link.
- Child and adult both navigate. Child lands on read-only detail.
- Inactive recipes: omitted from the default list. Adult-only chip
  `recipes:filters.inactive` reveals them with `Badge` `recipes:status.inactive`.

#### States

| State | testid | What |
|---|---|---|
| Loading | `recipes-skeleton` | Keep the 3 pulse cards from G0-4 |
| Error | `recipes-error` | `recipes:errors.loadFailed` + retry |
| Empty (no rows, no filters) | `recipes-empty` | Title + body; **adult** primary New + secondary Import; **child** body only (update `recipes:empty.body` so it does not promise a future update) |
| Empty (filters hide all) | `recipes-filter-empty` | `recipes:empty.filtered` + “Clear filters” |
| Data | `recipes-list` | Linked cards |
| Child | — | No New, no Import, no inactive toggle, no G1 note |
| Adult | — | New + Import + inactive toggle |

### 2.2 `/recipes/new` and `/recipes/:id` — editor

**Routing**

- Child on `/recipes/new` → `<Navigate to="/recipes" replace />`
- Child on `/recipes/:id` → read-only detail (same fields, no inputs)
- Unknown id → error card + back to library (not a blank editor)
- `:id` load: `GET /api/recipes/:id`

**Layout 375**

Single column `flex flex-col gap-4`, sticky footer above BottomNav:

```
[ Cancel (ghost)          Save (primary) ]
```

`sticky bottom-0 -mx-4 px-4 py-3 bg-canvas-0/90 backdrop-blur`
plus `pb` so it does not sit under the nav (`bottom-20`).

**Layout 1280**

Two columns `grid grid-cols-2 gap-6`:

- Left: identity (name, category, prep, servings, source URL)
- Right: ingredients repeater + notes / equipment

Header actions (Cancel + Save) sit in the page header, no sticky bar.

**Back link**

Ghost text link above `h1`: `recipes:actions.backToLibrary` → `/recipes`.

#### Editor fields

All writable fields go through `Field` + `Input` / native `textarea` /
pressed cards. Calendar is the form dialect.

| Field | Required | Control | Persist |
|---|---|---|---|
| `name` | yes | `Input` | `recipes.name` max 200 |
| `category` | yes | 3 `aria-pressed` cards | `rask` \| `comfort` \| `helg` |
| `prepTime` | no | `Input` text, placeholder `25 min` | `prep_time` |
| `servings` | no | `Input type="number" min=1` | integer ≥ 1 or omit |
| `url` | no | `Input type="url"` | `url` |
| `notes` | no | `textarea` 6 rows | instructions / notes |
| `ingredients[]` | ≥ 1 to save | repeater, see below | `recipe_ingredients` |
| `equipment[]` | no | `Input` + add; `Tag removable` | `equipment_json` |

**Ingredient row** (one `Card padding="sm"` per row)

| Subfield | Control |
|---|---|
| name | `Input` required |
| qty | `Input type="number"` step any, required |
| unit | `Input` short, required (free text; do not invent a unit enum) |
| optional | `form/Toggle` |
| remove | ghost `Button size="sm"` |

“Add ingredient” ghost button appends an empty row. Keyboard: Enter in
the last unit field adds a row.

Create: `POST /api/recipes` (adult) with the `recipe.repo.js` `insert`
shape (`name, category, prepTime, servings, source, url, notes, equipment, ingredients[]`).
`source` is `manual` for `/recipes/new`.

Update: `PUT /api/recipes/:id` (adult) same body.

Save disabled until `name` trimmed ≥ 2 and every ingredient row is
complete (or there is exactly zero rows — then show field error
`recipes:errors.ingredientsRequired` on submit, do not disable
silently).

On 201 create → `navigate(/recipes/${id})` replace.
On 200 update → stay, `common:status.saved` in a polite live region.

Cancel: if dirty, `window.confirm(recipes:actions.confirmDiscard)`;
else back to `/recipes`.

**Read-only (child, or adult viewing inactive)**

Render the same structure as text: name as `h1`, category `Badge`,
meta line, `RecipeIngredients` with `scale={1}` (do not reuse family
portion scaling here — this is the library original). No save bar.

### 2.3 Import URL sheet

Adult only. Opened from the library (`recipes:actions.importUrl`).

`Modal`

- 375: `position="bottom"` `size="full"`
- 1280: `position="center"` `size="md"`
- Title `recipes:import.title`
- Description `recipes:import.description`
- One `Field` `recipes:import.url` + `Input type="url"` `inputMode="url"`
  `autoComplete="url"` — **autofocus** (first focusable after the
  close button; put the input before the close in DOM **or** call
  `.focus()` on the input in an effect so Modal’s “first focusable”
  lands on the URL field. Preferred: render close after the form
  header, keep title as `h2`, focus the input explicitly.)
- Primary `recipes:import.submit` loading while in flight
- Secondary cancel

`POST /api/recipes/import-url` `{ url }` (already adult-gated).

| Result | UI |
|---|---|
| 201 `{ recipeId }` | Close sheet, `navigate(/recipes/${recipeId})` so the adult can fix parse gaps |
| 400 | `Field error` `recipes:import.invalid` (or server `detail` if it is a safe short string) |
| Network / 5xx | `role="alert"` `recipes:import.failed` + retry |

If the response includes `safeForProfile === false`, the editor shows
an amber `Card` banner `recipes:import.allergyWarning` listing
`blockedIngredients`. The recipe is already saved — do not roll back.

Do **not** wire `POST /api/recipes/import` (paste text) or image import
in G1. One field, one sheet.

### 2.4 Deactivate vs 409

Recipes that appear on `meal_plans` must not be hard-deleted. Historical
dinners keep their `recipe_id`.

**Adult destructive action on `/recipes/:id`**

Primary destructive control is **Deactivate**, not Delete.

- Ghost / danger-text button `recipes:actions.deactivate`
- Confirm copy `recipes:deactivate.confirm`
- `PATCH /api/recipes/:id` `{ active: false }` (implementers add
  `recipes.active INTEGER DEFAULT 1` + repo method; list `getAll`
  filters `active = 1` unless `?includeInactive=1`)
- Success: back to `/recipes`, recipe gone from default list and from
  Meals `RecipePickerDialog`
- Meal slots that already point at it still render the name

**Hard delete**

- Only if the recipe has **zero** `meal_plans` rows (server checks).
- Offer `recipes:actions.delete` under a “More” disclosure, never as
  the primary destructive button.
- `DELETE /api/recipes/:id`
  - 204 → library
  - **409** `{ code: 'RECIPE_IN_USE', mealPlanCount }` → do not show a
    generic toast. Swap the confirm panel to:

    > EN: This recipe is on the meal plan ({{count}} day(s)). Hide it
    > from the library instead?
    > NO: Denne oppskriften står på ukesmenyen ({{count}} dag(er)).
    > Skjul den fra biblioteket i stedet?

    Primary: Deactivate. Secondary: Cancel.
    `data-testid="recipe-409-deactivate"`

Child: no deactivate, no delete.

Inactive editor (adult, `?includeInactive` or direct URL): banner
`recipes:status.inactive` + `recipes:actions.reactivate`
(`PATCH { active: true }`).

### 2.5 Component reuse map

| Piece | Component |
|---|---|
| Page / row / editor chunks | `layout/Card` |
| Buttons | `base/Button` |
| Fields | `form/Field`, `form/Input`, `form/Toggle` |
| Overlay | `overlay/Modal` (same as invite + calendar language) |
| Category | `display/Badge` (`mint` / `cyan` / `amber`) |
| Equipment | `display/Tag` `removable` |
| Ingredient read-out | `meals/RecipeIngredients` on the read-only detail |
| Allergy | `display/Badge variant="amber"` |
| Back / library link | plain `Link` with mint focus ring (Meals header) |

Do not add a recipe hero image. Brand rule: no icon illustration of
food.

### 2.6 Accessibility

- Library `h1#recipes-heading`; editor `h1` is the name field’s
  visible label on create (`recipes:editor.createTitle`) or the recipe
  name on edit.
- Category cards and source chips: `aria-pressed`.
- Import sheet: focus the URL field; trap + restore via `Modal`.
- Deactivate confirm: focus the confirm primary; `role="alertdialog"`
  if implemented as a nested `Modal` (`title` + `description` already
  wire `aria-labelledby` / `describedby`).
- Ingredient remove buttons: `aria-label` with the ingredient name.
- Child read-only: no dead disabled inputs — render text.

### 2.7 i18n keys — extend `recipes`

Existing keys stay. Implementers add the following to **both**
`en/recipes.json` and `no/recipes.json` (not in this spec PR).

| Key | EN | NO |
|---|---|---|
| `actions.new` | New recipe | Ny oppskrift |
| `actions.importUrl` | Import from URL | Importer fra lenke |
| `actions.backToLibrary` | Back to library | Tilbake til biblioteket |
| `actions.save` | Save recipe | Lagre oppskrift |
| `actions.deactivate` | Hide from library | Skjul fra biblioteket |
| `actions.reactivate` | Show in library | Vis i biblioteket |
| `actions.delete` | Delete permanently | Slett for godt |
| `actions.confirmDiscard` | Discard unsaved changes? | Forkaste ulagrede endringer? |
| `actions.clearFilters` | Clear filters | Nullstill filter |
| `filters.search` | Search recipes | Søk i oppskrifter |
| `filters.source` | Source | Kilde |
| `filters.sourceAll` | All | Alle |
| `filters.sourceMine` | Ours | Våre |
| `filters.sourceImported` | Imported | Importert |
| `filters.sourceAi` | Suggested | Foreslått |
| `filters.inactive` | Show hidden | Vis skjulte |
| `filters.categoryAria` | Filter by category | Filtrer på kategori |
| `empty.filtered` | No recipes match these filters. | Ingen oppskrifter treffer filtrene. |
| `empty.bodyAdult` | Add a recipe or import one from a link. | Legg til en oppskrift eller importer fra en lenke. |
| `empty.bodyChild` | Ask an adult to add the family’s recipes. | Be en voksen om å legge inn familiens oppskrifter. |
| `meta.allergyWarning` | Check allergens | Sjekk allergener |
| `meta.sourceImported` | Imported | Importert |
| `meta.sourceAi` | Suggested | Foreslått |
| `status.inactive` | Hidden from library | Skjult fra biblioteket |
| `editor.createTitle` | New recipe | Ny oppskrift |
| `editor.editTitle` | Edit recipe | Rediger oppskrift |
| `fields.name` | Name | Navn |
| `fields.category` | Category | Kategori |
| `fields.prepTime` | Prep time | Tilberedning |
| `fields.prepTimeHint` | Example: 25 min | Eksempel: 25 min |
| `fields.servings` | Servings | Porsjoner |
| `fields.url` | Source URL | Kildelenke |
| `fields.notes` | Instructions | Fremgangsmåte |
| `fields.ingredients` | Ingredients | Ingredienser |
| `fields.ingredientName` | Ingredient | Ingrediens |
| `fields.qty` | Amount | Mengde |
| `fields.unit` | Unit | Enhet |
| `fields.optional` | Optional | Valgfri |
| `fields.addIngredient` | Add ingredient | Legg til ingrediens |
| `fields.removeIngredient` | Remove {{name}} | Fjern {{name}} |
| `fields.equipment` | Equipment | Utstyr |
| `fields.addEquipment` | Add | Legg til |
| `import.title` | Import from URL | Importer fra lenke |
| `import.description` | Paste a recipe link. We read the page and save a draft you can fix. | Lim inn en oppskriftslenke. Vi leser siden og lagrer et utkast du kan rette. |
| `import.url` | Recipe URL | Oppskriftslenke |
| `import.submit` | Import | Importer |
| `import.invalid` | That link could not be read as a recipe. | Den lenken kunne ikke leses som en oppskrift. |
| `import.failed` | Import failed. Try again. | Import feilet. Prøv igjen. |
| `import.allergyWarning` | This recipe may not fit everyone: {{list}}. It is saved — review before you plan it. | Denne oppskriften passer kanskje ikke alle: {{list}}. Den er lagret — se over før du planlegger den. |
| `deactivate.confirm` | Hide {{name}} from the library? Planned dinners keep the recipe. | Skjule {{name}} fra biblioteket? Planlagte middager beholder oppskriften. |
| `deactivate.conflict` | This recipe is on the meal plan ({{count}} day(s)). Hide it from the library instead? | Denne oppskriften står på ukesmenyen ({{count}} dag(er)). Skjul den fra biblioteket i stedet? |
| `errors.ingredientsRequired` | Add at least one ingredient. | Legg til minst én ingrediens. |
| `errors.saveFailed` | Could not save the recipe. | Kunne ikke lagre oppskriften. |
| `errors.loadOneFailed` | Could not load this recipe. | Kunne ikke hente denne oppskriften. |
| `errors.deactivateFailed` | Could not hide the recipe. | Kunne ikke skjule oppskriften. |
| `errors.forbiddenChild` | Only adults can change recipes. | Bare voksne kan endre oppskrifter. |

Keep using `recipes:actions.retry`, `recipes:category.*`,
`recipes:meta.servings`, `recipes:listAria`, `recipes:title`,
`recipes:description`.

---

## 3. Implementer checklist

**Chores**

- [ ] Route `/chores` inside AppShell
- [ ] Nav per `docs/ux/g1-nav.md`
- [ ] Header + comment-only XP slot
- [ ] `ChoresDayStrip` copies DayStrip classes
- [ ] States: loading, error+retry, empty week, empty day, data
- [ ] Child tree omits FAB, postpone, add modal
- [ ] Complete 180 ms brand-dot scale; `aria-pressed`
- [ ] Overdue = muted rose badge + tint, no motion
- [ ] Undo / postpone wired to existing PUTs
- [ ] Add modal fields as specified; `POST /api/chores` adult-only
- [ ] `chores` namespace registered both languages
- [ ] Dashboard empty-chore CTA → `/chores`

**Recipes**

- [ ] Routes `/recipes/new`, `/recipes/:id`
- [ ] G1 note removed from library
- [ ] Adult New + Import; child neither
- [ ] Rows are links
- [ ] Editor fields + ingredient repeater
- [ ] Import URL sheet → `POST /api/recipes/import-url`
- [ ] Deactivate default; 409 → deactivate CTA
- [ ] Child `/recipes/new` redirects; `/recipes/:id` read-only
- [ ] Locale keys added in both `en` and `no`

**Out of scope (do not build in G1)**

- XP, streaks, leaderboard, `Ring`, week-goal slider, achievements
- Text-paste import, image import, LLM “from-llm” from this UI
- Custom postpone date picker
- Recipe photos
- Purple, new fonts, new token families

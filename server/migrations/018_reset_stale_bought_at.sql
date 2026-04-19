-- PR A hotfix — reset stale bought_at flags.
--
-- Context: PR #43 removed the server-side filter that hid bought items
-- from the shopping list ("bought items stay on list with an undo
-- affordance"). That means any row with bought_at set from an earlier
-- deploy is now visible as "✓ Kjøpt" by default, even on the first
-- shopping list view after the deploy. Pilot feedback: "items default
-- to bought on first startup" — because the stale data was hidden
-- before but isn't anymore.
--
-- One-time cleanup: clear bought_at / bought_qty on every shopping
-- list item so the pilot starts from a clean slate. Future Kjøpt
-- clicks work normally (markItemBought still sets datetime('now')).
UPDATE shopping_list_items
SET bought_at = NULL, bought_qty = NULL
WHERE bought_at IS NOT NULL;

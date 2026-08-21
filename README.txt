Expiry/Perishable cell — hide for Assets, and for Supplies that don't opt in
=============================================================================

WHAT CHANGED
------------
File: apps/web/src/pages/stock/index.tsx

The Local Database stock table used to show the "Perishable / Not perishable"
cell (with the editable clock icon) on every row, including Assets and
Supplies — even though assets structurally never expire.

Now:
- Asset rows always show "—" instead of the expiry cell. No clock icon.
- Supplies rows show "—" too, UNLESS:
    - the category itself is flagged "Items in this category expire" (On) —
      e.g. a future "Cleaning Chemicals" category, or
    - this specific location already has its own override saved on that row
      (so nothing that was already set gets silently hidden/orphaned).
- Every other product type (Bar, Kitchen, Beverage, Food) is unchanged.
- Restore, for inactive rows, still appears even when the expiry cell itself
  is hidden — it just rides next to the "—" instead of disappearing.

No database, schema, or admin-UI changes needed — the category-level
"Items in this category expire" toggle already existed in Manage > Categories
and already does the right thing; this patch just stops showing/editing an
expiry cell on rows where it can never mean anything.

HOW TO APPLY
------------
Drag-and-drop the "apps" folder from this zip into your project root,
overwriting the existing apps/web/src/pages/stock/index.tsx.

Then rebuild/restart your dev server as usual (no migrations, no new
dependencies).

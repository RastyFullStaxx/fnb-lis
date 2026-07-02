# Phase 4 — Versioned Recipes & Menu Sales

**Goal:** Menu/cocktail sales deplete ingredients through **versioned** recipes; the Full Audit gains its Sold Portion and full Revenue columns — full legacy report parity.

## Tasks

- `/menus` routes: menu CRUD, publish RecipeVersion (+lines) — versions immutable, `versionNo` increments
- Recipe builder UI: ingredient rows (location-item combobox, serving qty + unit), live cost + suggested SRP via `core/pricing.recipeCost`, margin preview, version history timeline, "publishing creates v{n+1}" notice
- Sales entry gains menu option (item-or-menu combobox); commit snapshots the **active recipeVersionId**
- Engine menu paths: recipe expansion, `menuTotalServing` revenue share, discount deduction `((SRP×disc%)/ingredientCount)×qty`, non-revenue serving fallback + contentOverride precedence (Nuances A–C in architecture.md §6)
- Report: Sold Portion column, Revenue = direct + menu share; drilldown shows expansion per menu sale
- Golden fixture extended: 14× Vodka Tonic (one at 10% discount), one menu non-revenue, one contentOverride non-revenue — expected numbers appended to phase-3 doc
- Git commit

## Done when

- Extended goldens match exactly
- Editing a recipe after sales exist changes **nothing** historical; the new version affects only later sales
- Recipe cost preview in the builder equals the engine's cost for the same version

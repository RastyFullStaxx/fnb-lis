# PRODUCT.md — FNB/LIS

**Register:** product (app UI — design serves the task)
**One-liner:** An audit-grade inventory platform for bars, kitchens, and any counted stock — the legacy LIS reconciliation logic, rebuilt to be fast, beautiful, and trustworthy.

## What this is

FNB/LIS is the ground-up modernization of Liquor Inventory Solution's legacy bar & kitchen inventory-audit system. It is **not a generic stock app**: its core business value is **audit-period reconciliation** — count stock, record activity, count again, and expose the variance between what *should* have been used and what *was* used, priced at cost and retail.

```
Beginning Count + Purchases + Returned Bottles + Transfers In − Transfers Out − Ending Count = Usage
(Sales + Recipe Consumption + Non-Revenue + Production) − Usage = Variance
```

The company (LIS) runs these audits for **multiple client establishments** (bars, restaurants), each with one or more locations — a main bar, its satellite bars, a stockroom. Everything in the app is scoped to the active client location.

## Who uses it

| Persona | Role | What they do all day |
|---|---|---|
| Auditor/encoder | STAFF | Rapid data entry: counts (incl. weighing open bottles), purchases, sales, non-revenue. Needs keyboard-first speed and zero ambiguity. |
| Operations lead | MANAGER | Everything staff does + prices, recipes, imports, voids/corrections. Investigates variance. |
| Owner (Lourd) | ADMIN | Onboards clients/locations/users, maintains the master catalog, reads everything. |
| Client bookkeeper | ACCOUNTANT | Generates and exports reports; read-only elsewhere. |
| Client viewer | READONLY | Views and downloads reports, changes nothing. Used for establishments that hired LIS as a third-party audit service: sessions expire after 20 minutes, report screens carry a watermark naming the viewer, and every export is stamped "Exported by". |

Any non-ADMIN user can additionally be restricted to specific **modules** (Bar / Kitchen / Asset), which is how the client's five access packages are expressed. Locations outside a user's modules disappear from their switcher entirely.

## The workflows (user-facing language, ledger hidden)

1. **Count stock** — Open a count session for a date. Two entry modes: *full units* (type a quantity) and *weigh* (put the item on the scale, type the reading; the app computes the result live). Weighing works two ways: bar bottles convert the reading to remaining *content* via tare weight and a density factor, while kitchen items counted by weight take the plain *net* weight (scale − tare) as the quantity. Commit when done — the session becomes the anchor for reports.
2. **Receive purchases** — Draft a delivery (supplier, invoice ref, date), add lines with quantity and actual unit cost, commit.
3. **Record sales / non-revenue / production** — One quick-entry screen, three kinds. Menu items expand through their recipe. Non-revenue captures the reason (comp, spillage, staff, spoilage…) and allows a manual content amount for partial pours.
4. **Record returned bottles (forfeits)** — A customer leaves an unfinished bottle: weigh it; its content re-enters stock. (Legacy called this "forfeited"; the math adds it back into the pool.)
5. **Move stock between locations (transfers)** — The main bar sends stock to a satellite bar or the stockroom. The sending location records what went out; the receiving location confirms **what actually arrived**. When those differ — ten sent, eight received — the gap stays visible instead of quietly becoming someone's variance. Both locations' Full Audits reflect their own side, and Transfer In/Out reports value the movement at cost and retail.
6. **Build recipes** — Ingredients + serving sizes → live cost and suggested SRP. Publishing creates a **new version**; history never changes.
7. **Import files** — Drop a POS export (CSV/Excel) or a scanned/PDF report (AI-extracted). Review every row, fix matches, approve, commit. One click reverses a whole batch. The system remembers name→item mappings per client.
8. **Generate the Full Audit report** — Pick a begin and end count date, get the reconciliation per item/category with variance highlighted, drill into any number's source records, export Excel/CSV or print. Alongside it: Sales, Purchases, Non-Revenue, Transfers, Inventory on Hand, and **Cost Analysis** — beverage and food cost as a share of sales, the report the client's accountants read.
9. **Correct mistakes** — Committed records can't be edited. Users see "void" and "correct" (with reason); the app keeps both records linked. The activity log answers "who did what, when."
10. **Ask Stocky** *(read-only)* — A read-only assistant that explains variances, finds records, and teaches the formulas, with links to the actual data.

## Universal by design (beyond food & beverage)

The legacy DB literally contains "Pants" filed as a beverage. The new model fixes the root cause:

- **Product types** are data (`Beverage`, `Food`, `Supplies`, … user-extensible), not hardcoded enums.
- **Units** carry a kind (volume/mass/count) and a factor to base; custom units convert automatically (500 g → 0.5 kg).
- **`contentTracked`** per variant decides whether "open" amounts divide by container size (a 700 ml bottle) or count raw (pieces, packs) — the legacy `uom == 'ml'` special-case, made explicit and universal.
- **Weighing profiles** attach to any variant that can go on a scale, in two modes: *density* (tare + density factor → remaining content, for bottles) and *net* (tare only → quantity in the counting unit, for bulk food). Liquor and kitchen stock weigh on the same screen.

## Product promises

- **Trustworthy numbers**: the legacy formulas, reproduced exactly, with prices snapshotted at entry time (the legacy silently repriced history — we don't).
- **Fast hands**: every high-frequency screen is operable without a mouse; entry → Enter → next item.
- **Nothing disappears**: commits are immutable; corrections are visible chains; every action is logged.
- **Review before commit**: no import, AI or otherwise, touches inventory without a human approving rows.
- **Low clutter**: one clear action per screen; details on demand; no dashboard soup.

## Non-goals

Not an accounting/tax system. Not a POS. Not an auto-pilot AI that writes inventory unsupervised. Not (yet) the offline desktop app — the web app comes first, architected so the Electron build reuses the same core, schemas, and UI.

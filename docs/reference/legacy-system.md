> **Read-only reference — this describes the LEGACY PHP system, not the rebuild.**
> Use it to reproduce legacy behaviour and verify formula parity. For how the current system
> works see [../architecture.md](../architecture.md) and [../PRODUCT.md](../PRODUCT.md).

# FNB Legacy System Documentation

**System name in database/settings:** Liquor Inventory Solution (LIS)  
**Codebase reviewed:** `fnb-main.zip`  
**Database reviewed:** `fnb.sql`  
**Framework/stack observed:** CodeIgniter HMVC-style PHP application, MySQL/MariaDB, PHPExcel, jQuery, Bootstrap/Gentelella-style admin UI  
**Documentation purpose:** This document explains what the legacy FNB/LIS system is, how its workflows operate, what each major page appears to do, how important calculations work, and what limitations should be considered before modernizing it into StockLedger.

> Note: This document is reverse-engineered from the uploaded source code and SQL dump. It is a functional documentation of the legacy logic, not a replacement for live user testing with the client. Some module names use the original spelling and naming from the codebase, such as `bottles`, `ingridients`, `wunderbar`, and `client_bottle_audits`.

---

## 1. Executive Summary

The FNB legacy system is a bar and kitchen inventory audit system. Although many labels say **Bottle**, the codebase supports both **Beverage** and **Food** item categories through `category_type`:

- `1 = Food`
- `2 = Beverage`

The system is strongest for beverage/liquor operations. Food support exists through food categories, food units of measurement, food purchases, food sales, menu recipes, and a Food Full Audit report. However, the deeper specialized logic—especially weighing, liquid-weight conversion, pour/spout import, and open-bottle auditing—is clearly beverage-first.

The system’s core workflow is not simply “add stock and subtract stock.” Its central business logic is an **audit-period reconciliation** model:

```text
Usage = Beginning Inventory + Purchases + Forfeited/adjusted quantity - Ending Inventory
```

Then the system compares computed usage against:

```text
Sales + Menu/Recipe Consumption + Non-Revenue Usage
```

The result is shown as variance, cost variance, retail variance, and over/short percentage in the full audit reports.

In practical terms, the legacy system is used like this:

1. Maintain a master database of items, categories, sizes, tare weights, liquid weights, and UOM.
2. Build a client/branch-specific local database with default cost and retail price.
3. Record a beginning audit count.
4. During the audit period, encode purchases, sales, non-revenue usage, production, forfeited bottles/items, and optional POS/spout imports.
5. Record an ending audit count.
6. Generate Food or Beverage Full Audit reports to compare actual usage versus expected usage.

The most important feature to preserve in a modern replacement is the **Full Audit Report calculation**, because it is the system’s operational truth.

---

## 2. High-Level System Identity

### 2.1 What the legacy system is

The legacy system is a web-based inventory and audit application for bar/kitchen operations. It manages:

- Establishments/clients and branches
- Item master database
- Client/branch local item database
- Physical audit counts
- Open bottle / weighed item counts
- Purchases
- Sales
- Non-revenue consumption
- Production entries
- Menu/cocktail recipes
- Forfeited stock
- POS/spout/Wunderbar-style pour uploads
- Full audit reports
- Excel exports
- User accounts and activity trail

### 2.2 What the legacy system is not

The system is not a modern immutable ledger. It is not offline-first. It is not a full accounting system. It is also not a generalized restaurant ERP. Its main value is in reconciling bar/kitchen inventory against audit counts, purchases, sales, and recipe-based consumption.

### 2.3 Main business domain

The domain is best understood as:

```text
Client / Establishment
  └── Branch / Bar / Kitchen
        ├── Local item database
        ├── Audit counts
        ├── Purchases
        ├── Sales and non-revenue usage
        ├── Menus / recipes
        ├── Forfeited stock
        └── Audit reports
```

---

## 3. Main Navigation and Modules

The `page_menu` table defines the major pages visible in the system. The active pages in the dump include:

| Page/Menu | URL/module | Purpose |
|---|---|---|
| Audits | `auditbottles` | View audit entries, record full item counts, record weighed/open bottle counts, export audit report |
| Sales | `sales` | View sales, input sales, input non-revenue, input production |
| Purchases | `purchases` | View purchases, input purchases, record forfeited bottles/items |
| Reports | `reports` | Food Full Audit, Beverage Full Audit, graph reports, downloads |
| Local Database | `clientbottles` | Client/branch-specific item database with default cost and retail |
| Client Menus | `sales/menuitems` | Menu/cocktail recipe list and maintenance |
| Main Database | `bottles` | Global item master database, categories, sizes, weights, UOM |
| LIS Inventory | `lis_inventory` | Upload/manage spout or pour data from an external system |
| Users | `users` | User account management |
| Clients | `clients` | Client/branch administration, mostly admin-facing |

Some legacy pages exist but are inactive or secondary, such as old “Bottles Inventory,” old “Full Audit,” and “Daily I_N vs POS.”

---

## 4. Core Data Model

### 4.1 Client and branch structure

Important tables:

| Table | Meaning |
|---|---|
| `clients` | Establishment/business account. Example: a bar, restaurant, kitchen, or customer account using the system. |
| `branches` | Branch/location under a client. |
| `clients_bar` | User access mapping to client/bar. |
| `users` | Login accounts. |
| `trail` | Activity log trail for some actions. |

The system supports clients and branches in the database, but many model methods select a branch automatically by getting the latest branch for the selected client:

```text
SELECT branch_id FROM branches
WHERE client_id = current_client
ORDER BY branch_id DESC
LIMIT 1
```

This means the database is multi-client and partly branch-aware, but the UI and logic often behave as if the selected client has one current/default branch.

### 4.2 Item master data

Important tables:

| Table | Meaning |
|---|---|
| `bottles` | Global item master. Despite the name, this stores food and beverage items. |
| `categories` | Food or beverage category list. Also stores a default liquid weight for some beverage categories. |
| `uom` | Units of measurement separated by food/beverage type. |
| `bottle_sizes` | Available item sizes and tare weights per item. |
| `bottle_liquid_weights` | Liquid weight factor per item. Used for open bottle/weighing calculation. |
| `bottle_tare_weights` | Extra tare weight records per item. |

Important columns:

| Field | Meaning |
|---|---|
| `bottle_name` | Item name / brand / ingredient name |
| `category_id` | Category reference |
| `category_type` | `1 = Food`, `2 = Beverage` |
| `bottle_size` | Size/package amount, such as 700 ml, 1000 ml, 1 kg, etc. |
| `bottle_uom` | Unit such as ml, kg, grams, bottle, pack, liter, etc. |
| `tare_weight` | Empty container or packaging weight. Used for weighing open bottles. |
| `liquid_weight` | Conversion factor used to convert weight difference into remaining content. |
| `is_deleted` | Soft delete flag for several item records. |

### 4.3 Client/local item database

Important table:

| Table | Meaning |
|---|---|
| `client_bottles` | Client/branch-specific copy of items from the master database, with cost and retail pricing. |

Important fields:

| Field | Meaning |
|---|---|
| `client_id` | Which client/account owns the item |
| `branch_id` | Which branch/location owns the item |
| `bottle_id` | Item reference from master database |
| `bottle_size` | Item size selected for this local database entry |
| `bottle_uom` | Unit for this local entry |
| `default_cost` | Cost price used in reports |
| `default_retail` | Selling/retail price used in sales and variance retail value |
| `tare_weight` | Local/default tare value, when applicable |
| `liquid_weight` | Local/default liquid factor, when applicable |

The Local Database is critical because most operational pages select from client-local items, not directly from the global master database.

### 4.4 Audit, purchase, sales, menu, and import tables

| Table | Meaning |
|---|---|
| `client_bottle_audits` | Physical audit/count entries. Stores both full counts and open/weighed counts. |
| `purchases` | Daily purchase header/group. |
| `purchase_items` | Purchase line items. |
| `client_sales` | Sales, non-revenue usage, production-like entries. |
| `client_menus` | Menu/cocktail header. |
| `client_menus_ingridients` | Recipe lines/ingredients. Spelling is `ingridients` in legacy DB. |
| `client_forfeited_bottles` | Forfeited/spoiled/lost stock records. |
| `lis_inventory` | Uploaded spout/pour data. |
| `l_i_lis_inventory_pricing` | Pricing sync for LIS/pour data. |

---

## 5. Global Workflow Overview

The legacy workflow can be read as a cycle:

```text
1. Set up item master data
2. Add items to the client's local database
3. Take beginning physical audit
4. Encode activity during the period
   - purchases
   - sales
   - non-revenue
   - production
   - forfeited stock
   - optional pour/POS import
5. Take ending physical audit
6. Generate full audit report
7. Investigate variances
8. Repeat for the next audit period
```

The audit report is only meaningful when the user has both a beginning audit date and an ending audit date.

---

## 6. Login, Client Selection, and User Access

### 6.1 Login behavior

Users log in with username and password. The `users` table stores:

- First name
- Last name
- Username
- Password
- Email
- User level
- Status
- Modified date
- Date created

The `account_log` table records:

- Last login
- Last login IP
- Failed login attempt count
- Failed login time

### 6.2 User levels

The `users.user_level` field is documented in the schema as:

```text
1 = admin
2 = user
3 = demo
```

Admin users generally see more maintenance actions such as editing/deleting master database entries. Demo users are restricted by helper logic, such as the limit that demo users cannot add more than 15 brands in the local database.

### 6.3 Client access behavior

A user is connected to clients through `clients_bar`. The system uses the `bta-client` query parameter to know which client is active.

Example pattern:

```text
/reports?bta-client=1
/auditbottles?bta-client=1
/sales?bta-client=1
```

If `bta-client` is missing, several controllers redirect to the first/default accessible client.

### 6.4 Limitations in access control

The system has basic user levels and client scoping, but it does not have modern granular RBAC. Permissions are not modeled as module/action policies. Many operations are protected by simple user-level checks or helper redirects.

---

## 7. Main Database Workflow

### 7.1 Purpose

The Main Database is the global catalog of items. It contains items that can later be copied or added into a client/branch local database.

This module is in:

```text
application/modules/bottles
```

### 7.2 Main Database page

Page title/meaning:

```text
Main Database / Bottles
```

The list page shows columns like:

| Seen on page | Meaning |
|---|---|
| Category | Item category, such as Vodka, Rum, Meat, Dairy, etc. |
| Item Name | Name of the item/brand/ingredient |
| Item Size(s) | Available sizes/UOMs for the item |
| Bottle Weight | Tare weight values, mostly for beverage bottles |
| Liquid Weight | Liquid weight factor used for calculating remaining content |
| Date | Date created |
| Actions | Edit/delete, mostly admin-facing |

### 7.3 Add/edit item behavior

The edit form allows the user to maintain:

- Category type: Food or Beverage
- Category
- Item name
- One or more item sizes
- Tare weight per size
- UOM per size
- Liquid weight and its UOM

For beverages, the liquid weight and tare weight fields are visible and active. For food, liquid weight is hidden and tare weight is disabled in parts of the UI.

### 7.4 Category management

The Categories page shows:

| Seen on page | Meaning |
|---|---|
| ID | Category ID |
| Category Name | Category label |
| Category Type | Food or Beverage |
| Date Created | Creation timestamp |
| Added By | User who added the category |
| Actions | Edit/delete |

Some beverage categories have default liquid weights. Example categories in the SQL dump include Vodka, Rum, Whisky, Gin, Brandy, Tequila, Local Beer, Wine, Soda, Juices, Syrup, and others. Food categories include Meat, Poultry, Seafood, Dairy, etc.

### 7.5 UOM support

The `uom` table contains food and beverage units. Examples:

- Food: kg, grams, liter, case, tray, sack, bottle, box, pack, cup, teaspoon, tablespoon, pail, order, portion, piece, tub, lbs, can, bar, tin, pint, oz, gal
- Beverage: fl, oz, ml, gallon, liter, pack, box, gal, dozen

### 7.6 Main Database limitations

- The word “bottle” is used even when the item is food.
- There is no strict item type model beyond `category_type`.
- No formal unit conversion table exists beyond UOM strings and special-case report logic.
- Tare/liquid-weight behavior is beverage-first.
- Some deletes are soft deletes; some modules use hard deletes.
- There is no item versioning.

---

## 8. Local Database Workflow

### 8.1 Purpose

The Local Database is the client/branch-specific inventory catalog. It is where the client’s active operating items are configured with cost and retail prices.

This module is in:

```text
application/modules/clientbottles
```

### 8.2 Local Database page

The Local Database page shows:

| Seen on page | Meaning |
|---|---|
| Category | Item category |
| Item Name | Item and selected size |
| Default Cost | Cost price used for costing reports |
| Default Retail | Retail/selling price used in sales and variance retail value |
| Date | Date added |
| Added By | User who added it |
| Actions | Edit/delete |

Buttons/actions include:

| Button/action | Meaning |
|---|---|
| Download Local Database to Excel | Exports the local item list |
| Delete Selected | Removes selected local item rows |
| Price Sync | Syncs price-related data from another source/local state |
| Bottles Sync | Syncs bottle/item records |
| Add New Item modal | Adds an item from the master database into the local database |

### 8.3 Add New Item modal

The modal lets the user select:

- Category Type: Food or Beverage
- Item
- Item Size
- Default Cost
- Default Retail

This writes to `client_bottles`.

### 8.4 Highlighting missing prices

Rows are styled as danger/red if both default cost and default retail are missing or zero. This is important because reports rely on these price fields.

### 8.5 Why the Local Database matters

The Local Database is the practical operating catalog. Purchases, sales, menus, audits, and reports depend on items being present here with the correct size, UOM, cost, and retail.

### 8.6 Local Database limitations

- Cost and retail are stored directly on the local item record and can be overwritten.
- There is no cost history or price versioning.
- Local deletes may remove or soft-delete data depending on the function used.
- Item size/UOM handling is string-based, often using values like `700:ml`.
- Duplicate prevention exists but is partial and depends on bottle ID, size, and UOM checks.

---

## 9. Audits Workflow

### 9.1 Purpose

Audits are physical inventory counts. They are the foundation of the full audit report.

The audit module is in:

```text
application/modules/auditbottles
```

The audit table is:

```text
client_bottle_audits
```

It stores both:

```text
1 = Full item count
2 = Open/weighed item count
```

### 9.2 Audit navigation

The audit section has three main actions:

| Button/page | Purpose |
|---|---|
| View Audit Items | Lists audit sessions grouped by date/user and allows viewing/downloading details |
| Record Full Audit Items | Records whole/full item counts |
| Record Weigh Audit Items | Records open/weighed item counts, mainly for open liquor bottles |

### 9.3 View Audit Items page

The audit list page shows:

| Seen on page | Meaning |
|---|---|
| Date filter | Filter audit groups by real audit date |
| Update Selected Audits | Batch update selected audit records to another date |
| Delete | Batch delete selected audit groups |
| Export Audit Report | Download detailed audit report |
| Date | Audit date |
| Items | Number of audit records in the group |
| Encoded By | User who encoded the audit |
| Actions | View item list and download report |

When viewing the item list modal, the table shows:

| Seen on modal | Meaning |
|---|---|
| Date | Audit date |
| Bottle/Item | Counted item |
| Full Item Count | Whole item count |
| Open Bottle Count | Computed remaining quantity for open/weighed items |
| Scale Weight | Measured scale weight |
| Encoded By | User who encoded it |
| Actions | Edit/delete |

### 9.4 Record Full Audit Items page

This page is for counting whole items.

Visible fields:

| Field | Meaning |
|---|---|
| Date | Physical count date |
| Category Type | Food or Beverage |
| Item | Item selected from master/local item lists |
| Item Size | Size/UOM of the item |
| Remaining Item Count | Whole quantity counted |
| Record Full Item button | Saves the count |
| Live preview table | Shows recently recorded items with brand, size, and count |

This creates a `client_bottle_audits` row with:

```text
audit_type = 1
qty = counted whole quantity
remaining_ml = usually 0
```

### 9.5 Record Weigh Audit Items page

This page records open bottles or partially used items by weight.

Visible fields:

| Field | Meaning |
|---|---|
| Date | Physical count date |
| Category Type | Food or Beverage |
| Item | Selected item |
| Item Size | Size/UOM |
| Liquid Weight | Liquid conversion factor for the item/category |
| Item Weight | Tare weight, usually empty bottle/container weight |
| Scale Weight | Actual weight measured on scale |
| Remaining | Computed remaining net content |
| Record Weigh Item button | Saves the weighed/open count |
| Live preview table | Shows Brands, LW, BW/TW, SW, Remaining |

The key calculation happens on the page in JavaScript:

```text
remaining = round((scale_weight - tare_weight) × liquid_weight)
```

Where:

| Term | Meaning |
|---|---|
| `scale_weight` | Weight shown by the scale for the open bottle/container |
| `tare_weight` / item weight | Empty bottle/container weight |
| `liquid_weight` | Conversion factor from net weight to liquid content |
| `remaining` | Estimated remaining liquid/content, usually in ml |

The page prevents saving if scale weight is less than tare weight, because that would produce a negative remaining quantity.

### 9.6 Why the weighing calculation exists

For liquor inventory, staff often need to count partially used bottles. Manually estimating “half bottle” or “one-third bottle” is inaccurate. The legacy system instead allows the staff to weigh the open bottle:

```text
Net liquid weight = Scale weight - empty bottle weight
Remaining liquid = Net liquid weight × liquid weight factor
```

Reports then convert remaining ml into bottle-equivalent quantity:

```text
Open bottle equivalent = remaining_ml / bottle_size
```

Example:

```text
Bottle size: 700 ml
Remaining content: 350 ml
Open bottle equivalent: 350 / 700 = 0.5 bottle
```

This is why the report can combine full bottles and open bottles into one audit calculation.

### 9.7 Food behavior on weigh page

The page includes Food and Beverage category types. However, when Food is selected, the tare and scale fields are disabled in some JavaScript paths. This indicates that open-weigh audit logic is designed mainly for beverages, while food support is simpler and more count/UOM-based.

### 9.8 Audit limitations

- Audit entries can be edited, soft-deleted, batch-updated, and batch-deleted.
- There is no immutable audit ledger.
- Date changes can alter report outcomes without preserving a correction event.
- Audit records store current cost-related fields but reporting mostly pulls current local cost, which may create historical inaccuracies if prices change.
- Open count logic assumes configured tare and liquid weights are accurate.
- Food weighing logic is not as mature as beverage weighing logic.

---

## 10. Purchases Workflow

### 10.1 Purpose

Purchases record stock received during an audit period.

The purchase module is in:

```text
application/modules/purchases
```

Important tables:

```text
purchases
purchase_items
client_bottle_inventory
```

### 10.2 Purchases list page

The purchases module includes a list of purchase groups. Purchases are grouped by date/purchase header, and each header can contain multiple purchase items.

### 10.3 Input Purchases page

Visible fields:

| Field | Meaning |
|---|---|
| Date | Actual purchase/receiving date |
| Category Type | Food or Beverage |
| Item | Local/client item |
| Item Size | Size and UOM |
| Cost | Cost price for the purchase line |
| Quantity | Quantity purchased |
| Save New Purchase | Saves the purchase line |
| Total Purchased Today badge | Shows count/summary of today’s encoded purchases |
| Live preview table | Shows recently saved purchase items |

### 10.4 Purchase save behavior

When a user saves a purchase:

1. The system checks if a purchase header exists for the same branch and date.
2. If not, it creates a new `purchases` row.
3. It adds a `purchase_items` row.
4. It updates the purchase header total by adding `cost × qty`.
5. It may also add to `client_bottle_inventory` depending on the called flow.

The report calculation reads purchase quantity and cost from `purchase_items` and `purchases`.

### 10.5 Purchase report date behavior

The full audit report counts purchases in this range:

```text
purchase.real_date BETWEEN from_date AND (to_date - 1 day)
```

This means if the report is from June 1 to June 8, purchase activity is counted from June 1 through June 7. The `to_date` is treated as the ending audit date, not as a normal inclusive business date.

### 10.6 Purchase limitations

- Purchase edits/deletes mutate or remove records rather than recording immutable correction events.
- Supplier management is not clearly implemented in the core purchase entry workflow, despite future proposal plans needing suppliers/procurement.
- Purchases are date grouped but not modeled as complete procurement lifecycle records.
- Cost history is line-based but not cleanly integrated into a modern average-cost model.

---

## 11. Forfeited Stock Workflow

### 11.1 Purpose

Forfeited stock records items that are lost, spoiled, expired, broken, wasted, or otherwise removed from usable inventory outside normal sales.

The table is:

```text
client_forfeited_bottles
```

### 11.2 Forfeited page

The page title is:

```text
Purchases > Record forfeited bottles
```

Although it sits under Purchases, business-wise it is an inventory loss/stock-out workflow.

Visible fields:

| Field | Meaning |
|---|---|
| Date | Date forfeited |
| Category Type | Food or Beverage |
| Item | Item forfeited |
| Item Size | Size/UOM |
| Liquid Weight | Conversion factor |
| Item Weight | Tare weight |
| Scale Weight | Actual measured weight |
| Remaining | Computed remaining content |
| Record Forfeited Bottle | Saves the forfeited record |
| Live preview | Shows Brands, LW, TW, SW |

### 11.3 Forfeited calculation

The forfeited page uses the same net-content calculation as open bottle audits:

```text
remaining = round((scale_weight - tare_weight) × liquid_weight)
```

This is used when a partial bottle is forfeited. The remaining quantity is later included in the full audit usage formula.

### 11.4 How forfeited stock affects reports

The report reads forfeited records for the audit period and adds the forfeited amount into usage:

```text
Usage = Beginning + Purchases + Forfeited - Ending
```

For ml-based items, forfeited remaining ml is converted into bottle equivalent:

```text
Forfeited bottle equivalent = forfeited_remaining_ml / bottle_size
```

### 11.5 Limitation

The label “Forfeited Bottle” is beverage-oriented. Food can be selected, but the workflow is not clearly separated into food spoilage, beverage loss, breakage, expired item, staff meal, or other reason categories.

---

## 12. Sales Workflow

### 12.1 Purpose

Sales records inventory consumption through revenue-generating transactions, menu/cocktail sales, non-revenue usage, and production entries.

The sales module is in:

```text
application/modules/sales
```

Main table:

```text
client_sales
```

Important fields:

| Field | Meaning |
|---|---|
| `bottle_id` | Direct item sold/used |
| `menu_id` | Menu/cocktail sold/used |
| `bottle_size` | Size of direct item |
| `total_quantity` | Number of items/yields/servings |
| `price` | Price/SRP used for sales revenue |
| `discount` | Discount percentage |
| `item_type` | Legacy distinction between direct item and menu item |
| `sales_type` | `1 = normal sales/production`, `2 = non-revenue` in current logic |
| `non_ml` | Manual net content amount for non-revenue usage |
| `real_date` | Business date |
| `is_deleted` | Soft delete flag |

### 12.2 Sales list page

The sales list displays sales records, item/menu names, quantity, size, sales type, date, and actions for edit/delete.

### 12.3 Input Sales page

Visible fields:

| Field | Meaning |
|---|---|
| Date | Date of sale |
| Category Type | Food, Beverage, or Menu |
| Item | Selected item/menu |
| Item Size | Size/UOM; menu uses yield-like size |
| SRP | Selling price |
| Discount (%) | Discount applied to the sale |
| Total Quantity | Quantity sold |
| Save New Sales | Saves a normal sales record |
| Live preview table | Shows recent sold items and quantities |

### 12.4 Sales item type behavior

The category selector has:

```text
1 = Food
2 = Beverage
3 = Menu
```

In save logic:

- Food or Beverage direct items are saved as `item_type = 1`.
- Menu/cocktail items are saved as `item_type = 2` with `menu_id`.
- Normal sales are saved as `sales_type = 1`.

### 12.5 Input Non-Revenue page

Non-revenue is for consumed stock that is not normal revenue, such as comps, wastage, internal use, staff usage, testing, or other non-sold consumption.

Visible fields include:

| Field | Meaning |
|---|---|
| Date | Date of non-revenue usage |
| Category Type | Food, Beverage, or Menu |
| Item | Item/menu used |
| Item Size | Size/UOM |
| Total Quantity | Quantity used |
| Mililitre / `non_ml` | Manual net content amount for partial usage |
| Save New Non-Rev | Saves non-revenue entry |
| Live preview table | Shows Bottle, Quantity, NET Content |

### 12.6 Which page calculates or displays “NET Content”

The **Input Non-Revenue** page has a live preview table with a **NET Content** column. The field behind it is `non_ml`.

Purpose:

- If a full unit is consumed, quantity may be enough.
- If only a partial amount is consumed, especially liquor, the user can enter a net content amount manually.
- Reports then prefer `non_ml` when available; otherwise they fall back to the recipe serving amount or direct quantity.

Important distinction:

- The **Open Bottle Audit** and **Forfeited Bottle** pages calculate remaining content from scale weight.
- The **Non-Revenue** page captures net content manually through the `non_ml` field and displays it in the live preview as NET Content.

### 12.7 Input Production page

Production appears to use the sales save path but sets discount to 100 and hides SRP/discount fields.

Visible fields:

| Field | Meaning |
|---|---|
| Date | Production date |
| Category Type | Food, Beverage, or Menu |
| Item | Item/menu |
| Item Size | Size/UOM |
| Total Quantity | Production quantity |
| Save New Production | Saves the production record |

In the live preview, production records are queried as sales records where:

```text
sales_type = 1
AND discount = 100
```

This suggests production is represented as a special sales-like record rather than a separate production domain table.

### 12.8 Sales limitations

- Sales, non-revenue, and production are mixed in one table.
- Production is identified indirectly through `discount = 100`, which is fragile.
- Direct item versus menu item logic is encoded through numeric `item_type` values.
- There is no separate source document, receipt, POS transaction, or invoice model.
- Edits and deletes mutate/soft-delete records instead of recording correction events.
- Sales date range in reports uses `to_date - 1 day`, which can confuse users unless clearly explained.

---

## 13. Menu / Recipe Workflow

### 13.1 Purpose

The menu module defines cocktails/menu items and their ingredient consumption. This allows menu sales to be translated into inventory usage.

Important tables:

```text
client_menus
client_menus_ingridients
```

### 13.2 Client Menus page

The menu list shows:

| Seen on page | Meaning |
|---|---|
| Client Branch | Branch/client label |
| Cocktail Name | Menu item name |
| Cost | Computed/default cost |
| SRP | Suggested retail price |
| Date Created | Creation date |
| Modified By | User |
| Bottles | Hidden/grouped ingredient list |
| Actions | Edit, view ingredients, delete |
| Download Menus to Excel | Exports menu/recipe list |

Although the label says “Cocktail Name,” the menu system can contain food menu items as long as ingredients exist in the Food or Beverage item database.

### 13.3 Add Menu page

Visible fields:

| Field | Meaning |
|---|---|
| Name | Menu/cocktail name |
| SRP | Suggested retail price, computed from ingredients and read-only |
| Items | Ingredient item |
| Item Size | Ingredient package size/UOM |
| Serving field | Amount of ingredient used in the recipe |
| Add/remove ingredient buttons | Dynamic recipe line management |
| Add Menu | Saves the menu and recipe lines |

### 13.4 Menu cost/SRP calculation

When ingredient serving amounts are entered, the page calculates the menu SRP by summing ingredient costs/retail values.

The important browser-side formula is:

```text
if UOM is ml:
    ingredient_subtotal = (ingredient_retail / bottle_size) × serving
else:
    ingredient_subtotal = ingredient_retail × serving

menu_srp = sum(ingredient_subtotal)
```

The save logic also stores ingredient-level values:

| Field | Meaning |
|---|---|
| `serving` | Amount of ingredient used |
| `ml_price` | Retail component stored for the ingredient |
| `default_price` | Cost component stored for the ingredient |
| `bottle_uom` | UOM of the ingredient |

### 13.5 Recipe use in audit reports

When a menu is sold, the report expands the menu sale into its ingredients. For ml-based ingredients:

```text
ingredient usage in bottle equivalent = (serving / bottle_size) × menu_quantity_sold
```

For non-ml ingredients:

```text
ingredient usage = serving × menu_quantity_sold
```

This ingredient usage becomes the “Sold Portion” or “Shot” side of the full audit report.

### 13.6 Menu limitations

- There is no recipe versioning. Editing a recipe changes the menu definition for future and report logic may not preserve historical recipe state correctly.
- The spelling `ingridients` appears throughout the database/code.
- Deleting a menu can hard-delete the menu row.
- SRP calculation appears based on ingredient retail values and may not separate cost price from selling price cleanly.
- The UI is cocktail-oriented even though food menus are partially supported.

---

## 14. LIS Inventory / Wunderbar / Spout Import Workflow

### 14.1 Purpose

The LIS Inventory module imports external pour/spout data from CSV/XLS/XLSX files. It appears designed for a Wunderbar/spout/POS-adjacent source where each row records pour-related data.

Module:

```text
application/modules/lis_inventory
```

Table:

```text
lis_inventory
```

### 14.2 Upload Pour Data page

Visible fields:

| Field | Meaning |
|---|---|
| Upload File | CSV, XLS, or XLSX pour data file |
| Upload Date | Transaction/upload date |
| Submit | Upload and parse file |

The parser expects columns mapped as:

```text
bottle
time
location
size_selected
size_poured
dispense
```

During import, the system tries to match the bottle name from the file to the `bottles` table. If no match exists:

```text
bottle_id = 0
bottle_name = original uploaded name
```

Unmatched rows are shown with danger styling in the spout data page.

### 14.3 Spout Data page

Visible columns:

| Seen on page | Meaning |
|---|---|
| Stock | Bottle/item name from imported file or matched item |
| Size Selected | Selected size from external system |
| Pour Size | Shot size / size poured |
| Dispense Size | Dispensed amount |
| Timestamp | Time from imported file |
| Date | Transaction date |
| Uploaded By | User who uploaded/modified |
| Actions | Edit/delete |

The page also supports batch delete and batch update/mapping of selected spouts to a bottle.

### 14.4 Consolidated spout data

A consolidated view groups uploaded spout data by bottle name and sums dispense/shot/selected size values.

### 14.5 Retail value / sync behavior

The retail sync logic inserts pricing records based on local bottle retail and selected size. The code uses calculations similar to:

```text
spout_price = default_retail × size_selected
bottle_ml = size_selected × 100
```

This indicates the system attempts to associate pour sizes with retail values for reporting.

### 14.6 LIS import limitations

- Import format is fixed and template-dependent.
- There is no modern review/validation queue before committing parsed rows.
- Matching is by exact bottle name in the master database, so naming inconsistencies cause unmatched rows.
- Delete operations on pour data are hard deletes.
- This module is inactive in the page menu dump but still present and functionally implemented.

---

## 15. Reports Workflow

### 15.1 Purpose

Reports are the business-critical output of the system. The full audit reports calculate inventory usage, revenue, non-revenue, variance, cost, and retail variance from audit counts, purchases, sales, menu recipes, and forfeited records.

Module:

```text
application/modules/reports
```

Main report views:

```text
food_fullauditcat.php
food_fullaudit.php
beverage_fullauditcat.php
beverage_fullaudit.php
graph.php
wunderreport.php
```

### 15.2 Food Full Audit Report by Category

The Food Full Audit report shows a category-grouped audit report for food items.

Visible page elements:

| Seen on page | Meaning |
|---|---|
| Food Full Audit Report By Category | Report title |
| View by Item name | Switch to item-name view |
| Date range | From and to audit dates |
| Submit | Regenerate report |
| Download Report | Export report |
| Download Cost Analysis Report | Export cost analysis |
| Total | Summary indicator |
| Report table | Audit calculation by category/item |

### 15.3 Beverage Full Audit Report by Category

The Beverage Full Audit report is similar to the Food report but geared toward beverage/liquor items.

Visible page elements:

| Seen on page | Meaning |
|---|---|
| Beverage Full Audit Report By Category | Report title |
| View by Item name | Switch to item-name view |
| Date range | From and to audit dates |
| Submit | Regenerate report |
| Download Report | Export report |
| Download Cost Analysis Report | Export cost analysis |
| Report table | Audit calculation by category/item |

### 15.4 Main report columns

The current full audit by category layout includes columns similar to:

| Column | Meaning |
|---|---|
| Product Name | Item name |
| Size/UOM | Package size and unit |
| Beginning Inventory - Full | Whole count from beginning audit date |
| Beginning Inventory - Weigh/Open | Open/weighed quantity converted to item equivalent |
| B-Cost | Beginning inventory cost |
| Purchased | Purchases during the period |
| F | Forfeited quantity |
| Ending Inventory - Full | Whole count from ending audit date |
| Ending Inventory - Weigh/Open | Open/weighed quantity converted to item equivalent |
| E-Cost | Ending inventory cost |
| Usage | Computed usage during period |
| Usaged Cost | Usage × default cost |
| Sales - Sold | Direct item sales quantity |
| Sales - Portion | Menu/recipe consumption quantity |
| Revenue | Direct sales + menu sales revenue |
| Variance - Uses vs Sales | Sales/menu usage compared against computed usage |
| Non Rev Usage | Non-revenue usage |
| Non Rev Cost | Non-revenue usage × cost |
| Overall Variance - Over/Short | Total expected movement minus computed usage |
| % Over/Short | Variance percentage against usage |
| Cost | Variance × default cost |
| Retail | Variance × default retail |

### 15.5 Full audit calculation

The core formula is:

```text
Beginning = Beginning Full + Beginning Open
Ending = Ending Full + Ending Open
Usage = Beginning + Purchases + Forfeited - Ending
```

For ml-based items:

```text
Beginning Open = beginning_remaining_ml / bottle_size
Ending Open = ending_remaining_ml / bottle_size
Forfeited = forfeited_remaining_ml / bottle_size
```

For non-ml items:

```text
Open quantity = remaining value directly
Forfeited = forfeited remaining value directly
```

### 15.6 Sales and recipe comparison

The report separately calculates:

```text
Direct Sales = total quantity from client_sales where item_type = direct item
Menu/Shot/Portion Consumption = expanded recipe consumption from menu sales
Non-Revenue = direct non-revenue + menu non-revenue expanded to ingredients
```

Then:

```text
Variance Uses vs Sales = Direct Sales + Menu Consumption - Usage
Overall Variance = Direct Sales + Menu Consumption + Non-Revenue - Usage
% Over/Short = Overall Variance / Usage × 100
Variance Cost = Overall Variance × default_cost
Variance Retail = Overall Variance × default_retail
```

### 15.7 Revenue calculation

Revenue is calculated from direct sales and menu/cocktail sales. For direct sales:

```text
Revenue component = price × total_quantity
```

For menu/cocktail sales, the report loops through menu ingredient lines and calculates menu-related revenue/consumption using menu price, discount, serving, and quantity.

### 15.8 Date range semantics

This is important.

The audit report takes two dates:

```text
from_date = beginning audit date
to_date = ending audit date
```

Beginning and ending inventory are read exactly from those dates:

```text
Beginning audit = audit records on from_date
Ending audit = audit records on to_date
```

But purchases and sales are generally read from:

```text
from_date through to_date - 1 day
```

Reason:

The ending date represents the next physical count date. If ending audit is taken on June 8, then sales/purchases counted in the period should usually end on June 7, before the ending count.

This date behavior is correct for audit-period logic but can confuse users if the UI simply says “Date from/to” without explaining that the end date is the next audit date.

### 15.9 Report highlighting

Rows can be styled as danger/red when variance is negative. This helps identify shortages or problem items.

### 15.10 Report exports

The system exports Excel reports using PHPExcel. Exports include:

- Food Full Audit
- Food Full Audit by Category
- Beverage Full Audit
- Beverage Full Audit by Category
- Cost Analysis reports
- Audit item reports
- Menu exports
- Local database exports

### 15.11 Stored procedures for report cost summaries

The SQL dump includes stored procedures:

| Procedure | Purpose |
|---|---|
| `ACOST` | Computes audit cost by category for a branch/date |
| `PCOST` | Computes purchase cost by category in a period |
| `PCOST_BY_CATEGORY` | Computes purchase cost using a category view |
| `getSales` | Computes gross sales for a branch/date range |

### 15.12 Report limitations

- Report formulas are spread across controllers, views, models, and stored procedures.
- There is no single report service layer.
- Some formulas are duplicated between food/beverage/report/export methods.
- The date range logic is easy to misunderstand.
- Reports use current local item cost/retail in several places, which can distort historical reports after price edits.
- No automated tests validate report formulas.
- No immutable source-of-truth ledger exists behind the report.

---

## 16. Inventory Page

### 16.1 Purpose

The inventory module appears to show item inventory based on joined client bottle data and related records.

Module:

```text
application/modules/inventory
```

It has a basic `inventory` page and `model_inventory`, but compared with audits/reports, it is less central.

### 16.2 Limitation

The operational truth of the system is not the inventory page. It is the full audit report. Any modernization should prioritize audit/report correctness over a simple stock-on-hand table.

---

## 17. Graph / Dashboard / Consolidate Module

### 17.1 Purpose

The `consolidate` model and `graph` report provide analytics-like views.

Observed functions include:

- Top menu items
- Top ingredients
- Top brands
- Top 10 bottle brands
- Top 10 menu items
- Top 10 shots
- Top 10 cocktails
- Top 3 brand sales
- Graph data

### 17.2 Limitation

The analytics layer is secondary and depends on the integrity of the encoded sales/audit data. It should not be treated as the core system until the audit cycle is modernized.

---

## 18. Detailed End-to-End Business Workflows

## 18.1 New client/bar setup workflow

```text
1. Admin creates or selects a client.
2. Admin creates a branch under the client.
3. Admin assigns users to the client/bar if needed.
4. Admin configures global master items if missing.
5. User builds Local Database for the client branch.
6. User adds default cost and default retail prices.
7. User creates menu/cocktail recipes if applicable.
8. User begins operational audit cycle.
```

## 18.2 New item setup workflow

```text
1. Go to Main Database.
2. Select category type: Food or Beverage.
3. Select category.
4. Add item name.
5. Add item size and UOM.
6. For beverage: configure tare weight and liquid weight.
7. Save item.
8. Go to Local Database.
9. Add the item to the client branch.
10. Set default cost and retail.
```

## 18.3 Beginning audit workflow

```text
1. Go to Audits.
2. Choose Record Full Audit Items.
3. Enter whole/full counts for each relevant item.
4. Choose Record Weigh Audit Items.
5. For open bottles, select item and size.
6. Confirm liquid weight and tare weight.
7. Enter scale weight.
8. Let the system compute remaining net content.
9. Save each weighed item.
10. Review audit entries from View Audit Items.
```

## 18.4 During-period activity workflow

During the period between audit counts, users encode:

```text
Purchases
Sales
Non-revenue usage
Production
Forfeited stock
Optional spout/POS uploads
```

These records are later used by the full audit report.

## 18.5 Ending audit workflow

```text
1. On the ending audit date, repeat full item counts.
2. Repeat open bottle/weighed counts.
3. Review audit records.
4. Generate report using beginning and ending audit dates.
```

## 18.6 Full audit report workflow

```text
1. Go to Reports.
2. Choose Food Full Audit or Beverage Full Audit.
3. Select beginning audit date as from_date.
4. Select ending audit date as to_date.
5. Submit.
6. Review item/category rows.
7. Investigate negative or abnormal variance rows.
8. Download report or cost analysis if needed.
```

---

## 19. Important Calculations

### 19.1 Open bottle / weighed item remaining content

Used in:

- Audits > Record Weigh Audit Items
- Purchases > Record Forfeited Bottles

Formula:

```text
remaining = round((scale_weight - tare_weight) × liquid_weight)
```

Why it exists:

- To estimate remaining liquid/content in open bottles.
- To reduce human estimation errors.
- To convert physical scale readings into inventory quantity.

### 19.2 Open bottle equivalent in reports

Used in full audit reports.

Formula for ml items:

```text
open_equivalent = remaining_ml / bottle_size
```

Example:

```text
remaining_ml = 350
bottle_size = 700
open_equivalent = 0.5 bottle
```

### 19.3 Audit usage

```text
usage = beginning_full + beginning_open + purchases + forfeited - ending_full - ending_open
```

### 19.4 Beginning and ending cost

```text
beginning_cost = (beginning_full + beginning_open) × default_cost
ending_cost = (ending_full + ending_open) × default_cost
```

### 19.5 Usage cost

```text
usage_cost = usage × default_cost
```

### 19.6 Menu/recipe consumption

For ml-based recipe lines:

```text
ingredient_consumption = (serving / bottle_size) × menu_quantity_sold
```

For non-ml recipe lines:

```text
ingredient_consumption = serving × menu_quantity_sold
```

### 19.7 Variance

```text
uses_vs_sales = direct_sales + menu_consumption - usage
```

```text
overall_variance = direct_sales + menu_consumption + non_revenue - usage
```

```text
variance_percent = overall_variance / usage × 100
```

```text
variance_cost = overall_variance × default_cost
```

```text
variance_retail = overall_variance × default_retail
```

### 19.8 Non-revenue net content

Used in:

- Sales > Input Non-Revenue

The page accepts a manual `non_ml` value and displays it as NET Content. In reports, if `non_ml` is present, it can override or influence the amount counted as non-revenue usage.

---

## 20. Current Functional Scope: Drinks vs Food

### 20.1 Beverage/drinks support

The beverage side is the most complete. It supports:

- Beverage categories
- Beverage UOMs such as ml, oz, liter, gallon
- Bottle/item sizes
- Tare weight
- Liquid weight
- Open bottle weighing
- Full bottle counts
- Beverage purchases
- Beverage sales
- Beverage menu/cocktail recipes
- Non-revenue liquor usage
- Forfeited bottles
- Beverage full audit report
- Spout/pour import
- Retail value sync for pours

### 20.2 Food support

Food support exists, but it is less specialized. It supports:

- Food categories
- Food UOMs such as kg, grams, case, tray, pack, cup, tablespoon, portion, piece, etc.
- Food full counts
- Food purchases
- Food sales
- Food ingredients in menus
- Food Full Audit report
- Food category grouping

### 20.3 Food limitations

Food appears to be added onto a beverage-first architecture. Evidence:

- Tables and UI repeatedly use “bottle” naming for all items.
- Open bottle/weighing workflows are designed around tare weight, scale weight, liquid weight, and ml.
- Some food paths disable tare/scale fields.
- Food spoilage/wastage is not clearly separated from beverage forfeiting.
- Recipe support exists but is cocktail-oriented in naming.

For StockLedger modernization, food and beverage should be separated conceptually while still sharing one item/event architecture.

---

## 21. Legacy System Strengths

The legacy system has several important strengths that should be preserved:

1. **Real audit-period logic** — It understands beginning count, purchases, ending count, sales, non-revenue, and variance.
2. **Open bottle calculation** — It solves the real liquor inventory problem of estimating partial bottles.
3. **Client/local database concept** — It separates global item definitions from client/branch-specific pricing.
4. **Menu/recipe consumption** — It can translate menu/cocktail sales into ingredient depletion.
5. **Full audit reports** — It produces detailed operational reports that the client likely trusts.
6. **Excel exports** — The system supports practical export workflows.
7. **POS/spout import foundation** — It already has a structured import concept for external pour data.
8. **Basic client/branch/user model** — It has the seed of multi-client operations.

---

## 22. Legacy System Limitations

## 22.1 Architectural limitations

- Built on an old PHP/CodeIgniter stack.
- SQL dump indicates PHP 5.6 and MariaDB/MySQL-era setup.
- Report logic is scattered across views, controllers, models, and stored procedures.
- There is no clean service/domain layer.
- There is no event ledger.
- There is no offline-first architecture.
- There is no deterministic sync or local outbox.

## 22.2 Data integrity limitations

- Many records can be edited, soft-deleted, hard-deleted, or date-shifted.
- No immutable correction model exists.
- Historical report results can change if price, recipe, item, or audit records are edited.
- Menu recipes are not versioned.
- Purchase and sales edits are not preserved as audit-safe compensating records.
- Foreign key enforcement is not clearly defined in the schema.

## 22.3 Reporting limitations

- The same formulas are duplicated in multiple files.
- Date range logic is non-obvious.
- Cost and retail values may use current local database prices instead of historical price snapshots.
- No automated tests validate report correctness.
- Some formulas include special cases for ml vs non-ml items.
- Variance labels may not be intuitive to new users.

## 22.4 UX limitations

- The UI is old and form-heavy.
- Many labels are beverage-specific even for food items.
- Some success messages are misleading, such as sales/non-revenue pages saying “New Purchase has been saved.”
- Users must understand the correct audit sequence manually.
- Workflows are split across pages without a guided audit-cycle flow.
- Error handling is basic.
- The date picker/report behavior is not fully explained on-screen.

## 22.5 Security/access limitations

- User roles are basic numeric levels.
- No granular permission model by module/action.
- Password handling uses CodeIgniter encryption/decryption patterns rather than modern one-way password hashing.
- Some SQL queries use manual string concatenation and escaping patterns.
- No modern device/session/license binding exists.

## 22.6 Import limitations

- The LIS import expects fixed columns.
- There is no import review screen before records are committed.
- Unmatched bottles are stored with `bottle_id = 0` and must be fixed manually.
- No AI/OCR or robust parser abstraction exists.

## 22.7 Multi-branch limitations

- Database supports branches.
- UI/code often auto-selects one branch for the client.
- Many workflows assume a current/default branch rather than making branch a clear first-class filter.

---

## 23. What Must Be Preserved in StockLedger

The modern system should preserve these legacy capabilities:

| Legacy capability | Modern StockLedger equivalent |
|---|---|
| Main Database | Global item master data |
| Local Database | Tenant/branch item catalog with cost/retail settings |
| Full audit count | Physical count session / count lines |
| Open bottle weigh audit | Weighed count workflow with net content calculation |
| Purchases | Purchase receipt + stock-in events |
| Sales | Sales record + stock-out events |
| Non-revenue | Non-revenue usage + stock-out reason |
| Production | Production/recipe/batch workflow, not hidden as discount 100 |
| Forfeited stock | Forfeit/spoilage/loss workflow + stock-out reason |
| Menu recipes | Recipe/BOM with versioning |
| Full audit reports | Audit-period reconciliation engine |
| POS/spout import | Structured import batch with review and validation |
| Excel exports | Modern PDF/Excel/CSV export layer |
| User trail | Immutable activity/event audit trail |

---

## 24. Recommended Modern Interpretation

The legacy system should not be copied screen-for-screen. Instead, StockLedger should preserve the business logic while modernizing the architecture.

Recommended modern structure:

```text
Tenant / Establishment
Branch / Location
User / Role / Permission
Item Master
Branch Item Catalog
Unit and Conversion Rules
Open Bottle Profile
Recipe / Recipe Version
Audit Session
Physical Count Line
Purchase Receipt
Sales Record
Non-Revenue Usage
Forfeited Stock
Import Batch
Inventory Event Ledger
Report Read Model
```

The UI should use human workflows, not raw event labels:

```text
Receive Purchase
Record Sale
Record Non-Revenue
Count Full Items
Weigh Open Bottle
Record Forfeited Stock
Create Recipe
Generate Full Audit Report
Review Variance
```

Internally, these workflows can generate immutable ledger events.

---

## 25. Modernization Risks

The biggest risk is rebuilding StockLedger as a generic inventory app and missing the audit report logic.

The second biggest risk is making a beautiful dashboard before reproducing the client’s trusted calculations.

Priority should be:

```text
1. Legacy report correctness
2. Audit count workflow correctness
3. Open bottle net-content calculation
4. Purchase/sales/non-revenue/forfeit mapping
5. Menu recipe expansion
6. Exports
7. Dashboard/analytics
8. Offline sync and packaging
```

---

## 26. Suggested Validation Checklist With Client

Use this checklist in the next client review:

### Audit

- Confirm how often audits are performed: daily, weekly, monthly, or custom.
- Confirm if beginning date and ending date logic should exclude the ending day’s sales/purchases.
- Confirm how open bottles are weighed in real operation.
- Confirm what units the scale uses.
- Confirm how liquid weight factors are obtained.

### Food

- Confirm whether food inventory is actively used or only partially used.
- Confirm if food also needs weighed partial counts.
- Confirm if food spoilage/wastage needs its own reason categories.

### Sales

- Confirm distinction between sales, non-revenue, and production.
- Confirm whether production should increase output stock or only record internal use.
- Confirm how discounts should affect revenue and variance.

### Menus

- Confirm whether menu items are cocktails only or both food and drinks.
- Confirm if recipes change often.
- Confirm whether old reports must preserve old recipe versions.

### Purchases

- Confirm if supplier, invoice, PO, and payment tracking are needed now or later.
- Confirm whether cost averaging is needed by item and period.

### Reports

- Ask the client which reports he trusts most.
- Collect sample expected report outputs.
- Validate every full audit column formula.
- Confirm if Food and Beverage reports need to remain separate.

### Import

- Collect actual POS/spout/PDF/Excel sample files.
- Confirm required fields.
- Confirm matching rules for item names.
- Confirm whether imports should auto-commit or require review.

---

## 27. Conclusion

The FNB legacy system is best understood as a **bar and kitchen audit reconciliation system** with beverage-first inventory logic and partial food/menu support.

Its most valuable logic is not the old UI or database design. Its value is the operational workflow:

```text
Count beginning stock
Record activity
Count ending stock
Compute usage
Compare usage against sales/menu/non-revenue
Expose variance
```

The modern StockLedger system should preserve this workflow exactly, then improve it with:

- Immutable events
- Cleaner domain model
- Better UI guidance
- Recipe versioning
- Historical price snapshots
- Structured import review
- Offline-first operation
- Stronger access control
- Reliable exports
- Scalable tenant/branch support

The correct modernization goal is therefore:

```text
A modern, offline-first, audit-safe rebuild of the legacy LIS/FNB bar and kitchen audit system.
```

Not merely:

```text
A generic inventory management system.
```

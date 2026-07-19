> **Read-only reference — this describes the LEGACY PHP system, not the rebuild.**
> Use it to reproduce legacy behaviour and verify formula parity. For how the current system
> works see [../architecture.md](../architecture.md) and [../PRODUCT.md](../PRODUCT.md).

# FnB System — Database Keys Reference

Extracted from the model files in `fnb-main`. Each section lists the table name, its primary key, and all columns used in queries, inserts, or updates throughout the codebase.

---

## `users`

**Primary key:** `user_id`

| Column | Notes |
|---|---|
| `user_id` | Primary key |
| `username` | |
| `password` | |
| `user_level` | |
| `status` | |
| `modified_date` | |

---

## `account_log`

**Primary key:** `user_id` (FK to `users`)

| Column | Notes |
|---|---|
| `user_id` | FK → `users` |
| `last_login_ip` | |
| `last_login` | |
| `failed_log_attempt` | |
| `failed_log_time` | |

---

## `clients`

**Primary key:** `client_id`

| Column | Notes |
|---|---|
| `client_id` | Primary key |
| `client_name` | |
| `status` | Soft-delete flag (0 = active, 1 = deleted) |
| `user_id` | FK → `users` |
| `date_created` | |

---

## `clients_bar`

Junction table linking clients to users (bar staff).

| Column | Notes |
|---|---|
| `client_id` | FK → `clients` |
| `user_id` | FK → `users` |

---

## `clients_view`

Read-only view used in `page.php`.

| Column | Notes |
|---|---|
| `id` | |
| `client` | Client name |
| `branch` | Branch name |

---

## `branches`

**Primary key:** `branch_id`

| Column | Notes |
|---|---|
| `branch_id` | Primary key |
| `branch_name` | |
| `client_id` | FK → `clients` |
| `user_id` | FK → `users` |
| `date_created` | |

---

## `categories`

**Primary key:** `category_id`

| Column | Notes |
|---|---|
| `category_id` | Primary key |
| `category_name` | |
| `category_type` | 1 = food, 2 = beverage, 3 = cocktail/menu |
| `liquid_weight` | |
| `user_id` | FK → `users` |
| `date_created` | |

---

## `bottles`

**Primary key:** `bottle_id`

| Column | Notes |
|---|---|
| `bottle_id` | Primary key |
| `bottle_name` | |
| `category_id` | FK → `categories` |
| `category_type` | Denormalized type |
| `user_id` | FK → `users` |
| `is_deleted` | Soft-delete flag |
| `deleted_by` | FK → `users` |
| `date_created` | |
| `date_modified` | |

---

## `bottle_sizes`

**Primary key:** `(bottle_id, bottle_size, bottle_uom)` (composite, no explicit PK seen)

| Column | Notes |
|---|---|
| `bottle_id` | FK → `bottles` |
| `bottle_size` | Numeric size value |
| `bottle_uom` | Unit of measure (e.g. `ml`, `oz`) |
| `tare_weight` | |
| `user_id` | FK → `users` |
| `date_created` | |

---

## `bottle_tare_weights`

| Column | Notes |
|---|---|
| `bottle_id` | FK → `bottles` |
| `tare_weight` | |
| `bottle_uom` | |
| `user_id` | FK → `users` |
| `date_created` | |

---

## `bottle_liquid_weights`

| Column | Notes |
|---|---|
| `bottle_id` | FK → `bottles` |
| `liquid_weight` | |
| `bottle_uom` | |
| `user_id` | FK → `users` |
| `date_created` | |

---

## `uom`

Lookup table for units of measurement.

| Column | Notes |
|---|---|
| `uom_name` | |
| `category_type` | FK → `categories.category_type` |

---

## `client_bottles`

Per-branch/client bottle configuration (pricing, sizes).

**Primary key:** `client_bottle_id`

| Column | Notes |
|---|---|
| `client_bottle_id` | Primary key |
| `bottle_id` | FK → `bottles` |
| `client_id` | FK → `clients` |
| `branch_id` | FK → `branches` |
| `bottle_size` | |
| `bottle_uom` | |
| `tare_weight` | |
| `liquid_weight` | |
| `default_cost` | Cost price |
| `default_retail` | Retail price |
| `user_id` | FK → `users` |
| `is_deleted` | Soft-delete flag |
| `date_created` | |
| `date_modified` | |

---

## `client_bottle_audits`

Inventory audit records (full and open bottle counts).

**Primary key:** `client_bottle_audit_id`

| Column | Notes |
|---|---|
| `client_bottle_audit_id` | Primary key |
| `bottle_id` | FK → `bottles` |
| `branch_id` | FK → `branches` |
| `bottle_size` | |
| `bottle_uom` | |
| `qty` | Full bottle count |
| `scale_weight` | |
| `liquid_weight` | |
| `tare_weight` | |
| `remaining_ml` | Open bottle remaining volume |
| `default_cost` | Cost at time of audit |
| `audit_type` | 1 = full bottle, 2 = open bottle |
| `user_id` | FK → `users` |
| `is_deleted` | Soft-delete flag |
| `delete_by` | FK → `users` |
| `date_audit` | Audit date |
| `date_created` | |
| `date_modified` | |

---

## `client_bottle_inventory`

**Primary key:** `(auto-increment, not named in code)`

| Column | Notes |
|---|---|
| `bottle_id` | FK → `bottles` |
| `client_id` | FK → `clients` |
| `branch_id` | FK → `branches` |
| `bottle_size` | |
| `bottle_uom` | |
| `qty` | |
| `tare_weight` | |
| `liquid_weight` | |
| `cost` | |
| `user_id` | FK → `users` |
| `date_created` | |

---

## `client_forfeited_bottles`

**Primary key:** `client_forfeited_id`

| Column | Notes |
|---|---|
| `client_forfeited_id` | Primary key |
| `bottle_id` | FK → `bottles` |
| `branch_id` | FK → `branches` |
| `bottle_size` | |
| `bottle_uom` | |
| `liquid_weight` | |
| `tare_weight` | |
| `scale_weight` | |
| `remaining_ml` | |
| `qty` | |
| `user_id` | FK → `users` |
| `is_deleted` | Soft-delete flag |
| `date_forfeited` | |
| `date_created` | |
| `date_modified` | |

---

## `purchases`

Purchase order header.

**Primary key:** `purchase_id`

| Column | Notes |
|---|---|
| `purchase_id` | Primary key |
| `branch_id` | FK → `branches` |
| `client_id` | FK → `clients` |
| `user_id` | FK → `users` |
| `total_purchases` | Running total cost |
| `date_created` | Acts as purchase date |
| `date_modified` | |

---

## `purchase_items`

Individual line items within a purchase order.

**Primary key:** `purchase_item_id`

| Column | Notes |
|---|---|
| `purchase_item_id` | Primary key |
| `purchase_id` | FK → `purchases` |
| `bottle_id` | FK → `bottles` |
| `bottle_size` | |
| `bottle_uom` | |
| `qty` | |
| `cost` | Unit cost at time of purchase |
| `tare_weight` | |
| `liquid_weight` | |
| `user_id` | FK → `users` |
| `real_date` | Actual delivery/purchase date |
| `date_created` | |

---

## `client_sales`

All sales entries (revenue and non-revenue).

**Primary key:** `client_sales_id`

| Column | Notes |
|---|---|
| `client_sales_id` | Primary key |
| `branch_id` | FK → `branches` |
| `user_id` | FK → `users` |
| `bottle_id` | FK → `bottles` (null if menu item) |
| `menu_id` | FK → `client_menus` (null if bottle item) |
| `bottle_size` | |
| `bottle_uom` | |
| `price` | Unit price at time of sale |
| `discount` | Percentage discount |
| `total_quantity` | |
| `item_type` | 1 = bottle/brand, 2 = cocktail/menu |
| `sales_type` | 1 = revenue, 2 = non-revenue |
| `non_ml` | Non-ml quantity (food weight, etc.) |
| `is_deleted` | Soft-delete flag |
| `deleted_by` | FK → `users` |
| `real_date` | Actual sale date |
| `date_created` | |
| `date_modified` | |

---

## `client_menus`

Cocktail/menu item definitions.

**Primary key:** `menu_id`

| Column | Notes |
|---|---|
| `menu_id` | Primary key |
| `cocktail_name` | |
| `client_id` | FK → `clients` |
| `branch_id` | FK → `branches` |
| `default_cost` | |
| `default_retail` | |
| `garnish` | (referenced but not used in active code) |
| `garnish_cost` | (referenced but not used in active code) |
| `user_id` | FK → `users` |
| `is_deleted` | Soft-delete flag |
| `date_created` | |
| `date_modified` | |

---

## `client_menus_ingridients`

Ingredients for each cocktail/menu item.

**Primary key:** `menu_ingridient_id`

| Column | Notes |
|---|---|
| `menu_ingridient_id` | Primary key |
| `menu_id` | FK → `client_menus` |
| `bottle_id` | FK → `bottles` |
| `bottle_size` | |
| `bottle_uom` | |
| `serving` | Volume served (in UOM) |
| `ml_price` | Price per serving |
| `default_price` | Cost price |
| `date_created` | |

---

## `lis_inventory`

Wunderbar spout dispense log.

**Primary key:** `wunderbar_id`

| Column | Notes |
|---|---|
| `wunderbar_id` | Primary key |
| `branch_id` | FK → `branches` |
| `client_id` | FK → `clients` |
| `bottle_id` | FK → `bottles` (0 if unmatched) |
| `bottle_name` | Raw name string from device |
| `size_selected` | Bottle size selected on device |
| `shot_size` | Volume of pour |
| `dispense_size` | Dispensed volume |
| `time` | Time of pour |
| `modified_by` | FK → `users` |
| `trans_date` | Transaction date |
| `date_created` | |

---

## `lis_inventory_pricing`

Pricing lookup for LIS/Wunderbar pours.

| Column | Notes |
|---|---|
| `branch_id` | FK → `branches` |
| `bottle_id` | FK → `bottles` |
| `bottle_ml` | Volume level |

---

## `wunderbar_pricing`

Retail price configuration for Wunderbar pours.

**Primary key:** `wb_price_id`

| Column | Notes |
|---|---|
| `wb_price_id` | Primary key |
| `bottle_id` | FK → `bottles` |
| `branch_id` | FK → `branches` |
| `client_id` | FK → `clients` |
| `spout_price` | Retail price per pour |
| `bottle_ml` | Pour size in ml |
| `user_id` | FK → `users` |
| `date_modified` | |

---

## `page_menu`

Application navigation menu structure.

| Column | Notes |
|---|---|
| `parent` | 1 = top-level, 2 = sub-menu |
| `active` | Boolean visibility flag |
| `has_sub` | ID of parent menu item (for sub-menus) |

---

## `trail`

Audit trail / activity log.

**Primary key:** `trail_id`

| Column | Notes |
|---|---|
| `trail_id` | Primary key |
| `user_id` | FK → `users` |
| `name` | Action name |
| `description` | Detail string (includes client context) |
| `date` | |

---

## Views / Derived Tables (referenced in queries)

These names appear as table sources but are likely SQL views or stored procedures, not base tables:

| Name | Used for |
|---|---|
| `clients_view` | Flat view of clients + branch |
| `sales_beverage` | Pre-aggregated beverage sales |
| `sales_kitchen` | Pre-aggregated kitchen/food sales |
| `sales_menu` | Pre-aggregated menu/cocktail sales |
| `top_ingridients` | Pre-aggregated top ingredients by sales |

Stored procedures called via `CALL`:

| Name | Parameters | Purpose |
|---|---|---|
| `ACOST` | `_branch`, `_date` | Audit cost by category |
| `PCOST_BY_CATEGORY` | `_branch`, `_start`, `_end` | Purchase cost by category |
| `getSales` | `_branch`, `_start`, `_end` | Total sales summary |

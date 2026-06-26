# FnB System — Full Workflow Documentation

End-to-end process guide: from user login, through every sidebar page, to final report generation.

---

## System Overview

This is a **CodeIgniter-based F&B inventory and cost control system** for bars and restaurants. Every page is scoped to a **client** (a bar/restaurant) passed via the `?bta-client=` URL parameter. All data entry, auditing, purchases, sales, and reporting are tied to that client's branch.

---

## User Levels

The system has five user levels, which control access and data limits:

| Level | Name | Key Restrictions |
|---|---|---|
| 1 | Administrator | Full access. Sees Clients, Trail, Users links. Can access Main Database. |
| 2 | Team Lead | Full bar access. No admin-only pages. |
| 3 | Assistant | Limited to 10-day rolling access window (auto-deactivated if `modified_date` is older than 9 days). Max **15 brands** in Local Database. |
| 4 | Accountant | Full bar access. No admin-only pages. |
| 5 | Guest | Sidebar is hidden entirely (`user_level != 5` check in header). |

Non-Admin users (`level != 1`) are **restricted to only their assigned clients** via the `clients_bar` table. Admin sees all clients.

---

## 1. Login

**URL:** `/validate`

### Process

1. User lands on the login form (`login/login_form`).
2. Submits `username` + `password` via POST to `login/validate_credentials`.
3. **Validation:** Both fields required; blank fields redirect back with flash error.
4. **Password check:** Password is stored encrypted. The system decodes the stored password and does a `strcmp` against the submitted plaintext.
5. **Account lock check:** If `account_log.failed_log_attempt >= 5` AND the last failed attempt was within the past hour → account is locked. User sees a message to try again in an hour. Login is logged to `trail`.
6. **Activation check:** If `users.status != 1` the account is considered inactive (counter-intuitively, `status = 1` means NOT yet activated here — `user_status_activated()` returns true when `status == 1`, which causes a redirect). Active accounts have `status = 0`.
7. **Success path:**
   - Logs details to `account_log` (IP, timestamp).
   - Resets `failed_log_attempt` to 0.
   - Sets session: `logged_in`, `username`, `user_id`, `client`, `branch_id`, `user_level`, `branch_name`, `login_time`, `page_id`, `ip_address`.
   - Writes `trail` entry: "Login Complete."
   - Writes a `logs` table entry via `_l()`.
   - Redirects to the dashboard (`/`).
8. **Failure path:** Increments `failed_log_attempt` in `account_log`. Redirects back to login with flash error.

### Post-Login: Client Resolution

On every protected page, `check_link()` runs at controller construction time:
- Queries `clients` joined to `clients_bar` filtered by `user_id` (non-admins) and `status = 0`.
- If no clients match → logs the user out, shows "You don't have a bar to manage."
- If `?bta-client` is missing from the URL → the system resolves the first client assigned to the user and redirects to the current URL with that client appended.

Every page navigation carries `?bta-client=X` in the URL, making the active client persistent and switchable from the top-right dropdown.

---

## 2. Dashboard (Home)

**URL:** `/` → `home/index`

This is a placeholder page. The CodeIgniter default "Welcome to CodeIgniter" view is loaded. No real dashboard data is rendered here. Its purpose is simply to confirm the user is logged in and to trigger `get_current_client()`, which enforces the `?bta-client=` parameter redirect if missing.

---

## 3. Sidebar Navigation

The sidebar is built dynamically from the `page_menu` database table. The query fetches items where `parent = 1 AND active = 1`. Sub-menus are fetched with `parent = 2 AND active = 1 AND has_sub = [page_id]`. All links carry the current `?bta-client=` value.

Admin-only links appended directly in the header template (not from `page_menu`): **Clients**, **Trail**, **Users**.

---

## 4. Audit (Inventory Count)

**Sidebar label:** Audit Bottles  
**URL:** `/auditbottles`

This is the core daily data-capture page. Staff physically count all bottles in the bar, then record counts here.

### 4a. View Audit Items

**URL:** `/auditbottles` (default index)

- Loads grouped audit records from `client_bottle_audits` for the active branch, grouped by `date_audit` + `user_id` showing the date, who audited, and how many items were counted.
- A date filter (`?real_date=`) narrows results to a single day.
- Clicking a group row triggers an AJAX call to `auditbottles/loadaudits` (POST with `dateaudit` and `user_id`), which returns the individual bottle records as HTML table rows.
- Each row shows: date, bottle name + size, full count, open-bottle remaining ml, scale weight, who entered it, and edit/delete actions.
- **Batch operations:** checkboxes allow bulk delete (`delete_selected`) or bulk date correction (`updated_selected_group`).
- **Delete:** Soft-deletes by setting `is_deleted = 1` on individual records. Group-delete uses a composite key `CONCAT(DATE(date_audit),'@',user_id)`.

### 4b. Record Full Audit Items (Full Bottle Count)

**URL:** `/auditbottles/fullbInvertory`

Used to record complete (sealed) bottles in stock.

1. Page loads all bottles from the **main database** (`bottles` table, category_type = 2 for beverages) via `getallbottlelist()`.
2. User selects a bottle from the dropdown. The system dynamically loads its available sizes via `auditbottles/bottlesize` (AJAX POST).
3. User enters:
   - **Date** (`real_date`) — the audit date.
   - **Quantity** — number of full bottles.
   - **Default Cost** — cost per bottle (pre-filled from `client_bottles` if available).
4. On submit:
   - Checks if the bottle-size combination exists in `client_bottles` for this branch. If not, `addClientBottleIfNotExist()` creates it automatically.
   - Inserts into `client_bottle_audits` with `audit_type = 1` (full bottle).
   - Fields saved: `bottle_id`, `branch_id`, `qty`, `bottle_size`, `bottle_uom`, `user_id`, `default_cost`, `audit_type = 1`, `date_audit`, `date_created`, `date_modified`.
5. A live preview panel at the bottom auto-refreshes showing the last 5 entries via `auditbottles/liveentryfull` (AJAX).

### 4c. Record Weigh Audit Items (Open Bottle)

**URL:** `/auditbottles/fullOInvertory`

Used for partially-consumed (open) bottles. These are weighed on a scale.

1. Page loads all bottles from the main database with their liquid weight reference data via `getallbottlelistopen()`.
2. User selects bottle + size. System populates tare weight, liquid weight automatically.
3. User enters:
   - **Date** (`real_date`).
   - **Scale Weight** — actual weight of the open bottle on a scale (in grams/oz).
   - Tare and liquid weights are pulled from the database; the system calculates `remaining_ml` on save.
4. On submit:
   - Same `addClientBottleIfNotExist()` check as above.
   - Inserts into `client_bottle_audits` with `audit_type = 2` (open bottle).
   - Fields saved: `bottle_id`, `branch_id`, `bottle_size`, `liquid_weight`, `tare_weight`, `scale_weight`, `remaining_ml`, `bottle_uom`, `user_id`, `default_cost`, `audit_type = 2`, `date_audit`, `date_created`, `date_modified`.
5. Live preview auto-refreshes with last 5 open-bottle entries via `auditbottles/liveentry`.

### 4d. Edit an Audit Record

**URL:** `/auditbottles/geteditform?cba_id=X&tpe=X`

Clicking the edit icon on any audit row opens the edit form for that specific record. Updates are posted back to save the corrected values in `client_bottle_audits`.

---

## 5. Purchases

**Sidebar label:** Purchases  
**URL:** `/purchases`

Tracks incoming stock deliveries into the bar.

### 5a. View Purchases

**URL:** `/purchases` (index)

- Loads all purchase group headers from `purchases` for the active branch, ordered by `purchase_id DESC`.
- Table shows: Purchase ID, date purchased (= `date_created`), total item count, date encoded, and who encoded it.
- Clicking a Purchase ID or the list icon opens a **modal** that calls `purchases/loadpurchase` (AJAX) with the purchase IDs, fetching line items from `purchase_items` joined with `bottles`.
- Each line item shows: bottle name + size + UOM, quantity, cost, real date, and date created.
- Individual line items can be deleted from the modal (AJAX `purchases/deletepitem`).
- **Batch delete** of line items is also available via checkboxes.

### 5b. Input Purchases

**URL:** `/purchases/inputpurchase`

Encodes a new delivery.

1. User selects a bottle from the dropdown (loaded from `client_bottles` for the branch, beverage category).
2. User fills in:
   - **Bottle Size** (auto-populated by bottle selection).
   - **Quantity** — number of bottles received.
   - **Cost** — cost per bottle.
   - **Real Date** — actual date of delivery.
3. On submit (`purchases/addpurchasesdata`):
   - Checks if a `purchases` header already exists for that real date. If yes, updates `total_purchases` (adds new total). If no, creates a new `purchases` record.
   - Inserts into `purchase_items` with `purchase_id`, `bottle_id`, `bottle_size`, `bottle_uom`, `qty`, `cost`, `user_id`, `real_date`, `date_created`.
   - Also inserts into `client_bottle_inventory` for inventory tracking.
   - Trail log entry written: "Add purchase."
4. A live preview section shows the last 5 entries (AJAX `purchases/purchaselivepreview`), and a counter shows today's total encoded items (`purchases/counttoday`).

**Important:** The `addPurchaseClientBottle` function exists in the model but is **commented out** in the controller — it was intended to auto-create `client_bottles` entries on purchase but is currently disabled.

### 5c. Input Forfeited Bottles

**URL:** `/purchases/forfeited`

Records bottles that were "forfeited" — i.e., partially consumed bottles left behind (e.g., unfinished client bottles).

1. User selects a bottle + size from the client's local database (`getClientBottles()`).
2. Enters: scale weight, liquid weight, tare weight, remaining ml, real date.
3. Submits to `purchases/addforfeitedbottle` → inserts into `client_forfeited_bottles`.
4. Live preview shows last 5 entries (AJAX `purchases/forfeitedlivepreview`).

### 5d. View Forfeited Bottles

**URL:** `/purchases/viewforfeited`

- Loads all forfeited bottle records (`getforfeitedliveentrylis()`, last 100) joined with bottles.
- Edit button navigates to `purchases/edit_forfeited` to correct a record.
- Delete button calls `purchases/delete_forfeited` which hard-deletes from `client_forfeited_bottles`.

---

## 6. Sales

**Sidebar label:** Sales  
**URL:** `/sales`

Records what was sold or consumed at the bar.

### 6a. View Sales

**URL:** `/sales` (index)

- Loads all sales from `client_sales` for the branch joined with `bottles`, `client_menus`, and `users`.
- Optional filters: `?real_date=`, `?stype=` (1 = revenue, 2 = non-revenue), sort by date, name, or created date.
- Shows: bottle/menu name, item type, sales type, quantity, date, user, size.
- **Edit:** Opens a form to correct a sale record (`sales/get_sale` returns the current record by `client_sales_id`). Updates posted to `sales/update_sales` or `sales/update_salesnonrev`.
- **Delete:** Soft-deletes by setting `is_deleted = 1` and recording `deleted_by`.
- **Batch delete** via checkboxes.

### 6b. Input Sales (Revenue)

**URL:** `/sales/inputsales`

Records revenue-generating sales (items sold to customers).

1. Dropdown of all **bottles and menus** for the branch (`getClientBottlesWithMenuDropdown()`).
2. On bottle/menu selection → AJAX `sales/getBottleOrMenuSizes` returns the available sizes with retail price.
3. User enters:
   - **Item** — bottle or cocktail menu item.
   - **Size** — selected from available sizes.
   - **Quantity**.
   - **Discount** — percentage.
   - **Real Date**.
4. Submit → `sales/addnewsales`:
   - If item_type is 1 (bottle) or 2 (menu ingredient approach): saves `bottle_id`, `bottle_size`, `bottle_uom`, `price`, `discount`, `total_quantity`, `item_type = 1`, `sales_type = 1`.
   - If item_type is 3 (cocktail menu): saves `menu_id`, `bottle_size = 1`, `bottle_uom = 'yield'`, `item_type = 2`, `sales_type = 1`.
   - Trail: "Added new sales."
5. Live preview shows last 5 revenue entries.

### 6c. Input Production

**URL:** `/sales/inputproduction`

Identical form and process to Input Sales but semantically represents production/preparation output rather than direct sales. Uses the same `addnewsales` flow, same `client_sales` table.

### 6d. Input Non-Revenue

**URL:** `/sales/inputnonrevenue`

Records consumption that generates no revenue — staff drinks, spillage, complimentary, breakage, etc.

1. Same dropdown as Input Sales, but uses `getClientBottlesDropdown()` (bottles only, no cocktail menus).
2. Additional field: **non_ml** — quantity in non-volume units (for food items, e.g., pieces, grams).
3. Submit → `sales/addnewnonrev`:
   - Same structure as revenue but `sales_type = 2`.
   - `non_ml` is saved alongside the record.
   - Trail: "Added non-rev."

---

## 7. Menu Items

**Sidebar label:** Menu Items  
**URL:** `/sales/menuitems`

Manages cocktail and menu item recipes.

### 7a. View Menu Items

**URL:** `/sales/menuitems`

- Loads all menus for the active client from `client_menus` joined with `client_menus_ingridients` and `bottles`.
- Shows: menu name, client/branch name, default cost, default retail, date created, encoder, and ingredient bottle names (comma-separated via `GROUP_CONCAT`).
- Sort by date or name (ASC/DESC via `?sort_date=` and `?sort_byname=` params).
- Edit opens a modal (`sales/getMenuFullDetails` + `sales/getAllMenuIngriModal`) showing all ingredients.
- Update saves new name and retail price via `sales/updatemenudetails`.
- Delete removes from `client_menus` (hard delete).

### 7b. New Menu Item

**URL:** `/sales/newmenu`

Creates a new cocktail/menu item with its ingredient list.

1. User enters a **menu name** and selects **ingredients** (bottles from the local database).
2. For each ingredient:
   - Bottle name (dropdown from `getClientBottlesDropdown()`).
   - Serving size (ml poured per serve).
   - ML price (cost per ml contribution).
   - Default price (cost of this ingredient per recipe).
   - UOM.
3. Running total of cost and retail price is computed client-side.
4. Submit:
   - Creates `client_menus` record with `cocktail_name`, `default_cost`, `default_retail`, `branch_id`, `client_id`, `user_id`.
   - For each ingredient, inserts into `client_menus_ingridients`: `bottle_id`, `menu_id`, `bottle_size`, `serving`, `ml_price`, `default_price`, `bottle_uom`.
   - Trail: "Add menu."

---

## 8. Local Database (Client Bottles)

**Sidebar label:** Local Database  
**URL:** `/clientbottles`

This is the per-client price and item configuration. It bridges the master bottle catalog with the specific costs and retail prices for each bar.

The sidebar badge shows a count of items with missing cost/retail prices (highlighted in red in the table). This badge refreshes via AJAX (`clientbottles/getCounter`).

### 8a. View Client Bottles

**URL:** `/clientbottles` (index)

- Loads all `client_bottles` records for the branch joined with `bottles` and `categories`.
- Table columns: Category, Item Name (+ size/UOM), Default Cost, Default Retail, Date Added, Added By.
- Rows highlighted **red** if `default_cost = 0` or `default_retail = 0`.
- **Edit:** Opens inline edit form (`clientbottles/getbottleedit`) to update cost/retail.
- **Delete:** Soft-deletes via `clientbottles/deletebottle` (sets `is_deleted = 1`).
- **Batch delete** via checkboxes → `clientbottles/delete_selected`.
- **Price Sync button:** Calls `clientbottles/syncalldata` — attempts to sync empty cost/retail from a reference (partially implemented).
- **Bottles Sync button:** Calls `clientbottles/syncallbottlesdata` — copies all available bottles into the branch's local DB.
- **Download to Excel:** Posts to `clientbottles/localdownload`, generates and downloads an `.xls` file with Category, Bottle Name, Default Cost, Default Retail, Date, Added By.

### 8b. Copy Local Database

**URL:** `/clientbottles/copylocaldatabase`

Used when setting up a new branch or copying one bar's price list to another.

1. Displays the **current client's** `client_bottles` records (items already in their database, pulled from a different client via `getAvailableClientBottles()`).
2. User checks which bottles to copy.
3. "Copy All Selected Brands" → submits form to `clientbottles/copyallfunction`.
4. For each checked `client_bottle_id`, calls `bottlesmodel->copylocaldb()` which inserts a new row into `client_bottles` with the destination `client_id` and `branch_id`.
5. Trail: "Copy all."

### 8c. Add Items to Branch (Modal)

Accessible via the "Add Items to Branch" button on both the main and copy-database views.

1. An AJAX call to `clientbottles/getAvailableBottles` (POST with `catType`) returns bottles from the **master database** that are **not yet** in the client's local database.
2. User selects a bottle + size + cost + retail.
3. Submit → `clientbottles/addbrandsclientmanual` → calls `bottlesmodel->addClientBottleManual()`.
   - Duplicate check: `checkClientBottle2()` ensures the bottle-size-UOM combination doesn't already exist for this client.
   - If not a duplicate: inserts into `client_bottles`.
   - Trail: "Added Brand."

---

## 9. LIS Inventory (Wunderbar Spout Data)

**Sidebar label:** LIS Inventory  
**URL:** `/lis_inventory`

Handles data from an automated liquor dispensing system (Wunderbar or LIS spout). The device logs every pour made through the spout, and this module uploads and reconciles that data.

### 9a. View All Spout Data (VASD)

**URL:** `/lis_inventory` (index)

- Shows all individual pour records from `lis_inventory` for the branch, joined with `users`.
- Columns: bottle name (as the device reported it), size selected, shot size (ml poured), dispense size, time, transaction date.
- Edit icon → opens `lis_inventory/editspout` to correct misidentified bottle assignments.
- Delete → hard-deletes from `lis_inventory`.

### 9b. View Consolidated Spout Data (VCSD)

**URL:** `/lis_inventory/consolidated`

- Groups pours by bottle name and shot size to show aggregated totals:
  - Total dispense size, total pour size, total allocated size.
- Useful for seeing daily throughput by brand.

### 9c. Upload Spout Data (USD)

**URL:** `/lis_inventory/uploadspout`

Imports raw data from the Wunderbar device (Excel file).

1. User selects a **transaction date** and uploads the Excel file from the device.
2. System reads the file via PHPExcel (`lis_inventory/wbupload` → `readExcel()`).
3. For each row, `insertwunderbar()` is called:
   - Looks up the bottle by name in the `bottles` table (`checkbottleid()`).
   - If matched: saves `bottle_id` and `bottle_name`. If not matched: `bottle_id = 0`, `bottle_name = 'None'`.
   - Inserts into `lis_inventory`: `modified_by`, `branch_id`, `client_id`, `size_selected`, `shot_size`, `dispense_size`, `time`, `bottle_id`, `bottle_name`, `trans_date`.
4. After upload, unmatched bottles (where `bottle_id = 0`) are surfaced for manual assignment via `editspout`.

### 9d. Batch Spout Update

**URL:** `/lis_inventory/batchspoutupdate`

Allows correcting bottle assignments for multiple spout records at once.

### 9e. Update Retail Value (URV)

**URL:** `/lis_inventory/retailvalue`

- Shows all bottles in the Wunderbar pricing table (`wunderbar_pricing`) for the branch, joined with `bottles` and `categories`.
- Also shows unsynced items — bottles in `client_bottles` not yet in `wunderbar_pricing`.
- **Add:** `addbrandmlwunder()` inserts a new price entry into `wunderbar_pricing` with `bottle_id`, `branch_id`, `client_id`, `spout_price`, `bottle_ml`.
- **Edit:** `updatert()` / `updatewunderretail()` updates the `spout_price`.
- **Delete:** `deletert()` / `deletewunderretail()` removes from `wunderbar_pricing`.
- **Sync:** `syncrt()` syncs bottle pricing from `client_bottles.default_retail` to `wunderbar_pricing`.

---

## 10. Reports

**Sidebar label:** Reports  
**URL:** `/reports`

The final output layer. Calculates variance, cost analysis, and performance metrics by comparing audit counts against purchases, sales, and forfeited bottles.

The reports page switches to a collapsed sidebar layout (`nav-sm`) for more horizontal screen real estate.

### 10a. Food Full Audit Report (Default Index)

**URL:** `/reports` (index, no `?report=` param)

Displays a **category-based** food inventory report.

- Fetches audit date list from `client_bottle_audits` for the branch.
- User selects an audit date from the dropdown.
- `getauditbottlesreportsByCatForFood()` returns distinct category+UOM combinations from the audited items for that date.
- `reportheader()` and `reportheadercat()` build the report column headers (audit dates, purchase dates).
- The report calculates for each category:
  - Opening stock (previous audit).
  - Purchases during period.
  - Closing stock (current audit).
  - Sales (revenue + non-revenue).
  - Theoretical usage.
  - Actual usage (opening + purchases − closing).
  - Variance (actual − theoretical).
  - Variance % and cost of variance.
- With `?report=` param → switches to the flat per-bottle view (`food_fullaudit`) instead of category grouping (`food_fullauditcat`).

### 10b. Beverage Full Audit Report

**URL:** `/reports/beverage` (sidebar link or secondary nav)

Same structure as the food report but filters to `bottle_uom = 'ml'` (liquid beverages).

- `getauditbottlesreportsByCatBeverage()` drives the category list.
- `getauditbottlesreportsBeverage()` returns per-bottle rows with opening, closing, purchases, sales, and variance.
- With `?report=` param → per-bottle view; without → category-grouped view.

### 10c. Excel Downloads

Every report view has download buttons that trigger Excel generation via PHPExcel:

| Function | Output |
|---|---|
| `food_download` | Flat food report per bottle |
| `food_downloadCat` | Category-grouped food report |
| `food_downloadCA` | Food cost analysis by category |
| `beverage_downloadCA` | Beverage cost analysis (period-date range) |
| `newlayout` | Beverage full audit Excel (simple layout) |
| `newlayoutpluscost` | Beverage full audit with cost column |
| `reportExcelHeaderByCatNew2015` + `reportexceldatabycatnew_plus_cost` | Full beverage audit with costs, new layout |
| `reportexceldatavariance` | Variance-only report |
| `reportWunderExcelHeader` + `wundercontent` | Wunderbar/LIS pour report |

All Excel downloads stream directly to the browser as `.xls` attachment.

### 10d. Graph / Analytics

**URL:** `/reports/graph`

- Loads the `consolidate_model` to pull chart data.
- Three chart types via POST `catType`:
  - **topbrands** — top N brands by quantity sold (from `sales_beverage` or `sales_kitchen` view).
  - **topmenus** — top N cocktail menus by quantity (from `sales_menu` view).
  - **topingridients** — top N ingredients by serving quantity (from `top_ingridients` view).
- User selects a date range and item limit.
- Data is rendered as a chart on the page (via Chart.js from `assets/vendors`).

### 10e. Wunderbar Report

**URL:** `/reports/wunderrep`

- Compares LIS spout data (`lis_inventory`) against manual audit data for the same period.
- Shows bottle-by-bottle pour totals from the device vs. stock movement from audits.

---

## 11. Admin-Only Pages

These links only appear in the sidebar when `user_level == 1`.

### 11a. Clients

**URL:** `/clients`

Manages client (bar/restaurant) accounts and their branch assignments.

- **View:** Lists all clients with status, assigned users.
- **Add Client:** Creates a `clients` record + a default `branches` record ("Main") + links users via `clients_bar`.
- **Add Branch:** Adds an additional `branches` record to an existing client.
- **Update:** Renames the client and re-assigns bar staff users.
- **Delete:** Soft-deletes (sets `status = 1`).
- **Copy Local DB:** Copies all `client_bottles` and `client_menus` / `client_menus_ingridients` from one client to another. Done as a database transaction. This is how a new client gets a starting price list from an existing one.

### 11b. Trail (Audit Log)

**URL:** `/trail`

- Shows the last 500 entries from the `trail` table joined with `users`.
- Columns: user, action name, description (includes client context), date.
- Read-only. Every significant user action across the system writes a trail record.

### 11c. Users

**URL:** `/users`

- Lists all users with status (active/inactive indicator), email, date registered, and user level selector.
- **Activate/Update:** Clicking the save icon sets `status = 1` and updates `user_level` for a user.
- **Delete:** Hard-deletes from `users`.

### 11d. Main Database (via top-right dropdown)

**URL:** `/bottles`

Accessible to Admins from the user dropdown menu (not the sidebar).

Manages the **master bottle catalog** — the source of truth for all products in the system.

- **Add Category:** Creates a `categories` record (name, type: food=1 / beverage=2, liquid weight for beverages).
- **Add Item (bottle):**
  - Select category type and category.
  - Enter item name (live duplicate-name check via AJAX `home/checkbottlename`).
  - Add one or more sizes: each size gets a size value, tare weight, and UOM.
  - For beverages: enter liquid weight + liquid UOM.
  - Submits to `bottles/addbottle` which inserts into `bottles`, then for each size into `bottle_sizes`, then into `bottle_tare_weights` and `bottle_liquid_weights`.
- **Edit:** Updates `bottles` record name and category; deletes and recreates `bottle_sizes`.
- **Delete:** Soft-deletes `bottles` record (sets `is_deleted = 1`).
- **Delete Category:** Hard-deletes from `categories`.

---

## 12. User Registration

**URL:** `/register/registration_form`

Accessible outside the main authenticated flow. Creates a new user account. Fields: `username`, `password`, `email`, `fname`, `lname`. Password is encrypted via CI's `encrypt->encode()` using the `encryption_key` config value. New accounts have `status = 0` by default but must be **activated by an Admin** via the Users page before they can log in.

---

## End-to-End Flow Summary

```
User registers → Admin activates account → User logs in
    ↓
Admin creates/assigns client + branch → Admin adds bottles to Main Database
    ↓
Admin/Team Lead sets up Local Database (client_bottles) with cost + retail prices
    ↓                            ↓
[Optional] Copy prices from     Add bottles manually or via
another client's DB             "Add Items to Branch" modal
    ↓
[Optional] Set up Menu Items (cocktail recipes with ingredients + ml prices)
    ↓
Daily Operations:
    ├── AUDIT — count all bottles (full + open/weighed) → client_bottle_audits
    ├── PURCHASES — log deliveries received → purchases + purchase_items
    ├── SALES — log what was sold (revenue) → client_sales (sales_type=1)
    ├── PRODUCTION — log internal production output → client_sales (sales_type=1)
    ├── NON-REVENUE — log spillage/staff/comp → client_sales (sales_type=2)
    └── [If Wunderbar device present] Upload spout data → lis_inventory
    ↓
REPORTS — select audit date(s) → system calculates:
    Opening Stock (prev audit) + Purchases − Closing Stock (curr audit)
    = Actual Usage
    vs.
    Sales (revenue + non-revenue) + Theoretical pour
    = Theoretical Usage
    ↓
    Variance = Actual − Theoretical
    Variance Cost = Variance × Default Cost per unit
    ↓
    Download as Excel or view on-screen
```

---

## Key Business Rules

- **`?bta-client=` is mandatory on every page.** Missing it triggers automatic resolution and redirect.
- **Audit dates drive all reports.** There is no arbitrary date-range picker in the main reports — the system uses actual audit event dates as the period anchors.
- **Soft deletes everywhere** (audit records, bottles, client bottles, sales) except forfeited bottles, purchase items, categories, and user deletions, which are hard deletes.
- **Trail log written on every significant write operation.** Name + description + client context + timestamp.
- **`check_account()` runs on every page load** for logged-in users. It automatically deactivates any `user_level = 3` (Assistant) account whose `modified_date` is older than 9 days.
- **Demo/Assistant limit:** Level-3 users cannot have more than 15 brands in the local database.
- **Client switching** is available from the top-right dropdown on every page, carrying the current URI path so the user stays on the same page but views a different client's data.

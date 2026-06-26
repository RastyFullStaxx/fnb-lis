# FNB/LIS Legacy System Modernization Plan

**Working title:** Modern Bar and Kitchen Inventory Management System powered by LIS / Stocky  
**Reference systems:** FNB/LIS legacy codebase, project proposal, and StockLedger prototype concepts  
**Primary goal:** Preserve the client’s real inventory-audit workflow while rebuilding the system with modern architecture, cleaner UX, offline desktop operation, API-based ingestion, reliable reports, and future scalability.

---

## 1. Executive Summary

The next system should not be treated as a simple redesign of the current StockLedger prototype. The correct direction is a **legacy-first modernization**.

The FNB/LIS legacy system already contains the client’s operational truth: bar inventory audits, local item databases, purchases, sales, non-revenue usage, forfeited stock, menus/recipes, open-bottle weighing, POS/spout imports, and food/beverage audit reports. The modernization should preserve those workflows, but rebuild them in a safer, cleaner, more scalable, and more user-friendly way.

The StockLedger prototype remains useful as a **design and architecture reference** because it already explored event ledger thinking, audit trails, modern UI, reports, products, purchases, sales, suppliers, users, and Stocky chatbot direction. However, the production system should be driven by the legacy FNB/LIS workflow, not by the prototype’s current feature order.

The final system should become:

> A modern, offline-capable, audit-grade bar and kitchen inventory platform that preserves the legacy FNB/LIS audit logic while making daily operation dramatically easier, cleaner, faster, and more scalable.

The core product must support:

- Desktop application for offline use
- Local SQLite storage with sync to a central backend
- Clean audit/event history
- Food and beverage inventory
- Full physical counts and open-bottle counts
- Purchases, sales, non-revenue, forfeited stock, and recipe/menu consumption
- POS/file ingestion through external API processing for image, PDF, CSV, and other client-specific formats
- Review-before-commit import workflow
- Report generation in PDF, Excel, and CSV
- Stocky chatbot assistant
- Very clean, low-clutter, modern user interface
- Multi-client and package-ready architecture for future resale or subscription deployment

---

## 2. Modernization Philosophy

### 2.1 Preserve the business logic, replace the implementation

The legacy system’s UI, code quality, database naming, and technical structure are outdated, but its business calculations are valuable. We should not blindly copy the code. Instead, we should extract the business meaning behind each workflow and rebuild it using modern patterns.

The modernization rule should be:

```text
For every legacy function, we must explain:
1. What it does in the old system.
2. Why the client uses it.
3. What business calculation it affects.
4. How the new system will preserve it.
5. How the new system will make it cleaner, safer, and easier.
```

### 2.2 Make the ledger invisible to staff

Internally, the system can use events, audit trails, compensating transactions, and deterministic calculations. But the staff interface should not expose technical terms like `STOCK_IN`, `STOCK_OUT`, or `STOCK_REVERT` unless the user is in an advanced audit/developer view.

The user should see simple workflows:

- Receive Purchase
- Record Sale
- Record Non-Revenue
- Count Full Items
- Count Open Bottles
- Forfeit Stock
- Import POS File
- Review Imported Data
- Generate Audit Report
- Correct Mistake
- Undo Record

The system handles the ledger underneath.

### 2.3 Reports are the source of client trust

The client will likely judge the new system by whether the full audit reports match or improve the legacy reports. Therefore, reports should not be left until the end.

The first production milestone must include a report engine that can reproduce the legacy food and beverage audit calculations in a clean format.

### 2.4 Use StockLedger as reference, not as the final blueprint

StockLedger concepts worth preserving:

- Event-based inventory history
- Immutable audit trail
- Revert/correction model
- Clean modern UI direction
- Stocky assistant
- Products, suppliers, purchases, sales, menus, reports
- Offline-first direction

StockLedger concepts that must be reworked:

- Generic inventory movement model must become bar/kitchen audit-specific.
- Client/customer terminology must be cleaned up.
- Reports must be grounded in FNB/LIS audit periods.
- Open-bottle weighing must become a first-class workflow.
- POS/file ingestion must support varied client formats using an API, not only fixed templates.

---

## 3. Target Product Identity

### 3.1 What the new system is

The new system is a modern desktop-first inventory audit platform for bars, kitchens, restaurants, and food/beverage operations. It tracks stock movements, physical counts, purchases, sales, menus, non-revenue usage, and variances.

It is not merely an inventory list. Its primary business function is **audit-period reconciliation**:

```text
Beginning Count
+ Purchases
- Ending Count
= Computed Usage

Computed Usage
vs Sales / Menu Usage / Non-Revenue / POS Imports
= Variance
```

### 3.2 What the new system should not become

The system should not become:

- A generic CRUD inventory app
- A full accounting system
- A cluttered ERP dashboard
- A fully automatic AI system that writes data without human review
- A complicated technical ledger interface for non-technical staff

### 3.3 Product promise

The practical promise to the client should be:

> The old system’s logic, but faster, cleaner, safer, offline-capable, and easier for staff to use.

---

## 4. Requirement Fulfillment Strategy

### 4.1 Legacy system review and process preservation

Requirement:

- Use the legacy system as the functional and structural reference.

Plan:

- Document every legacy module.
- Identify which workflows are mandatory.
- Translate legacy database tables into modern entities.
- Preserve food/beverage audit logic.
- Preserve important report formulas.
- Remove or redesign confusing legacy pages.
- Start with a clean data model rather than live historical migration.

Deliverables:

- Legacy workflow map
- Legacy data dictionary
- Legacy-to-modern feature matrix
- Report formula specification
- Modern entity relationship diagram

---

### 4.2 Desktop app for offline use

Requirement:

- Create a desktop app version for offline use.

Plan:

The production app should be desktop-first using Electron or an equivalent desktop wrapper. The desktop application should contain:

- Renderer UI: React or similar modern frontend
- Main process: secure desktop shell and local services
- Local database: SQLite
- Local file storage: imported files, generated reports, temporary extraction outputs
- Sync service: queues local records and synchronizes when online
- Local authentication/session cache for allowed offline users

Offline behavior:

1. User logs in while online and device is authorized.
2. System caches permitted user profile, tenant, branch, and role permissions.
3. User can create counts, purchases, sales, non-revenue entries, and reports offline.
4. Each action is written to local SQLite.
5. Each action is placed in a local sync outbox.
6. When internet returns, the desktop app syncs with the backend.
7. Backend validates events, applies idempotency checks, and commits accepted records.
8. Conflicts are shown to the user in a human-readable review screen.

Important desktop security rules:

- The UI renderer should not directly access the file system or database.
- Node integration should be disabled in the renderer.
- Sensitive operations should go through secure IPC or a local service layer.
- The installer should be license/device-bound where required.
- Local data should be encrypted or protected where practical.

---

### 4.3 Backend and database architecture

Requirement:

- Build a modern architecture that supports audit-grade operations and future scalability.

Plan:

Use a modular backend, preferably NestJS with PostgreSQL, because it gives strong TypeScript structure, clean module boundaries, validation, OpenAPI documentation, and room for event-driven workflows.

Recommended backend style:

- Start as a **modular monolith**, not microservices.
- Use domain modules with clean boundaries.
- Use PostgreSQL for central source-of-truth data.
- Use SQLite for offline desktop storage.
- Use event tables for inventory history.
- Use read models and snapshots for fast reports.
- Use background jobs for imports, report generation, and AI extraction.
- Use OpenAPI for contract documentation.

Recommended modules:

```text
Auth Module
Tenant / Client Module
Branch / Location Module
User & RBAC Module
Item Master Module
Unit Conversion Module
Open Bottle Profile Module
Supplier Module
Purchase Module
Sales Module
Non-Revenue Module
Forfeited Stock Module
Menu / Recipe Module
Audit Session Module
Inventory Event Module
Import / Ingestion Module
Report Module
Stocky Assistant Module
Sync Module
Settings Module
Notification Module
```

Why modular monolith first:

- Faster to build within the project timeline
- Easier to test
- Easier to deploy
- Easier to debug for a small team
- Still scalable if module boundaries are clean
- Avoids premature microservice complexity

---

### 4.4 Inventory ledger and audit model

Requirement:

- Every inventory operation must be traceable and correctable without silently deleting history.

Plan:

The system should use an append-only event/audit model for inventory-affecting actions.

Core event types:

```text
PURCHASE_RECEIVED
SALE_RECORDED
MENU_SALE_RECORDED
NON_REVENUE_RECORDED
FORFEITED_STOCK_RECORDED
FULL_COUNT_RECORDED
OPEN_BOTTLE_COUNT_RECORDED
MANUAL_ADJUSTMENT_RECORDED
IMPORT_BATCH_COMMITTED
RECORD_REVERTED
RECORD_CORRECTED
```

Each event should store:

- Event ID
- Tenant/client ID
- Branch/location ID
- User ID
- Device ID
- Timestamp created
- Business date
- Source module
- Source record ID
- Event type
- Payload
- Idempotency key
- Sync status
- Reversal/correction reference, if applicable

User-facing correction model:

| User action | Internal handling |
|---|---|
| Edit purchase | Create correction event and replacement values |
| Delete sale | Create void/reversal event |
| Undo imported batch | Reverse all committed events from that batch |
| Correct count | Preserve old count and create new corrected count |
| Fix AI/POS extraction error before commit | Edit staging rows only; no ledger event yet |

This keeps the app friendly while preserving audit history.

---

### 4.5 Master data and item model

Requirement:

- Support drinks, food/menu items, unit conversion, cost, retail price, and open-bottle logic.

Plan:

Create a modern item model that expands the legacy `bottles` concept into a more accurate product/inventory structure.

Recommended entities:

```text
Item
ItemCategory
ItemType
ItemPackage
UnitOfMeasure
UnitConversion
BranchItem
OpenBottleProfile
SupplierItem
```

Item fields:

- Name
- Description
- Category
- Type: Food, Beverage, Asset, Supply, Other
- Base unit: ml, g, pcs, bottle, pack, kg, liter, etc.
- Track stock: yes/no
- Track as open bottle: yes/no
- Active/inactive

Branch item fields:

- Branch/location
- Default cost
- Default retail price
- Par stock
- Reorder threshold
- Preferred supplier
- Local aliases
- POS matching aliases

Open bottle profile fields:

- Bottle size
- Unit of size, usually ml
- Empty container/tare weight
- Liquid weight factor
- Scale weight input allowed: yes/no
- Category default fallback

This preserves the legacy local database concept while making it easier to understand.

---

### 4.6 Audit session workflow

Requirement:

- Preserve the legacy audit workflow and full audit report logic.

Plan:

The modern system should introduce a clear **Audit Session** concept.

Audit session fields:

- Audit session name
- Branch/location
- Start audit date
- End audit date
- Status: Draft, Counting, Review, Closed, Reopened
- Created by
- Closed by
- Notes

Audit workflow:

```text
1. Create audit session
2. Choose branch/location
3. Select count type: Beverage, Food, or Both
4. Generate count sheet
5. Count full items
6. Count open bottles/weighed bottles
7. Review missing or unusual counts
8. Save audit count
9. Encode/import period activity
10. Generate full audit report
11. Investigate variance
12. Close audit session
```

Audit count types:

| Count type | Purpose |
|---|---|
| Full count | Counts unopened/full bottles, packs, pieces, kilos, etc. |
| Open bottle count | Estimates remaining bottle content through scale weight, tare, and liquid factor |
| Food count | Counts food ingredients or kitchen items by UOM |
| Asset count | Optional future support for non-consumable assets |

Open bottle calculation:

```text
Net Weight = Scale Weight - Tare Weight
Remaining Content = Net Weight × Liquid Weight Factor
Remaining Bottle Equivalent = Remaining Content / Bottle Size
```

Why this matters:

- Bars often need to estimate partially used liquor bottles.
- Counting only full bottles ignores real remaining stock.
- Weighed open-bottle counts improve beverage audit accuracy.
- This directly affects usage, cost, and variance in reports.

The page should display:

- Item name
- Bottle size
- UOM
- Tare weight
- Liquid weight factor
- Scale weight input
- Computed net content
- Computed remaining ml
- Equivalent bottle quantity
- Warning if scale weight is below tare weight
- Warning if computed content exceeds bottle size

---

### 4.7 Purchases and supplier workflow

Requirement:

- Support purchase records, suppliers, cost, quantity, reports, and stock-in behavior.

Plan:

Purchases should be a business workflow that creates stock-in events.

Purchase workflow:

```text
1. Create purchase receipt or purchase order
2. Select supplier
3. Set business date / cutoff period
4. Add purchase lines
5. Enter quantity, unit, cost, discount, amount
6. Validate unit conversion
7. Save as draft or commit
8. Committed purchase increases stock through ledger events
9. Purchase can be corrected or voided later
10. Purchase report can be exported
```

Important fields:

- Supplier
- Invoice/reference number
- Purchase date
- Encoding date
- Cutoff period
- Item
- Quantity
- UOM
- Unit cost
- Discount
- Amount
- Notes
- Source: manual, CSV import, PDF/image extraction, API import

Modern improvements:

- Draft before commit
- Bulk item entry
- Supplier-specific aliases
- Auto-calculated amount
- Validation for missing cost or UOM mismatch
- Cost averaging by period
- Export to Excel/PDF/CSV

---

### 4.8 Sales, non-revenue, production, and menu workflow

Requirement:

- Preserve sales, menu consumption, non-revenue usage, and production logic.

Plan:

Sales should be handled as business records that generate stock-out consumption.

Sales types:

```text
Direct Item Sale
Menu / Cocktail Sale
Non-Revenue Usage
Production Usage
Complimentary / Comp
Wastage / Spoilage
Internal Use
```

Sales workflow:

```text
1. User records sale manually or imports POS file
2. System maps POS/menu item to internal item or recipe
3. User reviews quantity, price, discount, amount
4. User commits record
5. System generates consumption events
6. Reports compare sales consumption against audit usage
```

Menu/cocktail sale behavior:

```text
Menu item sold
→ Identify active recipe version at sale date
→ Expand recipe lines
→ Convert quantities to base units
→ Create grouped stock-out events per ingredient
```

Non-revenue behavior:

```text
Non-revenue entry
→ Select reason: wastage, comp, internal use, spoilage, breakage, tasting, staff meal, etc.
→ Create stock-out event with non-revenue classification
→ Include in non-revenue report and variance analysis
```

Production behavior:

Production should be reviewed carefully with the client. In the legacy system, production appears as a sales-related entry type. In the modern system, it may be better modeled as either:

1. A stock transformation workflow, if ingredients become a prepared item; or
2. A usage classification, if production simply represents consumed ingredients.

This should be clarified before implementation.

---

### 4.9 Menu and recipe engineering

Requirement:

- Support menu items, recipes, ingredient propagation, and correct historical reporting.

Plan:

Create a versioned recipe system.

Entities:

```text
MenuItem
RecipeVersion
RecipeLine
IngredientSnapshot
CostSnapshot
```

Recipe workflow:

```text
1. Create menu item
2. Add ingredients
3. Define quantity per serving
4. Define UOM per ingredient
5. System converts to base unit
6. System computes estimated cost
7. User publishes recipe version
8. Future sales use the active recipe version
9. Past sales keep the recipe version active at the time
```

Why versioning is required:

- If a cocktail recipe changes, old sales reports must not change.
- If ingredient price changes, historical cost reports should remain explainable.
- If an ingredient is replaced, future sales should use the new recipe but old reports should remain accurate.

Modern improvements:

- Clear recipe builder UI
- Searchable ingredient picker
- Cost preview
- Gross margin preview
- Version history
- Effective date
- Copy/duplicate recipe
- Missing ingredient warnings

---

### 4.10 API-based POS/file ingestion

Requirement:

- Allow file ingestion so the system can input data by uploading different clients’ POS files in image, PDF, or CSV.
- Avoid training a custom AI model for each client’s file style.
- Use an API for extraction/understanding.

Plan:

Build a controlled ingestion pipeline using external AI/document-processing APIs for unstructured or variable client formats, and deterministic parsing for simple CSV/Excel where possible.

Accepted input types:

- CSV
- Excel
- PDF
- Image files: JPG, PNG, screenshots, scanned POS reports
- Future: email-attached reports or API integrations from POS providers

Ingestion pipeline:

```text
1. User uploads file
2. System stores file in import batch
3. System detects file type
4. CSV/Excel goes through deterministic parser first
5. PDF/image goes through external API extraction
6. API returns structured candidate rows
7. System normalizes rows into staging table
8. System maps source names to internal items, menus, suppliers, or categories
9. User reviews extracted data
10. User corrects unmatched or low-confidence rows
11. User commits approved rows
12. System creates purchase/sales/non-revenue/audit events
13. Report history records source file and extraction result
```

Important design principle:

> AI/API extraction should never directly mutate inventory. It should only create reviewable staging records.

Staging row fields:

- Source file
- Source page/sheet/row
- Extracted item name
- Matched internal item/menu
- Transaction category: Audit, Sales, Purchase, Non-Revenue
- Quantity
- UOM
- Discount
- Price
- Amount
- Business date
- Confidence score
- Warnings
- User correction fields
- Commit status

Mapping strategy:

```text
Exact match
→ Alias match
→ Fuzzy match
→ Previous client mapping
→ User manual mapping
→ Save mapping for future imports
```

For example:

```text
POS says: "Tanduay 5Y 750"
System maps to: "Tanduay 5 Years Rum 750ml"
Mapping saved for that client/tenant.
```

API extraction strategy:

- Use a multimodal model/API for PDFs and images.
- Use structured output schemas so responses are returned in predictable JSON.
- Use CSV/Excel parsing for structured files before invoking AI to reduce cost.
- Keep extraction prompts/schema per import type: sales, purchase, audit, unknown.
- Store original file, raw extraction output, normalized rows, and final committed records.
- Add cost controls, file size limits, retries, and user confirmation.

Safety guardrails:

- No automatic commit.
- Show extracted values before saving.
- Flag low-confidence fields.
- Require mapping for unknown items.
- Keep original uploaded file attached to the import batch.
- Log who approved the import.
- Allow full batch reversal after commit through compensating events.

This makes the system flexible for different client POS formats without the cost and time of training a custom AI model.

---

### 4.11 Stocky chatbot assistant

Requirement:

- Keep Stocky, the chatbot from StockLedger.

Plan:

Stocky should remain, but it should be scoped carefully. It should be an assistant, not an autonomous operator.

Stocky should help with:

- Explaining how to use the system
- Finding reports
- Answering questions about stock levels
- Explaining variance results
- Searching item history
- Summarizing audit sessions
- Helping users understand why a value looks wrong
- Guiding users through import review
- Explaining formulas like usage, variance, net content, and cost

Stocky should not be allowed to:

- Secretly edit inventory
- Commit imports without confirmation
- Delete records
- Override audit rules
- Hide variance issues
- Invent stock values

Recommended Stocky architecture:

```text
User question
→ Permission check
→ Retrieve relevant system data
→ Retrieve documentation/help articles
→ Generate answer with citations/links to source records
→ Offer safe action buttons when appropriate
```

Stocky can answer questions like:

```text
Why is Jose Cuervo showing a shortage this week?
How is the open bottle content calculated?
Show me purchases from Supplier A this month.
Which imported POS rows are still unmatched?
What changed between the last two audit sessions?
Explain the Beverage Full Audit report.
```

Recommended implementation:

- Use RAG over system documentation, user manual, and report explanations.
- Use tool/function calls for safe read-only queries.
- Use role-based permissions.
- For write actions, Stocky should only prepare drafts or navigate the user to the right screen.
- Require explicit button confirmation for any inventory-affecting action.

---

### 4.12 Report generation

Requirement:

- System must produce reports.

Plan:

Reports should be treated as a first-class subsystem, not an afterthought.

Core reports to implement first:

1. Beverage Full Audit Report
2. Food Full Audit Report
3. Date-Filtered Audit Report
4. Sales Report
5. Purchase Report
6. Non-Revenue Report
7. Forfeited Stock Report
8. Inventory on Hand Report
9. Menu/Recipe Cost Report
10. Variance Report
11. Import Batch Report
12. User Activity/Audit Trail Report

Report output formats:

- On-screen interactive report
- PDF export
- Excel export
- CSV export

Report design principles:

- Match legacy calculations first.
- Improve layout second.
- Use clean grouping by category.
- Highlight variances automatically.
- Allow drill-down from report cell to source records.
- Allow custom date range and cutoff periods.
- Keep report formulas documented.

Full audit report calculation model:

```text
Beginning Inventory
+ Purchases
+ Other Additions, if applicable
- Ending Inventory
= Computed Usage

Expected Usage = Sales + Menu Consumption + Non-Revenue + Production/Other Usage

Variance = Computed Usage - Expected Usage
Variance Cost = Variance × Cost Price
Variance Retail = Variance × Retail Price
Variance % = Variance / Expected Usage or configured basis
```

Open-bottle counts must be included in beginning and ending inventory totals.

Performance strategy:

- Use read models for common report queries.
- Use snapshots per audit session or date range.
- Cache generated exports.
- Recalculate only affected ranges when corrections happen.
- Store report generation metadata.

---

### 4.13 User experience and interface direction

Requirement:

- Very user-friendly, clean, modern, no visual clutter.

Plan:

The UI should feel closer to a premium desktop productivity app than a legacy admin dashboard.

Design principles:

- Minimal visual noise
- Clear hierarchy
- Fewer tables on first view
- Progressive disclosure: show details only when needed
- Strong search and filtering
- Guided workflows
- Large readable inputs for staff
- Fast keyboard-friendly data entry
- Clear empty states
- Friendly error states
- Audit confidence without intimidating users

Recommended main navigation:

```text
Dashboard
Audit Sessions
Inventory
Purchases
Sales
Menus & Recipes
Imports
Reports
Suppliers
Settings
Stocky
```

Recommended dashboard:

- Current audit period status
- Items needing attention
- Low stock alerts
- Unmatched import rows
- Variance warnings
- Recent activity
- Quick actions

Avoid dashboard clutter:

- Do not show every metric at once.
- Do not overload with charts.
- Use cards sparingly.
- Prioritize operational action over decorative visuals.

Recommended quick actions:

```text
Start Audit
Count Items
Receive Purchase
Record Sale
Import POS File
Generate Report
Ask Stocky
```

Screen design pattern:

```text
Page title
Short helper line
Primary action button
Filter/search bar
Clean table or card list
Side panel/detail drawer for record details
```

Modern UX improvements over legacy:

- Wizards for audit and import workflows
- Inline validation
- Smart defaults
- Auto-save drafts
- Recent items
- Saved filters
- Keyboard shortcuts
- Toast confirmations
- Undo/revert guidance
- Role-based simplified views

---

## 5. Modern Technical Standards

### 5.1 Language and type safety

Recommended:

- TypeScript across frontend and backend
- Shared DTO/schema definitions where practical
- Runtime validation using schemas
- Strict database constraints
- Strong typing for event payloads

Benefits:

- Fewer runtime bugs
- Safer refactoring
- Easier onboarding
- Better API documentation

### 5.2 Clean architecture

Use layered architecture inside each module:

```text
Controller / API Layer
Application Service Layer
Domain Logic Layer
Repository / Persistence Layer
Integration Layer
```

Rules:

- Controllers should not contain business logic.
- Report formulas should not be scattered inside UI code.
- Inventory calculations should be centralized and tested.
- Import parsing should produce normalized staging records.
- External API calls should be isolated behind provider interfaces.

### 5.3 Database quality

Use migrations, constraints, and indexing.

Important database practices:

- Foreign keys for core relationships
- Unique constraints for idempotency keys
- Indexes on tenant, branch, item, business date, event type
- Soft delete only for master data where needed
- Append-only records for inventory events
- Audit columns on business records

### 5.4 Testing strategy

Minimum test coverage should focus on business correctness.

Must-test areas:

- Open-bottle net content calculation
- UOM conversion
- Beginning + purchases - ending usage formula
- Menu recipe expansion
- Sales-to-stock consumption
- Non-revenue classification
- Forfeited stock effect
- Purchase cost averaging
- Import staging and commit
- Revert/correction behavior
- Report calculations
- Offline sync idempotency

Test types:

```text
Unit tests for formulas
Integration tests for modules
End-to-end tests for workflows
Golden-file tests for report exports
Import fixture tests for sample POS files
Offline sync simulation tests
```

### 5.5 Security and permissions

Required security features:

- Role-based access control
- Tenant isolation
- Branch-level access control
- Device-bound desktop installation, if required
- Local session protection
- Audit trail of sensitive actions
- Import file validation
- File type and size restrictions
- API key protection for AI ingestion
- No raw AI prompt/output exposure to normal users unless needed for audit/debugging

Roles:

```text
Global Admin
Owner / Client Admin
Manager
Employee / Staff
Read-only Auditor
```

Initial deployment can enable only Owner and Employee, but the architecture should support the rest.

### 5.6 Observability and support

The system should include support tooling from the start.

Recommended:

- Error logs
- Sync logs
- Import logs
- Report generation logs
- User activity logs
- Health check screen
- Export diagnostic bundle for support
- Version number visible in settings
- Update channel for desktop app

---

## 6. Proposed Production Stack

### 6.1 Recommended stack

```text
Frontend/Desktop UI: React + TypeScript + Vite
Desktop Shell: Electron
Local Database: SQLite
Backend: NestJS + TypeScript
Central Database: PostgreSQL
API Contracts: OpenAPI / Swagger
Validation: Zod or class-validator/class-transformer
Background Jobs: BullMQ or equivalent queue system
File Storage: Local desktop storage + backend object/file storage
Reports: Server-side report generator + desktop export support
AI/API Ingestion: External multimodal/file-processing API behind ingestion service
Chatbot: Stocky assistant using RAG + safe tool calls
```

### 6.2 Why this stack works

- React gives a modern UI development experience.
- Electron supports desktop packaging and offline operation.
- SQLite is reliable for local offline storage.
- NestJS gives modular backend structure.
- PostgreSQL gives transactional reliability and strong reporting queries.
- A queue system separates slow tasks like import extraction and report generation.
- External APIs handle variable POS file formats without training a custom model.

### 6.3 Important architecture decision

Do not overbuild into microservices at the start.

Build a clean modular monolith that can later split modules if needed.

This gives the project the best balance of:

- Speed
- Maintainability
- Scalability
- Testability
- Deployment simplicity

---

## 7. Data Migration and Transition Plan

The new system should use a clean-slate data model for transactions. Legacy historical transaction migration is not recommended unless separately scoped.

However, some reference data can be imported:

Possible to import:

- Item master list
- Categories
- UOMs
- Bottle sizes
- Tare weights
- Liquid weight factors
- Client/local database items
- Suppliers, if usable
- Menus/recipes, if clean enough

Should not automatically migrate as live truth:

- Historical audit transactions
- Historical purchases
- Historical sales
- Old report outputs
- Old user activity trail

Transition workflow:

```text
1. Extract clean master data from legacy database
2. Review and clean with client
3. Import into new system as initial reference data
4. Create opening audit count on go-live date
5. Begin new immutable operational history from activation date
```

This avoids carrying old inconsistencies into the new audit-grade model.

---

## 8. Implementation Phases

### Phase 0: Final alignment and scope lock

Goal:

Confirm exactly which legacy functions are mandatory for first release.

Tasks:

- Review legacy system with client again if possible.
- Confirm report columns and formulas.
- Confirm food vs beverage priority.
- Confirm POS file samples.
- Confirm offline requirements.
- Confirm user roles.
- Confirm package/subscription expectations.
- Confirm UI direction.

Outputs:

- Signed feature scope
- Report formula document
- POS sample library
- Final module list

---

### Phase 1: Foundation and domain model

Goal:

Build the clean technical foundation.

Tasks:

- Create monorepo structure.
- Set up NestJS backend.
- Set up PostgreSQL schema and migrations.
- Set up React/Electron desktop app.
- Set up local SQLite schema.
- Create authentication and RBAC.
- Create tenant/client and branch model.
- Create item master, categories, UOM, conversions.
- Create local/branch item database.

Outputs:

- Running desktop shell
- Running backend API
- Database migrations
- Login flow
- Basic master data screens

---

### Phase 2: Audit engine and inventory core

Goal:

Implement the operational heart of the system.

Tasks:

- Create audit sessions.
- Implement full item count workflow.
- Implement open-bottle scale weight workflow.
- Implement net content calculation.
- Implement inventory events.
- Implement correction/revert logic.
- Implement stock computation.
- Implement local save and outbox sync.

Outputs:

- Working audit session flow
- Count sheet workflow
- Open-bottle calculator
- Event history
- Local/offline persistence

---

### Phase 3: Purchases, sales, non-revenue, forfeits

Goal:

Implement the core period activity workflows.

Tasks:

- Purchase entry and purchase lines.
- Supplier management.
- Purchase correction/void.
- Direct sales entry.
- Non-revenue usage entry.
- Forfeited stock entry.
- Production handling after clarification.
- Business date and cutoff period support.

Outputs:

- Purchase workflow
- Sales workflow
- Non-revenue workflow
- Forfeited stock workflow
- Event-linked records

---

### Phase 4: Menus and recipe versioning

Goal:

Support food and cocktail/menu consumption.

Tasks:

- Menu item management.
- Recipe builder.
- Ingredient quantities and UOM conversion.
- Recipe versioning.
- Menu sale expansion into ingredient consumption.
- Cost preview.

Outputs:

- Versioned recipe system
- Menu sales consumption logic
- Menu cost report base

---

### Phase 5: Reports MVP

Goal:

Produce the reports the client actually needs.

Tasks:

- Implement Beverage Full Audit Report.
- Implement Food Full Audit Report.
- Implement Sales Report.
- Implement Purchase Report.
- Implement Non-Revenue Report.
- Implement Inventory on Hand Report.
- Implement PDF/Excel/CSV export.
- Validate formulas against legacy examples.

Outputs:

- Usable report center
- Exportable reports
- Report formula tests

---

### Phase 6: API-based ingestion

Goal:

Allow users to upload different POS and supplier files without training a custom AI model.

Tasks:

- Create import batch system.
- Build file upload UI.
- Implement CSV/Excel deterministic parsing.
- Integrate external AI/document API for PDF/image extraction.
- Define structured output schemas.
- Create staging table.
- Create review and correction screen.
- Create item/menu mapping workflow.
- Commit approved rows into business records/events.
- Add batch reversal.

Outputs:

- Upload POS file flow
- Upload supplier file flow
- Review-before-commit workflow
- Mapping memory per client
- Import batch report

---

### Phase 7: Stocky assistant

Goal:

Add a helpful assistant without compromising audit safety.

Tasks:

- Prepare knowledge base from user manual and system documentation.
- Add read-only tool calls for stock, reports, imports, and audit sessions.
- Add permission checks.
- Add safe response style.
- Add guided help inside pages.
- Prevent unauthorized write actions.

Outputs:

- Stocky chat panel
- Help assistant
- Report/explanation assistant
- Import guidance assistant

---

### Phase 8: UX polish and deployment readiness

Goal:

Make the system feel premium, modern, and production-ready.

Tasks:

- Refine dashboard.
- Reduce table clutter.
- Improve forms.
- Add empty states and loading states.
- Add keyboard-friendly entry.
- Add offline/sync status indicators.
- Add app settings.
- Add installer packaging.
- Add versioning and update flow.
- Prepare user manual and training guide.

Outputs:

- Production desktop build
- User manual
- Training flow
- Deployment checklist

---

## 9. MVP Definition

The first release should focus on what the client needs to operate.

### Must-have MVP

```text
Desktop app
Login and roles
Tenant/client and branch setup
Item master and local database
Food and beverage categories
UOM and conversion
Open-bottle profile
Audit sessions
Full counts
Open-bottle counts and net content calculation
Purchases
Sales
Non-revenue usage
Forfeited stock
Menus/recipes basic versioning
Food Full Audit Report
Beverage Full Audit Report
Sales Report
Purchase Report
Inventory on Hand Report
PDF/Excel/CSV exports
Offline local save
Basic sync
Correction/revert model
Clean dashboard
Stocky basic help assistant
API-based import MVP for CSV/PDF/image with review-before-commit
```

### Should-have shortly after MVP

```text
Advanced import mapping memory
Advanced variance drilldown
Custom report builder
Par stock recommendations
Supplier purchase order dispatch
Advanced Stocky report explanations
User activity report
Device/license management
```

### Future enhancements

```text
Mobile app
Full web-hosted UI
Direct POS provider integrations
Advanced analytics
Multi-branch rollout
Subscription/package billing
Accounting integrations
More advanced AI automations
```

---

## 10. Acceptance Criteria

The system should be accepted only when these are true:

### Business correctness

- Beverage Full Audit calculations match agreed legacy examples.
- Food Full Audit calculations match agreed legacy examples.
- Open-bottle net content calculation is correct.
- Purchases correctly affect report usage and inventory.
- Sales and menu consumption correctly affect expected usage.
- Non-revenue and forfeited stock are visible in reports.
- Corrections preserve history.

### Offline correctness

- User can create counts, purchases, sales, and non-revenue entries offline.
- Offline entries remain after app restart.
- Sync resumes when internet returns.
- Duplicate sync does not duplicate inventory effects.
- Conflicts are visible and resolvable.

### Import correctness

- CSV import works for clean POS exports.
- PDF/image import can extract candidate rows through API.
- All imported rows require review before commit.
- Unmatched items are clearly shown.
- User corrections are remembered as mappings.
- Committed import batch can be reversed.

### UX quality

- Main workflows are understandable without technical training.
- Staff can complete frequent tasks with minimal clicks.
- Reports are easy to generate.
- Errors are clear and actionable.
- UI is clean, modern, and not visually cluttered.

### Security/audit

- Users only access allowed modules.
- Every important action records user, device, date, and branch.
- Inventory-affecting records cannot be silently deleted.
- Imported files and approvals are traceable.

---

## 11. Key Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Legacy report formulas are misunderstood | Reports will not match client expectations | Validate formulas with sample periods early |
| POS files vary too much | Import quality may be inconsistent | Use API extraction + staging review + mapping memory |
| AI extraction hallucinates or misreads data | Wrong inventory entries | Never auto-commit; require review and confidence flags |
| Offline sync conflicts | Data inconsistency | Use idempotency keys, local outbox, conflict screen |
| Scope expands too much | Timeline risk | Define MVP and move advanced features to later phase |
| UI becomes cluttered | Staff adoption suffers | Use guided workflows and progressive disclosure |
| Event sourcing becomes overcomplicated | Development delay | Keep user-facing records simple; use events for audit/inventory effects only |
| Historical data migration becomes messy | Data integrity risk | Clean-slate transactional model; import only reviewed master data |

---

## 12. Recommended Immediate Next Steps

Before coding, do these in order:

1. Finalize legacy workflow documentation.
2. Create a report formula specification for Food and Beverage Full Audit.
3. Extract and clean the legacy table-to-modern-entity mapping.
4. Collect real sample POS files from the client: image, PDF, CSV, Excel if available.
5. Define the import JSON schema for Sales, Purchase, Audit, and Non-Revenue files.
6. Design the first version of the modern information architecture and navigation.
7. Create low-fidelity screen flows for the highest-frequency tasks:
   - Start audit
   - Count full items
   - Count open bottles
   - Receive purchase
   - Record sale
   - Import POS file
   - Review imported rows
   - Generate full audit report
8. Build the database schema and event model.
9. Implement report tests early.
10. Build the MVP in vertical slices, starting with one complete audit cycle.

The first vertical slice should be:

```text
Create item
→ Add branch/local item details
→ Start audit session
→ Count beginning inventory
→ Receive purchase
→ Record sale/non-revenue
→ Count ending inventory
→ Generate Beverage Full Audit Report
```

If this slice works correctly, the rest of the system has a reliable foundation.

---

## 13. Final Direction

The best path forward is not to force the legacy system into the current StockLedger prototype exactly as it is. The best path is to combine:

```text
Legacy FNB/LIS business logic
+ StockLedger's modern ledger/audit mindset
+ Desktop offline architecture
+ API-based file ingestion
+ Stocky assistant
+ clean premium UX
+ report-first validation
```

The final system should feel simple to the user, but technically strong underneath.

The system should hide complexity behind clean workflows, preserve all important audit logic, make imports safer through review-before-commit, and produce reports that the client can trust.


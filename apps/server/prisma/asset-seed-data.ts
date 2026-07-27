/**
 * Asset register imported from the client's two Asset Management reports
 * (2026-07-21): Item name, Category, UOM, opening quantity, Location, and
 * Condition — 70 items. Names/categories are kept close to the client's
 * file — this is their data to correct, not ours to silently rewrite —
 * with two build-phase cleanups applied before this became live seed data
 * (asset-module-phases.md Phase 7):
 *   - 7.1: "Safert First" → "Safety — First Aid" (typo).
 *   - 7.2: trailing whitespace trim ("Furniture ", "Recorder ", "Chair ", in
 *     the client's original sheet) — already clean by the time this file was
 *     transcribed; confirmed no residual whitespace remains, nothing to do.
 *   - 7.3: Location and Condition columns wired in (this pass). Both sheets
 *     carry a per-row Location (Cashier/Office/Bar/Kitchen/Dinning Area/
 *     Function Room/Various Areas) and Condition ("Active" for every visible
 *     row). The system's Location model is a whole business site, not an
 *     area within one — see the Location model docstring — so this area
 *     detail is folded into `remarks` at seed time ("Area: Cashier") rather
 *     than modeled as separate Location rows. Serial No. is blank in the
 *     client's file; realistic demo values are filled in here per the
 *     client's request ("fill in a few realistic-looking demo serials").
 * Costs are demo placeholders by category (the client's report left cost
 * blank).
 *
 * Rows AST-001 → AST-027 (POS Equipment through Kitchen Equipment/Oven) have
 * client-confirmed Location and Condition values, transcribed directly from
 * both source screenshots/sheets. Rows AST-028 → AST-070 are past where the
 * client's screenshots cut off — Location for those is INFERRED from
 * Category (Kitchen Equipment → Kitchen, Furniture → Dinning Area, Bar
 * Tools/Glassware → Bar, Dinning Ware → Kitchen, Safety/Cleaning/Office
 * Equipment → Office), not client-confirmed. Condition defaults to "Active"
 * for all 70 rows, matching every visible row in the source. Flagged here so
 * nobody mistakes the inferred tail for real client data later.
 */
export interface AssetSeedItem {
  category: string;
  name: string;
  uom: string;
  qty: number;
  /** Area within the location — client sheet column, folded into `remarks`
   *  at seed time as "Area: <value>" rather than modeled as a Location row. */
  location: string;
  /** Per-row Condition — client sheet has "Active" for every visible row.
   *  Kept as a real per-row field (not hardcoded in seed.ts) so this data
   *  structurally matches the source file instead of silently ignoring it. */
  condition: string;
  /** Demo placeholder — client's Serial No. column is blank in the source. */
  serialNo: string;
}

export const ASSET_ITEMS: AssetSeedItem[] = [
  // --- AST-001 -> AST-027: client-confirmed Location + Condition ---
  { category: "POS Equipment", name: "POS Terminal", uom: "Unit", qty: 1, location: "Cashier", condition: "Active", serialNo: "SN-POS-0001" },
  { category: "POS Equipment", name: "Cash Drawer", uom: "Unit", qty: 1, location: "Cashier", condition: "Active", serialNo: "SN-POS-0002" },
  { category: "POS Equipment", name: "Reciept Printer", uom: "Unit", qty: 1, location: "Cashier", condition: "Active", serialNo: "SN-POS-0003" },
  { category: "POS Equipment", name: "Barcode Scanner", uom: "Unit", qty: 1, location: "Cashier", condition: "Active", serialNo: "SN-POS-0004" },
  { category: "POS Equipment", name: "Card Payment Terminal", uom: "Unit", qty: 1, location: "Cashier", condition: "Active", serialNo: "SN-POS-0005" },
  { category: "IT Equipment", name: "Desktop Computer", uom: "Unit", qty: 1, location: "Office", condition: "Active", serialNo: "SN-ITE-0006" },
  { category: "IT Equipment", name: "Laptop", uom: "Unit", qty: 1, location: "Office", condition: "Active", serialNo: "SN-ITE-0007" },
  { category: "IT Equipment", name: "Wi-Fi Router", uom: "Unit", qty: 1, location: "Office", condition: "Active", serialNo: "SN-ITE-0008" },
  { category: "IT Equipment", name: "Network Switch", uom: "Unit", qty: 1, location: "Office", condition: "Active", serialNo: "SN-ITE-0009" },
  { category: "Security CCTV", name: "Camera", uom: "Unit", qty: 5, location: "Various Areas", condition: "Active", serialNo: "SN-SEC-0010" },
  { category: "Security DVR/NVR", name: "Recorder", uom: "Unit", qty: 1, location: "Office", condition: "Active", serialNo: "SN-SEC-0011" },
  { category: "Audio System", name: "Speaker", uom: "Unit", qty: 5, location: "Dinning Area", condition: "Active", serialNo: "SN-AUD-0012" },
  { category: "Audio System", name: "Amplifier", uom: "Unit", qty: 3, location: "Dinning Area", condition: "Active", serialNo: "SN-AUD-0013" },
  { category: "Audio System", name: "Microphone", uom: "Unit", qty: 3, location: "Bar", condition: "Active", serialNo: "SN-AUD-0014" },
  { category: "Entertainment", name: "Television", uom: "Unit", qty: 5, location: "Dinning Area", condition: "Active", serialNo: "SN-ENT-0015" },
  { category: "Entertainment", name: "Projector", uom: "Unit", qty: 2, location: "Function Room", condition: "Active", serialNo: "SN-ENT-0016" },
  { category: "Coffee Equipment", name: "Espresso Machine", uom: "Unit", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-COF-0017" },
  { category: "Coffee Equipment", name: "Coffee Grinder", uom: "Unit", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-COF-0018" },
  { category: "Coffee Equipment", name: "Coffee Brewer", uom: "Unit", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-COF-0019" },
  { category: "Beverage Equipment", name: "Blender", uom: "Unit", qty: 3, location: "Bar", condition: "Active", serialNo: "SN-BEV-0020" },
  { category: "Beverage Equipment", name: "Ice Machine", uom: "Unit", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-BEV-0021" },
  { category: "Refrigeration Upright", name: "Refrigerator", uom: "Unit", qty: 4, location: "Kitchen", condition: "Active", serialNo: "SN-REF-0022" },
  { category: "Refrigeration Chest", name: "Freezer", uom: "Unit", qty: 2, location: "Kitchen", condition: "Active", serialNo: "SN-REF-0023" },
  { category: "Refrigeration Wine", name: "Chiller", uom: "Unit", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-REF-0024" },
  { category: "Refrigeration", name: "Beer Cooler", uom: "Unit", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-REF-0025" },
  { category: "Kitchen Equipment", name: "Gas Range", uom: "Unit", qty: 2, location: "Kitchen", condition: "Active", serialNo: "SN-KIT-0026" },
  { category: "Kitchen Equipment", name: "Oven", uom: "Unit", qty: 1, location: "Kitchen", condition: "Active", serialNo: "SN-KIT-0027" },

  // --- AST-028 -> AST-070: past the client screenshots' cutoff. Location
  // inferred from Category (see file docstring), NOT client-confirmed. ---
  { category: "Kitchen Equipment", name: "Deep Fryer", uom: "Unit", qty: 2, location: "Kitchen", condition: "Active", serialNo: "SN-KIT-0028" },
  { category: "Kitchen Equipment", name: "Grill", uom: "Unit", qty: 1, location: "Kitchen", condition: "Active", serialNo: "SN-KIT-0029" },
  { category: "Kitchen Equipment", name: "Microwave Oven", uom: "Unit", qty: 2, location: "Kitchen", condition: "Active", serialNo: "SN-KIT-0030" },
  { category: "Kitchen Equipment", name: "Food Processor", uom: "Unit", qty: 2, location: "Kitchen", condition: "Active", serialNo: "SN-KIT-0031" },
  { category: "Kitchen Equipment", name: "Stainless Prep Table", uom: "Unit", qty: 2, location: "Kitchen", condition: "Active", serialNo: "SN-KIT-0032" },
  { category: "Furniture", name: "Dinning Table", uom: "Unit", qty: 8, location: "Dinning Area", condition: "Active", serialNo: "SN-FUR-0033" },
  { category: "Furniture", name: "Chair", uom: "Unit", qty: 28, location: "Dinning Area", condition: "Active", serialNo: "SN-FUR-0034" },
  { category: "Furniture", name: "Bar Stool", uom: "Unit", qty: 5, location: "Bar", condition: "Active", serialNo: "SN-FUR-0035" },
  { category: "Furniture", name: "Bar Counter", uom: "Unit", qty: 1, location: "Bar", condition: "Active", serialNo: "SN-FUR-0036" },
  { category: "Furniture", name: "Shelving Unit", uom: "Unit", qty: 5, location: "Dinning Area", condition: "Active", serialNo: "SN-FUR-0037" },
  { category: "Bar Tools", name: "Cocktail Shaker", uom: "Piece", qty: 3, location: "Bar", condition: "Active", serialNo: "SN-BAR-0038" },
  { category: "Bar Tools", name: "Jigger", uom: "Piece", qty: 4, location: "Bar", condition: "Active", serialNo: "SN-BAR-0039" },
  { category: "Bar Tools", name: "Bar Spoon", uom: "Piece", qty: 3, location: "Bar", condition: "Active", serialNo: "SN-BAR-0040" },
  { category: "Bar Tools", name: "Muddler", uom: "Piece", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-BAR-0041" },
  { category: "Bar Tools", name: "Hawthorne Strainer", uom: "Piece", qty: 3, location: "Bar", condition: "Active", serialNo: "SN-BAR-0042" },
  { category: "Bar Tools", name: "Mesh Stairner", uom: "Piece", qty: 3, location: "Bar", condition: "Active", serialNo: "SN-BAR-0043" },
  { category: "Bar Tools", name: "Mixing Glass", uom: "Piece", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-BAR-0044" },
  { category: "Bar Tools", name: "Ice Bucket", uom: "Piece", qty: 8, location: "Bar", condition: "Active", serialNo: "SN-BAR-0045" },
  { category: "Bar Tools", name: "Ice Scoop", uom: "Piece", qty: 3, location: "Bar", condition: "Active", serialNo: "SN-BAR-0046" },
  { category: "Bar Tools", name: "Bottle Opener", uom: "Piece", qty: 4, location: "Bar", condition: "Active", serialNo: "SN-BAR-0047" },
  { category: "Bar Tools", name: "Corkscrew", uom: "Piece", qty: 4, location: "Bar", condition: "Active", serialNo: "SN-BAR-0048" },
  { category: "Bar Tools", name: "Pour Spout", uom: "Piece", qty: 12, location: "Bar", condition: "Active", serialNo: "SN-BAR-0049" },
  { category: "Bar Tools", name: "Speed Rail", uom: "Piece", qty: 2, location: "Bar", condition: "Active", serialNo: "SN-BAR-0050" },
  { category: "Glassware", name: "Highball Glass", uom: "Piece", qty: 12, location: "Bar", condition: "Active", serialNo: "SN-GLS-0051" },
  { category: "Glassware", name: "Rock Glass", uom: "Piece", qty: 12, location: "Bar", condition: "Active", serialNo: "SN-GLS-0052" },
  { category: "Glassware", name: "Wine Glass", uom: "Piece", qty: 12, location: "Bar", condition: "Active", serialNo: "SN-GLS-0053" },
  { category: "Glassware", name: "Champagne Fluit", uom: "Piece", qty: 12, location: "Bar", condition: "Active", serialNo: "SN-GLS-0054" },
  { category: "Glassware", name: "Beer Pint", uom: "Piece", qty: 24, location: "Bar", condition: "Active", serialNo: "SN-GLS-0055" },
  { category: "Glassware", name: "Beer Mug", uom: "Piece", qty: 20, location: "Bar", condition: "Active", serialNo: "SN-GLS-0056" },
  { category: "Glassware", name: "Martini Glass", uom: "Piece", qty: 10, location: "Bar", condition: "Active", serialNo: "SN-GLS-0057" },
  { category: "Glassware", name: "Margarita Glass", uom: "Piece", qty: 10, location: "Bar", condition: "Active", serialNo: "SN-GLS-0058" },
  { category: "Glassware", name: "Shot Glass", uom: "Piece", qty: 12, location: "Bar", condition: "Active", serialNo: "SN-GLS-0059" },
  { category: "Glassware", name: "Cocktail Glass", uom: "Piece", qty: 12, location: "Bar", condition: "Active", serialNo: "SN-GLS-0060" },
  { category: "Dinning Ware", name: "Ceramic Plate", uom: "Piece", qty: 50, location: "Kitchen", condition: "Active", serialNo: "SN-DIN-0061" },
  { category: "Dinning Ware", name: "Bowl", uom: "Piece", qty: 25, location: "Kitchen", condition: "Active", serialNo: "SN-DIN-0062" },
  { category: "Dinning Ware", name: "Cutlery Set", uom: "Set", qty: 10, location: "Kitchen", condition: "Active", serialNo: "SN-DIN-0063" },
  { category: "Dinning Ware", name: "Serving Tray", uom: "Piece", qty: 10, location: "Kitchen", condition: "Active", serialNo: "SN-DIN-0064" },
  { category: "Safety Fire", name: "Extinguisher", uom: "Unit", qty: 4, location: "Office", condition: "Active", serialNo: "SN-SAF-0065" },
  { category: "Safety — First Aid", name: "First Aid", uom: "Kit", qty: 10, location: "Office", condition: "Active", serialNo: "SN-SAF-0066" },
  { category: "Cleaning Equipment", name: "Vacuum Cleaner", uom: "Unit", qty: 4, location: "Office", condition: "Active", serialNo: "SN-CLN-0067" },
  { category: "Cleaning Equipment", name: "Floor Scrubber", uom: "Unit", qty: 4, location: "Office", condition: "Active", serialNo: "SN-CLN-0068" },
  { category: "Office Equipment", name: "Filing Cabinet", uom: "Unit", qty: 2, location: "Office", condition: "Active", serialNo: "SN-OFF-0069" },
  { category: "Office Equipment", name: "Office Printer", uom: "Unit", qty: 2, location: "Office", condition: "Active", serialNo: "SN-OFF-0070" },
];

/** Demo placeholder cost per category (PHP) — the client's report left cost blank. */
export const ASSET_CATEGORY_COST: Record<string, number> = {
  "POS Equipment": 18000,
  "IT Equipment": 32000,
  "Security CCTV": 3500,
  "Security DVR/NVR": 9000,
  "Audio System": 8000,
  "Entertainment": 28000,
  "Coffee Equipment": 55000,
  "Beverage Equipment": 15000,
  "Refrigeration Upright": 38000,
  "Refrigeration Chest": 32000,
  "Refrigeration Wine": 42000,
  "Refrigeration": 30000,
  "Kitchen Equipment": 45000,
  "Furniture": 3500,
  "Bar Tools": 350,
  "Glassware": 90,
  "Dinning Ware": 120,
  "Safety Fire": 2200,
  "Safety — First Aid": 950,
  "Cleaning Equipment": 7000,
  "Office Equipment": 9000,
};

/** A few breakage/loss events on real items so the Asset Breakage report shows
    data. Dated in the OPEN period (after the 07-20 count) so they land in the
    report's default range. */
export const ASSET_BREAKAGE: Array<{ name: string; date: string; qty: number; reason: string; note: string }> = [
  { name: "Wine Glass", date: "2026-07-21", qty: 3, reason: "BREAKAGE", note: "Shattered during a busy Friday service" },
  { name: "Beer Mug", date: "2026-07-21", qty: 2, reason: "BREAKAGE", note: "Chipped rims — pulled from service" },
  { name: "Ceramic Plate", date: "2026-07-22", qty: 4, reason: "BREAKAGE", note: "Dropped clearing table 12" },
  { name: "Jigger", date: "2026-07-21", qty: 1, reason: "LOST", note: "Unaccounted for after the count" },
  { name: "Bar Stool", date: "2026-07-22", qty: 1, reason: "RETIRED", note: "Frame bent — disposed" },
  { name: "Camera", date: "2026-07-22", qty: 1, reason: "BREAKAGE", note: "Lens cracked, replaced" },
  { name: "Microphone", date: "2026-07-21", qty: 1, reason: "STOLEN", note: "Missing after a private event" },
];

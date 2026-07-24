/**
 * Asset register imported from the client's two Asset Management reports
 * (2026-07-21): Item name, Category, UOM, and opening quantity — 70 items.
 * Names/categories are kept close to the client's file — this is their data
 * to correct, not ours to silently rewrite — with two build-phase cleanups
 * applied before this became live seed data (asset-module-phases.md Phase 7):
 *   - 7.1: "Safert First" → "Safety — First Aid" (typo).
 *   - 7.2: trailing whitespace trim ("Furniture ", "Recorder ", "Chair ", in
 *     the client's original sheet) — already clean by the time this file was
 *     transcribed; confirmed no residual whitespace remains, nothing to do.
 * Costs are demo placeholders by category (the client's report left cost blank).
 */
export interface AssetSeedItem {
  category: string;
  name: string;
  uom: string;
  qty: number;
}

export const ASSET_ITEMS: AssetSeedItem[] = [
  { category: "POS Equipment", name: "POS Terminal", uom: "Unit", qty: 1 },
  { category: "POS Equipment", name: "Cash Drawer", uom: "Unit", qty: 1 },
  { category: "POS Equipment", name: "Reciept Printer", uom: "Unit", qty: 1 },
  { category: "POS Equipment", name: "Barcode Scanner", uom: "Unit", qty: 1 },
  { category: "POS Equipment", name: "Card Payment Terminal", uom: "Unit", qty: 1 },
  { category: "IT Equipment", name: "Desktop Computer", uom: "Unit", qty: 1 },
  { category: "IT Equipment", name: "Laptop", uom: "Unit", qty: 1 },
  { category: "IT Equipment", name: "Wi-Fi Router", uom: "Unit", qty: 1 },
  { category: "IT Equipment", name: "Network Switch", uom: "Unit", qty: 1 },
  { category: "Security CCTV", name: "Camera", uom: "Unit", qty: 5 },
  { category: "Security DVR/NVR", name: "Recorder", uom: "Unit", qty: 1 },
  { category: "Audio System", name: "Speaker", uom: "Unit", qty: 5 },
  { category: "Audio System", name: "Amplifier", uom: "Unit", qty: 3 },
  { category: "Audio System", name: "Microphone", uom: "Unit", qty: 3 },
  { category: "Entertainment", name: "Television", uom: "Unit", qty: 5 },
  { category: "Entertainment", name: "Projector", uom: "Unit", qty: 2 },
  { category: "Coffee Equipment", name: "Espresso Machine", uom: "Unit", qty: 2 },
  { category: "Coffee Equipment", name: "Coffee Grinder", uom: "Unit", qty: 2 },
  { category: "Coffee Equipment", name: "Coffee Brewer", uom: "Unit", qty: 2 },
  { category: "Beverage Equipment", name: "Blender", uom: "Unit", qty: 3 },
  { category: "Beverage Equipment", name: "Ice Machine", uom: "Unit", qty: 2 },
  { category: "Refrigeration Upright", name: "Refrigerator", uom: "Unit", qty: 4 },
  { category: "Refrigeration Chest", name: "Freezer", uom: "Unit", qty: 2 },
  { category: "Refrigeration Wine", name: "Chiller", uom: "Unit", qty: 2 },
  { category: "Refrigeration", name: "Beer Cooler", uom: "Unit", qty: 2 },
  { category: "Kitchen Equipment", name: "Gas Range", uom: "Unit", qty: 2 },
  { category: "Kitchen Equipment", name: "Oven", uom: "Unit", qty: 1 },
  { category: "Kitchen Equipment", name: "Deep Fryer", uom: "Unit", qty: 2 },
  { category: "Kitchen Equipment", name: "Grill", uom: "Unit", qty: 1 },
  { category: "Kitchen Equipment", name: "Microwave Oven", uom: "Unit", qty: 2 },
  { category: "Kitchen Equipment", name: "Food Processor", uom: "Unit", qty: 2 },
  { category: "Kitchen Equipment", name: "Stainless Prep Table", uom: "Unit", qty: 2 },
  { category: "Furniture", name: "Dinning Table", uom: "Unit", qty: 8 },
  { category: "Furniture", name: "Chair", uom: "Unit", qty: 28 },
  { category: "Furniture", name: "Bar Stool", uom: "Unit", qty: 5 },
  { category: "Furniture", name: "Bar Counter", uom: "Unit", qty: 1 },
  { category: "Furniture", name: "Shelving Unit", uom: "Unit", qty: 5 },
  { category: "Bar Tools", name: "Cocktail Shaker", uom: "Piece", qty: 3 },
  { category: "Bar Tools", name: "Jigger", uom: "Piece", qty: 4 },
  { category: "Bar Tools", name: "Bar Spoon", uom: "Piece", qty: 3 },
  { category: "Bar Tools", name: "Muddler", uom: "Piece", qty: 2 },
  { category: "Bar Tools", name: "Hawthorne Strainer", uom: "Piece", qty: 3 },
  { category: "Bar Tools", name: "Mesh Stairner", uom: "Piece", qty: 3 },
  { category: "Bar Tools", name: "Mixing Glass", uom: "Piece", qty: 2 },
  { category: "Bar Tools", name: "Ice Bucket", uom: "Piece", qty: 8 },
  { category: "Bar Tools", name: "Ice Scoop", uom: "Piece", qty: 3 },
  { category: "Bar Tools", name: "Bottle Opener", uom: "Piece", qty: 4 },
  { category: "Bar Tools", name: "Corkscrew", uom: "Piece", qty: 4 },
  { category: "Bar Tools", name: "Pour Spout", uom: "Piece", qty: 12 },
  { category: "Bar Tools", name: "Speed Rail", uom: "Piece", qty: 2 },
  { category: "Glassware", name: "Highball Glass", uom: "Piece", qty: 12 },
  { category: "Glassware", name: "Rock Glass", uom: "Piece", qty: 12 },
  { category: "Glassware", name: "Wine Glass", uom: "Piece", qty: 12 },
  { category: "Glassware", name: "Champagne Fluit", uom: "Piece", qty: 12 },
  { category: "Glassware", name: "Beer Pint", uom: "Piece", qty: 24 },
  { category: "Glassware", name: "Beer Mug", uom: "Piece", qty: 20 },
  { category: "Glassware", name: "Martini Glass", uom: "Piece", qty: 10 },
  { category: "Glassware", name: "Margarita Glass", uom: "Piece", qty: 10 },
  { category: "Glassware", name: "Shot Glass", uom: "Piece", qty: 12 },
  { category: "Glassware", name: "Cocktail Glass", uom: "Piece", qty: 12 },
  { category: "Dinning Ware", name: "Ceramic Plate", uom: "Piece", qty: 50 },
  { category: "Dinning Ware", name: "Bowl", uom: "Piece", qty: 25 },
  { category: "Dinning Ware", name: "Cutlery Set", uom: "Set", qty: 10 },
  { category: "Dinning Ware", name: "Serving Tray", uom: "Piece", qty: 10 },
  { category: "Safety Fire", name: "Extinguisher", uom: "Unit", qty: 4 },
  { category: "Safety — First Aid", name: "First Aid", uom: "Kit", qty: 10 },
  { category: "Cleaning Equipment", name: "Vacuum Cleaner", uom: "Unit", qty: 4 },
  { category: "Cleaning Equipment", name: "Floor Scrubber", uom: "Unit", qty: 4 },
  { category: "Office Equipment", name: "Filing Cabinet", uom: "Unit", qty: 2 },
  { category: "Office Equipment", name: "Office Printer", uom: "Unit", qty: 2 },
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

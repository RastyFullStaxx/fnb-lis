import type { Approval, ImportRow, Item } from "../types";

export const items: Item[] = [
  {
    id: "gin-700",
    name: "London Dry Gin",
    sku: "BEV-GIN-700",
    category: "Spirits",
    kind: "Beverage",
    baseUnit: "ml",
    package: "700 ml bottle",
    onHand: 18.64,
    par: 16,
    cost: 680,
    value: 12675.2,
    location: "Main Bar",
    status: "Healthy",
    tare: 420,
    factor: 1.19,
    capacity: 700
  },
  {
    id: "rum-750",
    name: "Dark Rum",
    sku: "BEV-RUM-750",
    category: "Spirits",
    kind: "Beverage",
    baseUnit: "ml",
    package: "750 ml bottle",
    onHand: 7.25,
    par: 12,
    cost: 745,
    value: 5401.25,
    location: "Main Bar",
    status: "Low stock",
    tare: 465,
    factor: 1.17,
    capacity: 750
  },
  {
    id: "lime-kg",
    name: "Fresh Lime",
    sku: "FOD-LIME-KG",
    category: "Produce",
    kind: "Food",
    baseUnit: "kg",
    package: "5 kg crate",
    onHand: 14.4,
    par: 10,
    cost: 132,
    value: 1900.8,
    location: "Cold Store",
    status: "Healthy"
  },
  {
    id: "beef-kg",
    name: "Beef Tenderloin",
    sku: "FOD-BEEF-KG",
    category: "Meat",
    kind: "Food",
    baseUnit: "kg",
    package: "1 kg pack",
    onHand: 4.8,
    par: 8,
    cost: 890,
    value: 4272,
    location: "Freezer",
    status: "Low stock"
  },
  {
    id: "sanitizer-l",
    name: "Food-safe Sanitizer",
    sku: "SUP-SAN-5L",
    category: "Cleaning",
    kind: "Supply",
    baseUnit: "L",
    package: "5 L can",
    onHand: 3,
    par: 4,
    cost: 460,
    value: 1380,
    location: "Dry Store",
    status: "Review"
  },
  {
    id: "glass-pc",
    name: "Highball Glass",
    sku: "AST-GLS-HB",
    category: "Glassware",
    kind: "Asset",
    baseUnit: "pc",
    package: "24 pc case",
    onHand: 112,
    par: 96,
    cost: 95,
    value: 10640,
    location: "Service",
    status: "Healthy"
  }
];

export const auditSessions = [
  { id: "AUD-2026-0628", name: "June 28 Weekly Audit", status: "Counting", progress: 72, owner: "Mia Santos", cutoff: "Jun 28, 11:59 PM" },
  { id: "AUD-2026-0621", name: "June 21 Weekly Audit", status: "Closed", progress: 100, owner: "Lourd Borromeo", cutoff: "Jun 21, 11:59 PM" },
  { id: "AUD-2026-0614", name: "June 14 Weekly Audit", status: "Closed", progress: 100, owner: "Mia Santos", cutoff: "Jun 14, 11:59 PM" }
];

export const purchaseRecords = [
  { id: "RCV-1048", supplier: "Metro Beverage Supply", date: "Jun 27", lines: 8, total: 28450, status: "Posted" },
  { id: "RCV-1047", supplier: "Fresh Fields Produce", date: "Jun 26", lines: 14, total: 12780, status: "Needs review" },
  { id: "PO-1046", supplier: "Prime Cut Foods", date: "Jun 25", lines: 5, total: 21200, status: "Draft" }
];

export const usageRecords = [
  { id: "USE-2208", type: "Recipe sales", source: "POS daily close", date: "Jun 28", quantity: "126 servings", value: 48760, status: "Posted" },
  { id: "USE-2207", type: "Waste", source: "Service breakage", date: "Jun 28", quantity: "2.4 units", value: 1380, status: "Pending approval" },
  { id: "USE-2206", type: "Non-revenue", source: "Staff meal", date: "Jun 27", quantity: "18 servings", value: 3240, status: "Posted" }
];

export const importRows: ImportRow[] = [
  { id: "1", source: "London Dry Gin", matchedItem: "London Dry Gin", quantity: 9, unit: "serving", amount: 2700, confidence: 0.99, status: "Matched" },
  { id: "2", source: "House Dark Rum", matchedItem: "Dark Rum", quantity: 6, unit: "serving", amount: 1980, confidence: 0.91, status: "Matched" },
  { id: "3", source: "Chef Beef Special", matchedItem: "Beef Tenderloin", quantity: 12, unit: "serving", amount: 8640, confidence: 0.68, status: "Review" },
  { id: "4", source: "OPEN ITEM 04", matchedItem: "Unmatched", quantity: 2, unit: "item", amount: 520, confidence: 0.32, status: "Review" }
];

export const approvals: Approval[] = [
  { id: "APR-104", title: "Close June 28 Weekly Audit", detail: "3 unresolved variances, ₱1,840 net exposure", requestedBy: "Mia Santos", age: "18 min", risk: "High", status: "Pending" },
  { id: "APR-103", title: "Commit POS import IMP-308", detail: "146 rows; 2 manually mapped", requestedBy: "Carlo Reyes", age: "42 min", risk: "Medium", status: "Pending" },
  { id: "APR-102", title: "Reverse waste record USE-2198", detail: "Incorrect product selected", requestedBy: "Mia Santos", age: "1 hr", risk: "High", status: "Pending" }
];

export const reportTrend = [
  { period: "May 31", usage: 82400, explained: 79800 },
  { period: "Jun 7", usage: 86700, explained: 85100 },
  { period: "Jun 14", usage: 84200, explained: 83600 },
  { period: "Jun 21", usage: 91400, explained: 90200 },
  { period: "Jun 28", usage: 93800, explained: 91960 }
];

export const activity = [
  { id: "LOG-8802", action: "Count updated", subject: "London Dry Gin · Main Bar", actor: "Mia Santos", time: "8 min ago" },
  { id: "LOG-8801", action: "Import reviewed", subject: "IMP-308 · POS Daily Close", actor: "Carlo Reyes", time: "24 min ago" },
  { id: "LOG-8800", action: "Purchase posted", subject: "RCV-1048 · Metro Beverage Supply", actor: "Lourd Borromeo", time: "1 hr ago" },
  { id: "LOG-8799", action: "Recipe published", subject: "House Gin Sour · v4", actor: "Lourd Borromeo", time: "Yesterday" }
];

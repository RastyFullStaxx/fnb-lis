export type Role = "owner" | "staff" | "auditor";
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export interface Item {
  id: string;
  name: string;
  sku: string;
  category: string;
  kind: "Beverage" | "Food" | "Supply" | "Asset";
  baseUnit: string;
  package: string;
  onHand: number;
  par: number;
  cost: number;
  value: number;
  location: string;
  status: "Healthy" | "Low stock" | "Review";
  tare?: number;
  factor?: number;
  capacity?: number;
}

export interface CountLine {
  itemId: string;
  full: number;
  scaleWeight?: number;
}

export interface ImportRow {
  id: string;
  source: string;
  matchedItem: string;
  quantity: number;
  unit: string;
  amount: number;
  confidence: number;
  status: "Matched" | "Review" | "Excluded";
}

export interface Approval {
  id: string;
  title: string;
  detail: string;
  requestedBy: string;
  age: string;
  risk: "Medium" | "High";
  status: "Pending" | "Approved" | "Rejected";
}

export interface NavItem {
  label: string;
  to: string;
  icon: string;
  roles?: Role[];
  badge?: string;
}

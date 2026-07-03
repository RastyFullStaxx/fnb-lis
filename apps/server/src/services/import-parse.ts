import Papa from "papaparse";
import ExcelJS from "exceljs";

/** Normalized row shape shared by deterministic parsers and the AI extractor. */
export interface ParsedRow {
  itemText: string;
  qty: number | null;
  unitPrice: number | null;
  unitCost: number | null;
  rowDate: string | null;
  note: string | null;
  raw: Record<string, unknown>;
}

// Header keyword heuristics (case-insensitive substring match).
const NAME_RE = /item|product|name|description|bottle|brand|particular/i;
const QTY_RE = /qty|quantity|count|units?\b|sold|pcs/i;
const PRICE_RE = /price|srp|retail|sell|amount|sales|total/i;
const COST_RE = /cost|unit ?cost|buy|purchase/i;
const DATE_RE = /date|day/i;

function findColumn(fields: string[], re: RegExp): string | null {
  return fields.find((f) => re.test(f)) ?? null;
}

function parseNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toBusinessDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    const mo = m[1]!.padStart(2, "0");
    const d = m[2]!.padStart(2, "0");
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function mapRecords(records: Array<Record<string, unknown>>, fields: string[]): ParsedRow[] {
  const nameCol = findColumn(fields, NAME_RE) ?? fields[0] ?? "";
  const qtyCol = findColumn(fields, QTY_RE);
  const costCol = findColumn(fields, COST_RE);
  // Price detection avoids stealing the cost column.
  const priceCol = fields.find((f) => PRICE_RE.test(f) && f !== costCol) ?? null;
  const dateCol = findColumn(fields, DATE_RE);

  const rows: ParsedRow[] = [];
  for (const rec of records) {
    const itemText = String(rec[nameCol] ?? "").trim();
    if (!itemText) continue; // skip blank-name rows
    rows.push({
      itemText,
      qty: qtyCol ? parseNum(rec[qtyCol]) : null,
      unitPrice: priceCol ? parseNum(rec[priceCol]) : null,
      unitCost: costCol ? parseNum(rec[costCol]) : null,
      rowDate: dateCol ? toBusinessDate(rec[dateCol]) : null,
      note: null,
      raw: rec,
    });
  }
  return rows;
}

export function parseCsv(text: string): ParsedRow[] {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const fields = result.meta.fields ?? [];
  return mapRecords(result.data, fields);
}

export async function parseXlsx(buffer: Buffer): Promise<ParsedRow[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs bundles its own Buffer type; the Node Buffer works at runtime.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const fields: string[] = [];
  headerRow.eachCell((cell, col) => {
    fields[col - 1] = String(cell.value ?? "").trim();
  });

  const records: Array<Record<string, unknown>> = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rec: Record<string, unknown> = {};
    row.eachCell((cell, col) => {
      const key = fields[col - 1];
      if (key) {
        const v = cell.value;
        // Unwrap exceljs rich/formula/date cell values.
        rec[key] = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;
      }
    });
    records.push(rec);
  });

  return mapRecords(records, fields.filter(Boolean));
}

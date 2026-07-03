/** Pure RFC-4180 CSV emit — no I/O. Used by report exports. */

export type CsvValue = string | number | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote when the field contains a comma, quote, or newline; double internal quotes.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text. A leading BOM makes Excel open UTF-8 cleanly. */
export function toCsv(rows: CsvValue[][], { bom = true }: { bom?: boolean } = {}): string {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return bom ? `﻿${body}` : body;
}

/**
 * What a file ACTUALLY is, from its bytes.
 *
 * `detectSource` in routes/imports.ts picks a parser from the filename
 * extension and the browser-supplied MIME type — both of which the caller
 * controls. A file named `sales.csv` that is really a PDF therefore reached the
 * CSV parser, and vice versa.
 *
 * That is not a vulnerability in this codebase today: uploads are stored under
 * a SHA-256 name and never served back, and both parsers are memory-safe
 * TypeScript. But "the parser is chosen by the attacker" is an assumption that
 * only stays safe by luck, and it costs almost nothing to remove.
 *
 * Magic numbers only — no dependency, no heuristics beyond the first few bytes,
 * and a deliberate `null` for anything unrecognised so the caller decides what
 * to do rather than this guessing.
 */

export type SniffedType = "PDF" | "XLSX" | "PNG" | "JPEG" | "GIF" | "WEBP" | "ZIP" | null;

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

export function sniffFileType(buf: Buffer): SniffedType {
  // %PDF
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return "PDF";
  // \x89 P N G \r \n \x1a \n
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "PNG";
  // JPEG SOI + marker
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "JPEG";
  // GIF87a / GIF89a
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return "GIF";
  // RIFF....WEBP
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return "WEBP";
  /**
   * PK\x03\x04 — a ZIP container. XLSX *is* a zip, and so is .docx, .odt and a
   * plain archive; the bytes cannot tell them apart without reading the central
   * directory. "ZIP" is returned rather than "XLSX" so the caller knows this is
   * consistent-with rather than proof-of, and exceljs still does the real
   * validation when it opens it.
   */
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return "ZIP";
  return null;
}

/**
 * Could these bytes plausibly be the CSV we were told they are?
 *
 * CSV has no magic number, so this is the inverse test: reject anything that is
 * definitely a BINARY format wearing a .csv name. A NUL byte in the first few
 * KB is the reliable tell — text files do not contain them, and every binary
 * container this app might see does.
 */
export function looksLikeText(buf: Buffer): boolean {
  const window = buf.subarray(0, 8192);
  return !window.includes(0x00);
}

/** Human wording for the mismatch, naming what it really is. */
export function describeSniff(sniffed: SniffedType): string {
  switch (sniffed) {
    case "PDF":
      return "a PDF";
    case "PNG":
    case "JPEG":
    case "GIF":
    case "WEBP":
      return "an image";
    case "ZIP":
      return "a Zip or Excel file";
    default:
      return "a different kind of file";
  }
}

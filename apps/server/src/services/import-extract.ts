import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { importExtractionResult, type ImportExtractionResult } from "@fnb/core";
import type { ParsedRow } from "./import-parse";

export const AI_MODEL = "claude-sonnet-5";

export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ExtractionOutcome {
  rows: ParsedRow[];
  raw: string;
  warnings: string[];
}

/**
 * Extracts line items from a PDF or image via Claude structured output.
 * Env-gated: callers must check isAiEnabled() first (the route rejects
 * PDF/image uploads with a friendly setup notice when no key is present).
 * AI never writes inventory — it only fills the staging rows for human review.
 */
export async function extractWithAi(
  bytes: Buffer,
  mediaType: string,
  sourceType: "PDF" | "IMAGE",
  kind: string,
): Promise<ExtractionOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI extraction is not configured (no ANTHROPIC_API_KEY).");

  const client = new Anthropic({ apiKey });
  const base64 = bytes.toString("base64");

  const contentBlock: Anthropic.ContentBlockParam =
    sourceType === "PDF"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: (mediaType || "image/png") as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: base64,
          },
        };

  const message = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 8192,
    system:
      "You extract line items from a bar/kitchen inventory document (POS export, supplier invoice, or count sheet). " +
      "Return every line item exactly as printed, with quantity/price/cost/date when present. Never invent values — use null when a field is absent. " +
      `The user says this is a ${kind} document.`,
    messages: [
      {
        role: "user",
        content: [contentBlock, { type: "text", text: "Extract all line items as structured data." }],
      },
    ],
    output_config: { format: zodOutputFormat(importExtractionResult) },
  });

  const parsed = message.parsed_output as ImportExtractionResult | null;
  if (!parsed) throw new Error("The AI response could not be parsed.");

  const rows: ParsedRow[] = parsed.rows
    .map((r) => ({
      itemText: r.itemText.trim(),
      qty: r.qty ?? null,
      unitPrice: r.unitPrice ?? null,
      unitCost: r.unitCost ?? null,
      rowDate: normalizeDate(r.date),
      note: r.note ?? null,
      raw: r as Record<string, unknown>,
    }))
    .filter((r) => r.itemText);

  return { rows, raw: JSON.stringify(parsed), warnings: parsed.warnings ?? [] };
}

function normalizeDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
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

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import Anthropic from "@anthropic-ai/sdk";
import { isCostBasis, type CostBasis } from "@fnb/core";
import { AppError } from "../lib/errors";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { AI_MODEL, isAiEnabled } from "../services/import-extract";
import { committedCountDates } from "../services/report-assembly";
import { buildStockySystemPrompt } from "../services/stocky-prompt";
import { STOCKY_TOOLS, stockyToolByName } from "../services/stocky-tools";
import { answerLocally } from "../services/stocky-engine";
import { logActivity } from "../services/activity";

/**
 * Stocky — the read-only audit assistant. Streaming chat over a tool loop
 * whose entire reach is the registry in services/stocky-tools.ts (no writes).
 * Location scoping comes from the authenticated route context, never from
 * the request body or the model.
 */

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 16000;
const MAX_TOOL_TURNS = 6;

const chatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES),
});

/** Text-only history → Anthropic messages: first turn must be a user turn,
 *  and the total payload stays bounded (drop oldest first). */
function toAnthropicMessages(history: z.infer<typeof chatBody>["messages"]): Anthropic.MessageParam[] {
  let msgs = [...history];
  while (msgs.length > 0 && msgs[0]!.role !== "user") msgs.shift();
  let total = msgs.reduce((sum, m) => sum + m.content.length, 0);
  while (msgs.length > 1 && total > MAX_TOTAL_CHARS) {
    total -= msgs.shift()!.content.length;
    while (msgs.length > 0 && msgs[0]!.role !== "user") total -= msgs.shift()!.content.length;
  }
  return msgs.map((m) => ({ role: m.role, content: m.content }));
}

function todayBusinessDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Split a precomputed answer into small chunks for a streamed typewriter feel. */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const tokens = text.split(/(\s+)/); // keep whitespace
  let buf = "";
  let words = 0;
  for (const t of tokens) {
    buf += t;
    if (/\S/.test(t)) words += 1;
    if (words >= 3) {
      chunks.push(buf);
      buf = "";
      words = 0;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export const stockyRoutes = new Hono<AppEnv>().post(
  "/stocky/chat",
  requirePermission("reports.view"),
  zValidator("json", chatBody),
  async (c) => {
    const user = c.get("user")!;
    const location = c.get("location");
    const client = c.get("client");
    const { messages: history } = c.req.valid("json");

    const messages = toAnthropicMessages(history);
    if (messages.length === 0) throw new AppError(400, "The conversation must start with a user message");
    const question = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    // Carry the client's valuation policy so Stocky's stock-worth answers
    // agree with the report pages it cites.
    const toolCtx = {
      locationId: location.id,
      clientId: client.id,
      costBasis: (isCostBasis(client.costBasis) ? client.costBasis : "PRICE") as CostBasis,
    };

    // No key → the deterministic rule engine answers from the same read-only
    // tools. A key upgrades the same endpoint to free-form LLM conversation.
    if (!isAiEnabled()) {
      return streamSSE(c, async (stream) => {
        let outcome: "ok" | "error" = "ok";
        try {
          await stream.writeSSE({ event: "tool", data: JSON.stringify({ name: "local", status: "start", label: "Checking the records" }) });
          const answer = await answerLocally({ ctx: toolCtx, locationName: location.name, question });
          await stream.writeSSE({ event: "tool", data: JSON.stringify({ name: "local", status: "end", label: "Checking the records" }) });
          for (const chunk of chunkText(answer)) {
            await stream.writeSSE({ event: "text", data: JSON.stringify({ delta: chunk }) });
            await sleep(12); // gentle typewriter feel
          }
          await stream.writeSSE({ event: "done", data: JSON.stringify({ stopReason: "end_turn", turns: 0, toolCalls: 0, mode: "local" }) });
        } catch (err) {
          outcome = "error";
          console.error("[stocky:local]", err);
          try {
            await stream.writeSSE({ event: "error", data: JSON.stringify({ message: "Stocky couldn't answer that. Try rephrasing." }) });
          } catch {
            // stream closed
          }
        } finally {
          try {
            await logActivity({
              user,
              clientId: client.id,
              locationId: location.id,
              action: "stocky.chat",
              entity: "Stocky",
              summary: `Asked Stocky: ${question.slice(0, 120)}`,
              details: { mode: "local", outcome },
            });
          } catch (logErr) {
            console.error("[stocky] activity log failed", logErr);
          }
        }
      });
    }

    const countDates = await committedCountDates(location.id);
    const system = buildStockySystemPrompt({
      clientName: client.name,
      locationName: location.name,
      locationId: location.id,
      today: todayBusinessDate(),
      countDates,
    });

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    return streamSSE(c, async (stream) => {
      let aborted = false;
      let current: ReturnType<typeof anthropic.messages.stream> | null = null;
      stream.onAbort(() => {
        aborted = true;
        current?.abort();
      });

      const toolsUsed: string[] = [];
      let toolCalls = 0;
      let turns = 0;
      let outcome: "ok" | "error" | "aborted" = "ok";

      try {
        for (;;) {
          turns += 1;
          current = anthropic.messages.stream({
            model: AI_MODEL,
            max_tokens: 2048,
            system,
            messages,
            tools: STOCKY_TOOLS.map((t) => t.definition),
          });

          for await (const event of current) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
              await stream.writeSSE({ event: "text", data: JSON.stringify({ delta: event.delta.text }) });
            }
          }

          const response = await current.finalMessage();
          if (response.stop_reason !== "tool_use") break;
          if (turns >= MAX_TOOL_TURNS) {
            throw new Error("Stocky hit its tool-call limit for one question. Try a narrower question.");
          }

          // Assistant turn goes back VERBATIM (thinking blocks included);
          // then every tool_result returns in ONE user message.
          messages.push({ role: "assistant", content: response.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            toolCalls += 1;
            const tool = stockyToolByName(block.name);
            const label = tool?.label ?? block.name;
            if (!toolsUsed.includes(block.name)) toolsUsed.push(block.name);
            await stream.writeSSE({ event: "tool", data: JSON.stringify({ name: block.name, status: "start", label }) });
            let result: unknown;
            try {
              result = tool
                ? await tool.execute(toolCtx, block.input)
                : { error: `Unknown tool: ${block.name}` };
            } catch (err) {
              result = { error: err instanceof Error ? err.message : "Tool failed" };
            }
            const isError = typeof result === "object" && result !== null && "error" in result;
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
              ...(isError ? { is_error: true } : {}),
            });
            await stream.writeSSE({ event: "tool", data: JSON.stringify({ name: block.name, status: "end", label }) });
          }
          messages.push({ role: "user", content: results });
        }

        await stream.writeSSE({ event: "done", data: JSON.stringify({ stopReason: "end_turn", turns, toolCalls }) });
      } catch (err) {
        if (aborted) {
          outcome = "aborted";
        } else {
          outcome = "error";
          console.error("[stocky]", err);
          const message = err instanceof Anthropic.APIError ? "The AI service returned an error. Try again." : err instanceof Error ? err.message : "Something went wrong.";
          try {
            await stream.writeSSE({ event: "error", data: JSON.stringify({ message }) });
          } catch {
            // stream already closed
          }
        }
      } finally {
        if (aborted) outcome = "aborted";
        // Audit trail AFTER the stream — never inside a transaction.
        try {
          await logActivity({
            user,
            clientId: client.id,
            locationId: location.id,
            action: "stocky.chat",
            entity: "Stocky",
            summary: `Asked Stocky: ${question.slice(0, 120)}`,
            details: { tools: toolsUsed, toolCalls, turns, outcome },
          });
        } catch (logErr) {
          console.error("[stocky] activity log failed", logErr);
        }
      }
    });
  },
);

/** Streaming client for the Stocky chat endpoint (SSE over a POST fetch —
 *  EventSource can't POST, so we parse the stream by hand). */

export interface StockyMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StockyToolEvent {
  name: string;
  status: "start" | "end";
  label: string;
}

export interface StockyStreamHandlers {
  onText(delta: string): void;
  onTool(event: StockyToolEvent): void;
  onDone(info: { stopReason: string; turns: number; toolCalls: number }): void;
  onError(message: string): void;
}

export async function streamStockyChat(
  locationId: string,
  messages: StockyMessage[],
  handlers: StockyStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/locations/${locationId}/stocky/chat`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    throw err;
  }

  if (!res.ok || !res.body) {
    let message = "Stocky is unavailable right now.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body
    }
    handlers.onError(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminal = false;

  const dispatch = (rawEvent: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    let data: unknown;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (event === "text") {
      handlers.onText((data as { delta: string }).delta ?? "");
    } else if (event === "tool") {
      handlers.onTool(data as StockyToolEvent);
    } else if (event === "done") {
      sawTerminal = true;
      handlers.onDone(data as { stopReason: string; turns: number; toolCalls: number });
    } else if (event === "error") {
      sawTerminal = true;
      handlers.onError((data as { message: string }).message ?? "Something went wrong.");
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx).replace(/\r/g, "");
        buffer = buffer.slice(idx + 2);
        if (frame.trim()) dispatch(frame);
      }
    }
    if (!sawTerminal && !signal.aborted) {
      handlers.onError("The connection dropped before Stocky finished. Regenerate to try again.");
    }
  } catch (err) {
    if (!signal.aborted && !sawTerminal) {
      handlers.onError(err instanceof Error ? err.message : "The stream failed.");
    }
  }
}

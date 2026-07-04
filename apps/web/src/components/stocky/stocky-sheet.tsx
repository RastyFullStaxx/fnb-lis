import { useEffect, useRef, useState } from "react";
import { CircleStop, RotateCcw, Send, Sparkles } from "lucide-react";
import { useMe } from "@/api/auth";
import { useLocationId } from "@/api/location";
import { streamStockyChat, type StockyMessage, type StockyToolEvent } from "@/api/stocky";
import { MarkdownLite } from "@/components/stocky/markdown-lite";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SUGGESTED_PROMPTS = [
  "Why is Absolut short this period?",
  "What did we buy from Metro Beverage last week?",
  "How is remaining bottle content calculated?",
];

const MAX_HISTORY = 20;

interface ChatState {
  messages: StockyMessage[];
  /** Assistant text currently streaming in (not yet committed to messages). */
  streaming: string | null;
  toolLabel: string | null;
  error: string | null;
}

const EMPTY: ChatState = { messages: [], streaming: null, toolLabel: null, error: null };

export function StockySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const me = useMe();
  const locationId = useLocationId();
  const aiEnabled = me.data?.features.aiEnabled ?? false;

  const [chat, setChat] = useState<ChatState>(EMPTY);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const locationRef = useRef(locationId);

  // A different location is a different conversation.
  useEffect(() => {
    if (locationRef.current !== locationId) {
      locationRef.current = locationId;
      abortRef.current?.abort();
      setChat(EMPTY);
      setBusy(false);
    }
  }, [locationId]);

  // Keep the feed pinned to the bottom while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streaming, chat.toolLabel]);

  const stop = () => {
    abortRef.current?.abort();
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setDraft("");

    const history: StockyMessage[] = [...chat.messages, { role: "user" as const, content: question }].slice(-MAX_HISTORY);
    setChat((c) => ({ ...c, messages: [...c.messages, { role: "user", content: question }], streaming: "", toolLabel: null, error: null }));
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    const finalize = (error: string | null) => {
      setChat((c) => ({
        messages: acc.trim() ? [...c.messages, { role: "assistant", content: acc }] : c.messages,
        streaming: null,
        toolLabel: null,
        error,
      }));
      setBusy(false);
    };

    try {
      await streamStockyChat(
        locationId,
        history,
        {
          onText: (delta) => {
            acc += delta;
            setChat((c) => ({ ...c, streaming: acc, toolLabel: null }));
          },
          onTool: (e: StockyToolEvent) => {
            setChat((c) => ({ ...c, toolLabel: e.status === "start" ? e.label : null }));
          },
          onDone: () => finalize(null),
          onError: (message) => finalize(message),
        },
        controller.signal,
      );
      if (controller.signal.aborted) finalize(null);
    } catch (err) {
      finalize(err instanceof Error ? err.message : "Stocky is unavailable right now.");
    }
  };

  const regenerate = () => {
    const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Drop the trailing user turn (send re-appends it).
    setChat((c) => {
      const msgs = [...c.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]!.role === "user") {
          msgs.splice(i);
          break;
        }
      }
      return { ...c, messages: msgs, error: null };
    });
    void send(lastUser.content);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Stocky
            <Badge variant={aiEnabled ? "default" : "secondary"} className="ml-1 text-[10px]">
              {aiEnabled ? "AI" : "Basic"}
            </Badge>
          </SheetTitle>
          <SheetDescription>
            Ask about stock, variances, and the numbers behind the reports. Read-only — Stocky never changes data.
          </SheetDescription>
        </SheetHeader>

        {
          <>
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {chat.messages.length === 0 && chat.streaming === null && (
                <div className="space-y-3 pt-6 text-center">
                  <Sparkles className="mx-auto size-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    Grounded in this location's live records — every figure comes from the reports.
                  </p>
                  <div className="flex flex-col items-stretch gap-2 pt-2">
                    {SUGGESTED_PROMPTS.map((p) => (
                      <Button key={p} variant="outline" size="sm" className="h-auto justify-start whitespace-normal py-2 text-left font-normal" onClick={() => void send(p)}>
                        {p}
                      </Button>
                    ))}
                  </div>
                  {!aiEnabled && (
                    <p className="pt-2 text-xs text-muted-foreground/80">
                      Running in basic mode — answers come from a built-in engine. Add an{" "}
                      <code className="rounded bg-muted px-1 font-mono">ANTHROPIC_API_KEY</code> for free-form
                      conversation.
                    </p>
                  )}
                </div>
              )}

              {chat.messages.map((m, i) => (
                <MessageBubble key={i} message={m} onNavigate={() => onOpenChange(false)} />
              ))}

              {chat.streaming !== null && (
                <div className="text-sm">
                  {chat.toolLabel ? (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                      {chat.toolLabel}…
                    </p>
                  ) : chat.streaming ? (
                    <div className="max-w-[95%]">
                      <MarkdownLite text={chat.streaming} onNavigate={() => onOpenChange(false)} />
                      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary/70 align-text-bottom" />
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                      Thinking…
                    </p>
                  )}
                </div>
              )}

              {chat.error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                  <p className="text-destructive">{chat.error}</p>
                  <Button variant="ghost" size="sm" className="mt-1 h-7 px-2" onClick={regenerate}>
                    <RotateCcw className="size-3.5" /> Regenerate
                  </Button>
                </div>
              )}
            </div>

            <form
              className="flex items-end gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                placeholder="Ask about stock, variances, or formulas…"
                rows={1}
                className="max-h-32 min-h-9 flex-1 resize-none"
                disabled={busy}
              />
              {busy ? (
                <Button type="button" variant="outline" size="icon" onClick={stop} title="Stop">
                  <CircleStop className="size-4" />
                </Button>
              ) : (
                <Button type="submit" size="icon" disabled={!draft.trim()} title="Send">
                  <Send className="size-4" />
                </Button>
              )}
            </form>
          </>
        }
      </SheetContent>
    </Sheet>
  );
}

function MessageBubble({ message, onNavigate }: { message: StockyMessage; onNavigate: () => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("max-w-[95%] text-sm")}>
      <MarkdownLite text={message.content} onNavigate={onNavigate} />
    </div>
  );
}


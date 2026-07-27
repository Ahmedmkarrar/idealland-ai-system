"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, SendHorizonal, RefreshCw, Bot, User } from "lucide-react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const GREETING =
  "Hi Lucy — I'm your sourcing assistant. Ask me things like the examples below, and I'll pull it straight from the live data. I can also find an agent's contact or draft an approach for you.";

const SUGGESTIONS = [
  "House schemes in Croydon with planning, up to 9 units",
  "Which of my top leads still need a contact?",
  "How many ready-to-send packs do I have?",
  "Show me the highest-scored sites in Greenwich",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || loading) return;
      const next = [...messages, { role: "user" as const, content: clean }];
      setMessages(next);
      setInput("");
      setLoading(true);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next }),
        });
        const data = await res.json();
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.ok ? data.reply : `Sorry — ${data.reason ?? "something went wrong. Try again."}`,
          },
        ]);
      } catch {
        setMessages((m) => [...m, { role: "assistant", content: "Sorry — I couldn't reach the server. Try again." }]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading]
  );

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
      <div className="flex items-center gap-3 pb-4 border-b">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Sourcing Assistant</h1>
          <p className="text-xs text-muted-foreground">Ask in plain English — it reads the live pipeline</p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setMessages([])}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> New chat
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 space-y-5">
        {empty && (
          <div className="space-y-6">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm leading-relaxed">{GREETING}</div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5 pl-11">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-sm rounded-xl border px-3.5 py-2.5 hover:bg-muted transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
              }`}
            >
              {m.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div
              className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap max-w-[85%] ${
                m.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm text-muted-foreground">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce [animation-delay:120ms]">●</span>
                <span className="animate-bounce [animation-delay:240ms]">●</span>
              </span>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 pt-4 border-t"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about leads, contacts, ROI…"
          disabled={loading}
          autoFocus
        />
        <Button type="submit" disabled={loading || !input.trim()}>
          <SendHorizonal className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

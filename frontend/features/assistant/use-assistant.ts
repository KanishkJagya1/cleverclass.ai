"use client";

import * as React from "react";
import type { SearchHit } from "@/types/catalog";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Product recommendations returned alongside the prose (D9). */
  products?: SearchHit[];
  /** True while tokens are still arriving. */
  streaming?: boolean;
  error?: boolean;
  feedback?: "up" | "down";
}

const STORAGE_KEY = "kt-assistant-history";

/**
 * Owns the conversation and the SSE parsing.
 *
 * The backend emits three event kinds:
 *   {"type":"token","value":"…"}     incremental text
 *   {"type":"products","value":[…]}  inline product cards
 *   {"type":"done"}                  end of turn
 *
 * Anything else is ignored rather than thrown — a malformed frame should
 * degrade the answer, not kill the stream.
 */
export function useAssistant() {
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      /* corrupt history is not worth crashing over */
    }
  }, []);

  React.useEffect(() => {
    if (messages.length === 0) return;
    // Keep the last 30 turns. Unbounded history eventually blows the 5 MB
    // localStorage quota and every write starts throwing.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
  }, [messages]);

  const send = React.useCallback(
    async (text: string, history?: AssistantMessage[]) => {
      const prompt = text.trim();
      if (!prompt || busy) return;

      const base = history ?? messages;
      const userMsg: AssistantMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: prompt,
      };
      const replyId = `a-${Date.now()}`;

      setMessages([...base, userMsg, { id: replyId, role: "assistant", content: "", streaming: true }]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (fn: (m: AssistantMessage) => AssistantMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === replyId ? fn(m) : m)));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: prompt,
            history: base.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => null);
          patch((m) => ({
            ...m,
            streaming: false,
            error: true,
            content: payload?.message ?? "The assistant is unavailable right now.",
          }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          // The last element may be a partial frame; hold it back.
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;

            try {
              const evt = JSON.parse(raw) as { type: string; value?: unknown };
              if (evt.type === "token" && typeof evt.value === "string") {
                patch((m) => ({ ...m, content: m.content + evt.value }));
              } else if (evt.type === "products" && Array.isArray(evt.value)) {
                patch((m) => ({ ...m, products: evt.value as SearchHit[] }));
              }
            } catch {
              /* skip malformed frame */
            }
          }
        }

        patch((m) => ({ ...m, streaming: false }));
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          patch((m) => ({ ...m, streaming: false }));
        } else {
          patch((m) => ({
            ...m,
            streaming: false,
            error: true,
            content: "Something went wrong. Please try again, or call us on +91 71042 99010.",
          }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages],
  );

  /** Drops the failed/unwanted answer and replays the question that caused it. */
  const regenerate = React.useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const upTo = messages.slice(0, messages.findIndex((m) => m.id === lastUser.id));
    void send(lastUser.content, upTo);
  }, [messages, send]);

  const stop = React.useCallback(() => abortRef.current?.abort(), []);

  const clear = React.useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const rate = React.useCallback((id: string, feedback: "up" | "down") => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, feedback } : m)));
  }, []);

  return { messages, busy, send, regenerate, stop, clear, rate };
}

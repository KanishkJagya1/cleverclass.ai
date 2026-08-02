"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer } from "vaul";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Copy,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { SITE } from "@/constants/catalog";
import { useCart } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import { cn, formatPrice } from "@/lib/utils";
import { useAssistant, type AssistantMessage } from "./use-assistant";
import type { SearchHit } from "@/types/catalog";

/* Context-aware prompts. On a product page the useful question is different
   from the one on the home page, and generic suggestions never get tapped. */
function suggestionsFor(pathname: string): string[] {
  if (pathname.startsWith("/shop/"))
    return [
      "Is this matched to the current syllabus?",
      "What's the difference from the Marathi edition?",
      "What else do I need for this class?",
    ];
  if (pathname.startsWith("/class/"))
    return ["Which set should I buy for this class?", "What's in the combo pack?", "Do you have key notes for this class?"];
  if (pathname.startsWith("/combo-packs"))
    return ["What exactly is in this pack?", "How much do I save?", "Is shipping free on this?"];
  if (pathname.startsWith("/cart") || pathname.startsWith("/checkout"))
    return ["How long will delivery take?", "What's your return policy?", "How do I get free shipping?"];
  return [
    "Which book for 12th PCM?",
    "Difference between Kohinoor and Spark?",
    "Do you have Class 10 Marathi medium science?",
    "How long does delivery take?",
  ];
}

export function AssistantWidget() {
  const [open, setOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <>
      {!open && <Launcher onClick={() => setOpen(true)} />}

      {isMobile ? (
        <Drawer.Root open={open} onOpenChange={setOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="glass-veil fixed inset-0 z-[var(--z-overlay)]" />
            <Drawer.Content className="glass-panel fixed inset-x-0 bottom-0 z-[var(--z-chat)] flex h-[88vh] flex-col !rounded-b-none">
              <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-[var(--border-2)]" aria-hidden />
              <Drawer.Title className="sr-only">AI Learning Assistant</Drawer.Title>
              <Panel onClose={() => setOpen(false)} />
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      ) : (
        open && (
          <div
            role="dialog"
            aria-label="AI Learning Assistant"
            className="glass-panel glass-edge fixed bottom-6 right-6 z-[var(--z-chat)] flex h-[min(38rem,80vh)] w-[25rem] flex-col overflow-hidden"
          >
            <Panel onClose={() => setOpen(false)} />
          </div>
        )
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
   Launcher — ONE slow ambient breath, not a notification pulse. A fast
   infinite pulse says "you have an unread message", which is a lie.
   -------------------------------------------------------------------------- */
function Launcher({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open the AI learning assistant"
      style={{
        // Stacks above the mobile bottom nav AND any page-level sticky action
        // bar. --sticky-bar-h is 0 unless a product page's buy bar is showing.
        bottom:
          "calc(var(--bottom-nav-h) + var(--sticky-bar-h, 0px) + 1rem + env(safe-area-inset-bottom))",
      }}
      className={cn(
        "glass-panel glass-edge fixed right-5 z-[var(--z-chat)] grid size-14 place-items-center !rounded-full",
        "transition-[bottom] duration-[var(--duration-base)] ease-[var(--ease-standard)]",
        "lg:!bottom-6 lg:right-6",
        "text-[color:var(--brand-base)] transition-transform duration-[var(--duration-base)]",
        "hover:scale-105 active:scale-95 motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
        "animate-[ambientGlow_4.5s_ease-in-out_infinite] motion-reduce:animate-none",
      )}
    >
      <Sparkles className="size-5" aria-hidden />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */
function Panel({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { messages, busy, send, regenerate, clear, rate } = useAssistant();
  const [input, setInput] = React.useState("");
  const listRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll, but only when the user is already near the bottom — yanking
  // someone back down while they're reading an earlier answer is hostile.
  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
    setInput("");
  };

  return (
    <>
      <header className="flex items-center gap-3 border-b border-[var(--border-1)] px-4 py-3">
        <span className="grid size-8 place-items-center rounded-full bg-[var(--brand-soft)] text-[color:var(--text-brand)]">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[length:var(--text-sm)] font-semibold text-[color:var(--text-1)]">
            Learning Assistant
          </p>
          <p className="text-[length:var(--text-2xs)] text-[color:var(--text-3)]">
            Answers from our own catalogue
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon-sm" onClick={clear} aria-label="Clear conversation">
            <Trash2 className="size-4" aria-hidden />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assistant">
          <X className="size-4" aria-hidden />
        </Button>
      </header>

      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        {messages.length === 0 ? (
          <div className="py-6">
            <p className="text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
              Ask about a book, a syllabus, which medium to choose, shipping or
              returns. I'll answer from our catalogue and suggest the right
              title.
            </p>
            <ul className="mt-5 space-y-2">
              {suggestionsFor(pathname).map((s) => (
                <li key={s}>
                  <button
                    onClick={() => void send(s)}
                    className="w-full rounded-[var(--radius-md)] border border-[var(--border-1)] px-3.5 py-2.5 text-left text-[length:var(--text-sm)] text-[color:var(--text-2)] transition-colors hover:border-[var(--border-2)] hover:text-[color:var(--text-1)]"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m) => (
            <Message key={m.id} message={m} onRate={rate} onRegenerate={regenerate} />
          ))
        )}
      </div>

      <form
        onSubmit={submit}
        className="border-t border-[var(--border-1)] p-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-end gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Ask a question
          </label>
          <textarea
            id="assistant-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline. Reversing this is the
              // single most common complaint about chat inputs.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            rows={1}
            placeholder="Ask about books, classes, shipping…"
            className="max-h-28 flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border-1)] bg-[var(--surface-1)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[color:var(--text-1)] outline-none placeholder:text-[color:var(--text-3)] focus:border-[var(--focus-ring)]"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || busy} aria-label="Send">
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
      </form>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Message                                                                    */
/* -------------------------------------------------------------------------- */
function Message({
  message,
  onRate,
  onRegenerate,
}: {
  message: AssistantMessage;
  onRate: (id: string, f: "up" | "down") => void;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[var(--radius-lg)] rounded-br-sm bg-[var(--brand-base)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[color:var(--brand-on)]">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[color:var(--text-brand)]">
        <Sparkles className="size-3.5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        {/* aria-live so screen readers hear the answer arrive without the
            user having to hunt for it. */}
        <div
          aria-live={message.streaming ? "polite" : "off"}
          className={cn(
            "prose-assistant text-[length:var(--text-sm)] leading-[var(--leading-relaxed)]",
            message.error ? "text-[color:var(--signal-danger)]" : "text-[color:var(--text-1)]",
          )}
        >
          {message.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4">{children}</ol>,
                strong: ({ children }) => (
                  <strong className="font-semibold text-[color:var(--text-1)]">{children}</strong>
                ),
                a: ({ href, children }) => (
                  <Link
                    href={href ?? "#"}
                    className="text-[color:var(--text-brand)] underline underline-offset-2"
                  >
                    {children}
                  </Link>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          ) : (
            <TypingDots />
          )}
        </div>

        {/* The feature that makes this a sales channel rather than a support
            widget: recommendations arrive as add-to-cart-able cards (D9). */}
        {message.products && message.products.length > 0 && (
          <ul className="mt-3 space-y-2">
            {message.products.map((p) => (
              <li key={p.slug}>
                <ProductCardInline hit={p} />
              </li>
            ))}
          </ul>
        )}

        {message.error && (
          <a
            href={`tel:${SITE.phones[0]}`}
            className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-1)] px-3 py-2 text-[length:var(--text-xs)] font-medium text-[color:var(--text-1)]"
          >
            <Phone className="size-3.5" aria-hidden />
            Call {SITE.phones[0].replace("+91", "+91 ")}
          </a>
        )}

        {!message.streaming && message.content && !message.error && (
          <div className="mt-2 flex items-center gap-1">
            <IconAction
              label={copied ? "Copied" : "Copy answer"}
              onClick={() => {
                void navigator.clipboard.writeText(message.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </IconAction>
            <IconAction label="Regenerate answer" onClick={onRegenerate}>
              <RefreshCw className="size-3.5" aria-hidden />
            </IconAction>
            <IconAction
              label="Helpful"
              active={message.feedback === "up"}
              onClick={() => onRate(message.id, "up")}
            >
              <ThumbsUp className="size-3.5" aria-hidden />
            </IconAction>
            <IconAction
              label="Not helpful"
              active={message.feedback === "down"}
              onClick={() => onRate(message.id, "down")}
            >
              <ThumbsDown className="size-3.5" aria-hidden />
            </IconAction>
          </div>
        )}
      </div>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid size-7 place-items-center rounded-[var(--radius-sm)] transition-colors",
        active
          ? "text-[color:var(--brand-base)]"
          : "text-[color:var(--text-3)] hover:bg-[var(--surface-0)] hover:text-[color:var(--text-2)]",
      )}
    >
      {children}
    </button>
  );
}

function TypingDots() {
  return (
    <span className="flex gap-1 py-1" role="status" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-[var(--text-3)] motion-reduce:animate-none"
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

function ProductCardInline({ hit }: { hit: SearchHit }) {
  const add = useCart((s) => s.add);
  const [added, setAdded] = React.useState(false);

  return (
    <div className="surface-card flex items-center gap-3 p-2.5">
      <Link
        href={hit.href}
        className="relative aspect-cover w-10 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--surface-0)]"
      >
        {hit.image && <Image src={hit.image} alt="" fill sizes="40px" className="object-cover" />}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={hit.href} className="block">
          <p className="clamp-2 text-[length:var(--text-xs)] font-medium text-[color:var(--text-1)]">
            {hit.title}
          </p>
        </Link>
        {hit.price !== undefined && (
          <p className="tabular text-[length:var(--text-2xs)] text-[color:var(--text-3)]">
            {formatPrice(hit.price)}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (hit.price === undefined) return;
          add({
            slug: hit.slug,
            format: hit.format,
            title: hit.title,
            titleMr: hit.titleMr,
            price: hit.price,
            image: hit.image ?? "",
            classId: "10",
            medium: "marathi",
          });
          setAdded(true);
        }}
        disabled={added}
      >
        {added ? <Check className="size-3.5" aria-hidden /> : "Add"}
      </Button>
    </div>
  );
}

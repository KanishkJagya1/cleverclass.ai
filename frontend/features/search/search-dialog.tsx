"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BookOpen,
  Clock,
  FileText,
  GraduationCap,
  Layers,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { CLASSES } from "@/constants/catalog";
import { useSearch } from "./search-context";
import { cn, formatPrice } from "@/lib/utils";
import type { SearchHit } from "@/types/catalog";

const RECENT_KEY = "kt-recent-searches";

const PAGES = [
  { label: "Shop all books", href: "/shop" },
  { label: "Combo packs", href: "/combo-packs" },
  { label: "Key Notes", href: "/key-notes" },
  { label: "About us", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Track an order", href: "/account/track" },
];

export function SearchDialog() {
  const { open, setOpen } = useSearch();
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [semantic, setSemantic] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>([]);

  React.useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"));
    } catch {
      setRecent([]);
    }
  }, []);

  /* Debounced fetch. 160ms is short enough to feel instant and long enough
     that a 20-character query fires two requests, not twenty. */
  React.useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSemantic(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { hits: SearchHit[] };

        if (data.hits.length > 0) {
          setHits(data.hits);
          setSemantic(false);
        } else {
          // Nothing lexical — try natural language against the vector index (D8).
          const ai = await fetch(`/api/ai/search?q=${encodeURIComponent(term)}`, {
            signal: controller.signal,
          }).catch(() => null);
          if (ai?.ok) {
            const aiData = (await ai.json()) as { hits: SearchHit[] };
            setHits(aiData.hits ?? []);
            setSemantic((aiData.hits ?? []).length > 0);
          } else {
            setHits([]);
          }
        }
      } catch {
        /* aborted — a newer keystroke is already in flight */
      } finally {
        setLoading(false);
      }
    }, 160);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const go = (href: string, term?: string) => {
    if (term) {
      const next = [term, ...recent.filter((r) => r !== term)].slice(0, 5);
      setRecent(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    }
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const classMatches = CLASSES.filter((c) =>
    query.length >= 2 ? c.label.toLowerCase().includes(query.toLowerCase()) : false,
  ).slice(0, 4);

  const pageMatches = PAGES.filter((p) =>
    query.length >= 2 ? p.label.toLowerCase().includes(query.toLowerCase()) : false,
  );

  const books = hits.filter((h) => h.format === "book");
  const combos = hits.filter((h) => h.format === "combo");

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="glass-veil fixed inset-0 z-[var(--z-overlay)] data-[state=open]:animate-[fadeIn_var(--duration-fast)_ease-out]" />
        <Dialog.Content
          className={cn(
            "fixed z-[var(--z-modal)] focus:outline-none",
            // Mobile: full-screen takeover (D12). Desktop: centred palette.
            "inset-0 sm:inset-auto sm:left-1/2 sm:top-[12vh] sm:w-[min(40rem,92vw)] sm:-translate-x-1/2",
          )}
        >
          <Dialog.Title className="sr-only">Search CleverClass.AI</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search books, combo packs, key notes and classes. Use arrow keys to
            move and Enter to open.
          </Dialog.Description>

          <Command
            shouldFilter={false}
            className="glass-panel glass-edge flex h-full flex-col overflow-hidden !rounded-none sm:!rounded-[var(--radius-2xl)]"
          >
            <div className="flex items-center gap-3 border-b border-[var(--border-1)] px-4">
              {loading ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-[var(--text-3)]" aria-hidden />
              ) : (
                <Search className="size-4 shrink-0 text-[var(--text-3)]" aria-hidden />
              )}
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search books, classes, combo packs…"
                className="h-14 flex-1 bg-transparent text-[length:var(--text-base)] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
              />
              <kbd className="hidden rounded border border-[var(--border-1)] bg-[var(--surface-0)] px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-3)] sm:block">
                Esc
              </kbd>
            </div>

            <Command.List className="max-h-[70vh] flex-1 overflow-y-auto overscroll-contain p-2 sm:max-h-[24rem]">
              {semantic && (
                <p className="mb-1 flex items-center gap-2 px-3 py-2 text-[length:var(--text-xs)] text-[var(--text-brand)]">
                  <Sparkles className="size-3.5" aria-hidden />
                  Understood as a question — showing the closest matches
                </p>
              )}

              {query.length < 2 && recent.length > 0 && (
                <Command.Group heading="Recent">
                  {recent.map((r) => (
                    <Item key={r} onSelect={() => setQuery(r)} icon={Clock}>
                      {r}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {query.length < 2 && (
                <Command.Group heading="Jump to">
                  {PAGES.map((p) => (
                    <Item key={p.href} onSelect={() => go(p.href)} icon={BookOpen}>
                      {p.label}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {combos.length > 0 && (
                <Command.Group heading="Combo packs">
                  {combos.map((h) => (
                    <ResultItem key={h.slug} hit={h} onSelect={() => go(h.href, query)} />
                  ))}
                </Command.Group>
              )}

              {books.length > 0 && (
                <Command.Group heading="Books">
                  {books.map((h) => (
                    <ResultItem key={h.slug} hit={h} onSelect={() => go(h.href, query)} />
                  ))}
                </Command.Group>
              )}

              {classMatches.length > 0 && (
                <Command.Group heading="Classes">
                  {classMatches.map((c) => (
                    <Item
                      key={c.id}
                      onSelect={() => go(`/class/${c.id}`, query)}
                      icon={GraduationCap}
                    >
                      {c.label}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {pageMatches.length > 0 && (
                <Command.Group heading="Pages">
                  {pageMatches.map((p) => (
                    <Item key={p.href} onSelect={() => go(p.href)} icon={FileText}>
                      {p.label}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {query.length >= 2 && !loading && hits.length === 0 && classMatches.length === 0 && (
                <Command.Empty className="px-3 py-10 text-center">
                  <p className="text-[length:var(--text-sm)] text-[var(--text-2)]">
                    Nothing matched "{query}".
                  </p>
                  <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-3)]">
                    Try a class and subject, like "class 10 science".
                  </p>
                </Command.Empty>
              )}
            </Command.List>

            <div className="hidden items-center gap-4 border-t border-[var(--border-1)] px-4 py-2.5 text-[length:var(--text-2xs)] text-[var(--text-3)] sm:flex">
              <span>↑↓ to navigate</span>
              <span>↵ to open</span>
              <span className="ml-auto">Ask a full question in the assistant</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const itemCls = cn(
  "flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5",
  "text-[length:var(--text-sm)] text-[var(--text-2)]",
  "data-[selected=true]:bg-[var(--surface-0)] data-[selected=true]:text-[var(--text-1)]",
);

function Item({
  children,
  onSelect,
  icon: Icon,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  icon: React.ElementType;
}) {
  return (
    <Command.Item onSelect={onSelect} className={itemCls}>
      <Icon className="size-4 shrink-0 text-[var(--text-3)]" aria-hidden />
      {children}
    </Command.Item>
  );
}

function ResultItem({ hit, onSelect }: { hit: SearchHit; onSelect: () => void }) {
  return (
    <Command.Item onSelect={onSelect} className={itemCls}>
      {hit.image ? (
        <span className="relative aspect-cover h-10 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--surface-0)]">
          <Image src={hit.image} alt="" fill sizes="30px" className="object-cover" />
        </span>
      ) : (
        <Layers className="size-4 shrink-0 text-[var(--text-3)]" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[var(--text-1)]">{hit.title}</span>
        <span className="block truncate text-[length:var(--text-xs)] text-[var(--text-3)]">
          {hit.subtitle}
        </span>
      </span>
      {hit.price !== undefined && (
        <span className="tabular shrink-0 text-[length:var(--text-sm)] font-medium text-[var(--text-2)]">
          {formatPrice(hit.price)}
        </span>
      )}
    </Command.Item>
  );
}

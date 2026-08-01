# CleverClass.AI

A complete rebuild of [kohinoortez.com](https://kohinoortez.com) as **CleverClass.AI** — the storefront of
Adwani Publishing House, Nagpur. Educational guides, key notes and combo packs for
Maharashtra State Board and CBSE, Classes Nursery to 12, in Marathi, Semi-English
and English medium.

**Frontend** — Next.js 16 · React 19 · TypeScript · Tailwind v4 · Motion · Radix
**Backend** — FastAPI · RAG · Chroma · sentence-transformers (chatbot + semantic search only)

---

## Quick start

```bash
# Frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev                      # http://localhost:3000

# Backend (optional — the site runs without it; the assistant degrades gracefully)
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload        # http://localhost:8000/docs
```

The backend runs with **no API keys**: local embeddings, an on-disk Chroma store,
and an extractive `echo` LLM that answers from retrieved context. Set
`LLM_PROVIDER=openai` or `gemini` with a key when you want generated prose.

Verify:

```bash
cd frontend && npm run typecheck && npm run build   # 432 static pages
cd backend  && python test_rag.py                   # 9 checks
```

---

## Project structure

```
kohinoor/
├── frontend/
│   ├── app/                    routes (App Router)
│   │   ├── (auth)/             login · signup · forgot-password
│   │   ├── (legal)/            shipping · returns · privacy · terms
│   │   ├── account/            dashboard · orders · track · wishlist · downloads
│   │   ├── api/                search + chat proxy route handlers
│   │   ├── class/[classId]/    11 class hubs — the primary SEO surface
│   │   ├── combo-packs/        landing + detail
│   │   ├── key-notes/          landing · by class · by subject
│   │   ├── series/[series]/    the five imprints
│   │   ├── shop/[slug]/        325 product pages
│   │   ├── sitemap.ts robots.ts manifest.ts
│   │   └── layout.tsx page.tsx error.tsx not-found.tsx
│   ├── components/
│   │   ├── forms/              newsletter · contact (RHF + Zod)
│   │   ├── home/               hero + the 15 home sections
│   │   ├── layout/             navbar · mega menu · bottom nav · footer
│   │   ├── motion/             Reveal · TiltCard · Magnetic · CountUp · Mesh
│   │   └── ui/                 button · primitives · empty-state · map-embed
│   ├── features/
│   │   ├── assistant/          AI Learning Assistant (widget + SSE hook)
│   │   ├── catalog/            BookCard · ComboCard · gallery · filters · panel
│   │   └── search/             ⌘K command palette
│   ├── lib/
│   │   ├── auth/               AuthProvider interface (stub)
│   │   ├── data/               CatalogAdapter interface + seed adapter
│   │   ├── payments/           PaymentProvider interface (stub)
│   │   ├── store/              cart · wishlist · preferences (Zustand)
│   │   └── utils.ts
│   ├── constants/ providers/ styles/ types/
│   └── public/
├── backend/
│   ├── app/
│   │   ├── api/routes.py       /chat /chat/sync /search /upload /reindex /health
│   │   ├── embeddings/         sentence-transformers | OpenAI | hash fallback
│   │   ├── prompts/            grounding rules, refusal, order handoff
│   │   ├── rag/                chunker · ingest · pipeline
│   │   ├── schemas/            request/response models
│   │   ├── services/           llm · catalog index
│   │   ├── vector_db/          Chroma | in-memory, behind one Protocol
│   │   └── config.py
│   ├── knowledge/              the corpus + catalog.json
│   ├── main.py test_rag.py requirements.txt Dockerfile
└── docs/
    ├── phase-1-product-requirements.md
    ├── phase-2-design-system.md
    ├── phase-3-wireframes.md
    ├── deployment.md
    ├── accessibility.md
    ├── performance.md
    └── ai-integration.md
```

---

## The decisions that shaped this build

Everything below came out of auditing the live site, not from a template.

**Combos are merchandised above individual books, everywhere.** Average selling
price is around ₹60 against a ₹200 free-shipping threshold. The site's job is
basket-building, so the class hubs lead with the combo, the cart carries a
free-shipping meter, and product pages carry a frequently-bought-together bundle.

**Key Notes funnel into the paid guide.** They are the top organic entry point
and, on the old site, a dead end at a PDF link. The preview is free and needs no
sign-up (D1); the conversion block below it states exactly what the guide adds
that the notes do not.

**The medium switch sits inside the purchase panel.** Wrong-medium orders are the
top support cost. Putting the switch at the point of purchase prevents the error;
a related-products link at the bottom of the page only offers a remedy afterwards.

**Glass is chrome, not content.** Navbar, palette, modals, drawers and the chat
panel are glass; book cards and sections are opaque. This is how visionOS and
macOS behave, it satisfies the "less decoration" brief, and it caps
`backdrop-filter` to about two mostly-fixed layers per viewport — which is what
makes the site survive a mid-range Android.

**The assistant returns components, not prose.** A recommendation arrives as an
add-to-cart-able product card. That is the difference between a support widget
and a sales channel.

**Refusal is a first-class outcome.** If retrieval scores below the relevance
floor, the LLM is never called — no context, no temptation to invent a price or a
syllabus detail. Order-specific questions short-circuit to the phone number
before retrieval even runs.

---

## Architecture seams

Four things are deliberately stubbed behind typed interfaces, so each becomes a
one-module change rather than a refactor:

| Seam | Interface | Today | Swap to |
|---|---|---|---|
| Catalogue | `lib/data/adapter.ts` | typed seed data | Postgres · Supabase · Sanity · Payload · Shopify |
| Payments | `lib/payments/provider.ts` | stub, always succeeds | Razorpay · PhonePe · Stripe |
| Auth | `lib/auth/provider.ts` | stub session | NextAuth · Clerk · Supabase Auth |
| Vector store | `app/vector_db/store.py` | Chroma | FAISS · pgvector · Pinecone |

Moving the catalogue off seed data is literally one line:

```ts
// lib/data/index.ts
export const catalog: CatalogAdapter = postgresAdapter;
```

No component imports a data source — they import types only.

---

## Documentation

| Document | What it covers |
|---|---|
| [Phase 1 — Product requirements](docs/phase-1-product-requirements.md) | Live-site audit, personas, IA, site map, 8 user flows |
| [Phase 2 — Design system](docs/phase-2-design-system.md) | Tokens, glass doctrine, verified contrast, motion, 87 components |
| [Phase 3 — Wireframes](docs/phase-3-wireframes.md) | Every page's layout with the reasoning behind it |
| [Deployment](docs/deployment.md) | Vercel + Render/AWS, env vars, CI |
| [Accessibility](docs/accessibility.md) | WCAG 2.1 AA checklist, what's verified and what needs manual testing |
| [Performance](docs/performance.md) | Budgets, what was measured, the blur budget |
| [AI integration](docs/ai-integration.md) | RAG pipeline, corpus, prompts, tuning, providers |

Design tokens are code, not a spec: [`frontend/styles/tokens.css`](frontend/styles/tokens.css)
and [`frontend/styles/glass.css`](frontend/styles/glass.css).

---

## What is not built

Stated plainly so nothing is mistaken for finished:

- **No real payments.** Checkout collects details and calls a stub that always succeeds.
- **No real auth.** Account screens render against a stub session.
- **No order management or inventory.** Order history and tracking are placeholder screens.
- **No admin panel.** The architecture is CMS-ready; the CMS itself is not chosen.
- **Placeholder imagery.** `/covers/*` and `/previews/*` paths are referenced but the
  files are not in the repo — supply real cover art or point `next.config.ts`
  `remotePatterns` at your image host.
- **Seed catalogue.** 325 titles generated deterministically from the real taxonomy
  (correct classes, mediums, subjects, series, price bands) — realistic in shape,
  not the real SKU list. Export the real catalogue and swap the adapter.

---

© Adwani Publishing House. CleverClass.AI — Learn smart. Grow bright.

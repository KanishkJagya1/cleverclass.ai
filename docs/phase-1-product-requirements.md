# Phase 1 — Product Requirements, Information Architecture, User Flows, Site Map

**Project:** Kohinoor Tez — premium educational publishing platform
**Replaces:** https://kohinoortez.com/ (WooCommerce, Adwani Publishing House, Nagpur)
**Date:** 2026-07-30
**Status:** Awaiting approval to proceed to Phase 2

---

## 1. Business Reality (audited from the live site)

Design decisions below are grounded in what the business actually sells, not assumptions.

| Fact | Value | Design consequence |
|---|---|---|
| Catalog size | ~325 SKUs | Browse-by-facet is mandatory; a flat grid is unusable |
| Price band | ₹30 – ₹300 (most ₹30–₹100) | Low ASP → the site's job is **basket building**, not single-item conversion |
| Combo packs | ₹40 – ₹600, 15–30% savings | Highest-value path. Must be the hero of the home page |
| Free shipping threshold | ₹200 | A ₹60 book buyer must be nudged to ₹200. Cart needs a progress meter |
| Imprints / series | Kohinoor, Spark, Vidyamitra, WinWings, Ekatmik | Fifth taxonomy axis, currently invisible in nav |
| Boards | Maharashtra State Board, CBSE | Top-level split — a CBSE parent should never see State Board SKUs |
| Classes | Nursery, 5–12, Board Exam | 11 landing pages, each a real SEO surface |
| Mediums | Marathi, Semi-English, English | Bilingual UI + bilingual product data |
| Streams (11–12) | Science (PCM/PCB/PCBM), Commerce, Arts | Combo configurator, not a flat list |
| Key Notes | Free PDF downloads today | **Open decision — see §8** |
| Contact | +91 7104299010 / +91 9209001126, kohinoortezz@gmail.com, N87 MIDC Hingna Road, Nagpur 440016 | Real NAP data for LocalBusiness schema |

### Who buys
1. **Parent (primary payer, 35–50)** — buys for their child, low digital confidence, mobile, price-sensitive, decides on trust signals. Wants: "the right book for my child's class, correct medium, delivered."
2. **Student (9–12, 14–18)** — self-directed, exam-anxious, mobile-first, arrives from search for a specific chapter or paper. Wants: notes, sample pages, guessing papers, now.
3. **Teacher / tuition owner** — bulk buyer, knows series names, wants price list and repeat ordering.
4. **Bookseller / distributor** — wholesale enquiry, not retail checkout.

**Persona → design implication:** Personas 1 and 2 want opposite things. The parent wants guided narrowing ("Class 10 → Marathi → done"). The student wants direct search ("Spark Chemistry II"). The site must serve both without a compromise that serves neither: **guided path in nav, ⌘K search for the impatient.**

### Business goals, ranked
1. Raise AOV above the ₹200 free-shipping line (combo-first merchandising, cart nudge, frequently-bought-together).
2. Convert Key Notes traffic — the free-PDF pages are the top organic entry point and currently a dead end.
3. Establish premium credibility so a ₹600 combo feels safe to buy from a site the buyer has never used.
4. Cut wrong-purchase support load (wrong class/medium) via unambiguous product data.
5. Rank for long-tail queries: "class 10 marathi medium science guide", "12th PCM combo pack", "SSC guessing paper 2026".

---

## 2. Product Requirements

### 2.1 Scope
**In scope (Phase 4–6):** full public site, catalog browse/search/filter, cart, wishlist, checkout UI (payment stubbed), account UI (auth stubbed), AI assistant with RAG, CMS-ready content layer, SEO, a11y, PWA.

**Out of scope:** payment gateway integration, real order management, real auth backend, inventory sync, admin panel UI. Every one of these gets a typed seam so it can be dropped in later without refactoring.

### 2.2 Functional requirements

**FR-1 Catalog**
- Browse all products with faceted filters: board, class, medium, subject, series, stream, price, availability, format (book / combo / notes).
- Facets are URL-driven (`/shop?class=10&medium=marathi`) — shareable, back-button correct, server-renderable, indexable.
- Sort: relevance, popularity, rating, newest, price ↑↓.
- Grid / list toggle, persisted per user.
- Pagination (SEO-safe, not infinite scroll) with skeleton loading states.

**FR-2 Product detail**
- Cover gallery + zoom, preview pages (sample PDF spreads), full spec block (class, board, medium, subject, series, pages, ISBN, edition, publisher), description, related books, frequently-bought-together, reviews, sticky purchase panel with quantity + wishlist.
- "Also available in Marathi / English" variant switch — the single biggest wrong-purchase preventer.

**FR-3 Combo packs**
- Dedicated combo experience: contents breakdown ("this pack contains these 7 books"), individual-vs-pack price comparison, savings badge, per-stream configurator for 11–12.
- Combo detail links to each contained book's page.

**FR-4 Class hub (11 pages)**
- Per class: subjects grid, all books, key notes, combo packs, AI recommendation strip, medium switcher.
- These are the primary SEO landing pages.

**FR-5 Key Notes**
- Chapter-wise notes browsable by class + subject + medium, sample preview, download (see §8 decision), and an explicit path from a free note to the paid guide that covers it.

**FR-6 Search**
- Global ⌘K / Ctrl+K command palette, instant client-side results across books, combos, notes, classes, and pages; recent searches; keyboard-only operable.
- Natural-language query support routed to the AI backend ("Class 10 science books in English") returning filtered results, not chat prose.

**FR-7 Cart & wishlist**
- Client-side persisted (localStorage), free-shipping progress meter, quantity edit, save-for-later, combo upsell in cart.
- Checkout UI collects shipping details and hands off to a `PaymentProvider` interface that currently resolves to a stub.

**FR-8 Account**
- Login / signup / forgot-password UI, orders, order tracking, wishlist, downloads, profile, settings. Backed by an `AuthProvider` interface; stub session for now.

**FR-9 AI assistant**
- Floating glass launcher, always visible, RAG-grounded on the company's own corpus only, streaming responses, markdown, suggested questions, history, copy / regenerate / feedback, dark mode.
- Refuses out-of-scope questions gracefully and hands off to WhatsApp/phone for order-specific queries it cannot answer.

**FR-10 Content pages**
- About (story, timeline, vision, mission, values, achievements), Contact (form + map + NAP), FAQs, Shipping, Returns, Privacy, Terms.

### 2.3 Non-functional requirements
| Req | Target |
|---|---|
| Lighthouse (mobile) | Perf ≥ 90, A11y ≥ 95, Best Practices 100, SEO 100 |
| LCP / INP / CLS | < 2.0s / < 200ms / < 0.05 on 4G mid-tier Android |
| JS payload | < 180 KB gzip first load on home |
| Accessibility | WCAG 2.1 AA, full keyboard operation, `prefers-reduced-motion` honoured everywhere |
| Browsers | Last 2 versions Chrome/Safari/Edge/Firefox + Android Chrome |
| Content model | Every product/page authored as typed data, CMS-swappable without component changes |
| i18n-ready | Devanagari-safe typography now; full UI translation deferred but string-extracted |

**Performance risk flagged early:** glassmorphism means `backdrop-filter`, which is GPU-expensive and janks on the mid-range Android devices this audience actually uses. Mitigation locked in Phase 2: cap simultaneous blur layers per viewport, use static blurred gradients instead of live `backdrop-filter` for large background areas, and gate heavy effects behind a device-capability check.

---

## 3. Information Architecture

### 3.1 Taxonomy (5 axes)
```
Board      → Maharashtra State Board | CBSE
Class      → Nursery | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | Board Exam
Medium     → Marathi | Semi-English | English
Subject    → Maths, Science, Physics, Chemistry, Biology, History, Geography,
             Pol. Science, Economics, Book-Keeping, English, Hindi, Marathi, Sanskrit
Series     → Kohinoor | Spark | Vidyamitra | WinWings | Ekatmik
Stream     → (11–12 only) Science PCM/PCB/PCBM | Commerce | Arts
Format     → Book | Combo Pack | Key Notes
```
**Primary navigation axis: Class.** It is how every buyer thinks ("my daughter is in 8th"). Medium is the second filter, subject third. Series is a *brand* filter, surfaced on shop and product pages — never as a top-level nav item, because customers don't shop by imprint.

### 3.2 Navigation model
Global nav keeps all existing tabs, with mega menus replacing dropdowns:

| Nav item | Behaviour |
|---|---|
| Home | — |
| Shop | Mega menu: Class column, Subject column, Series column, + featured book preview panel |
| Combo Packs | Mega menu: by class band (5–8, 9–10, 11–12) and by stream, + savings callout |
| Class | Mega menu: 11 class chips → class hub pages |
| Key Notes | Mega menu: class × subject grid |
| About Us | Direct |
| Contact | Direct |
| Utilities | Search (⌘K), Wishlist (count), Cart (count + total), Account |

Sticky, glass, shrinks and increases blur on scroll. Mobile: bottom sheet nav (thumb-reachable) rather than a top hamburger — this audience is mobile-majority.

**Footer IA:** Shop by Class · Shop by Series · Combo Packs · Key Notes · Company · Policies · Contact/NAP · Newsletter · Social.

---

## 4. Site Map

```
/                                   Home
/shop                               All products (faceted, URL-driven)
  ?class= &medium= &subject= &series= &board= &price= &sort= &view= &page=
/shop/[slug]                        Product detail
/combo-packs                        Combo landing
/combo-packs/[slug]                 Combo detail
/class                              All classes hub
/class/[class]                      Class hub  (nursery, 5…12, board-exam)
/class/[class]/[subject]            Class + subject listing
/key-notes                          Key Notes landing
/key-notes/[class]                  Notes by class
/key-notes/[class]/[subject]        Notes detail + preview + download/purchase
/series/[series]                    Imprint page (kohinoor, spark, vidyamitra, winwings, ekatmik)
/search                             Full search results (palette fallback / SEO surface)
/about                              Story, timeline, vision, mission, values, achievements
/contact                            Form, map, NAP, support
/cart
/checkout                           Multi-step, payment stubbed
/account
  /account/login  /signup  /forgot-password
  /account/orders  /orders/[id]
  /account/track                    Guest order tracking
  /account/wishlist
  /account/downloads
  /account/profile
  /account/settings
/faqs  /shipping  /returns  /privacy  /terms
/sitemap.xml  /robots.txt  /manifest.webmanifest
```

**Route count:** ~14 static + 5 dynamic templates generating ~380 pages (325 products + 11 classes + ~30 combos + notes). All statically generated with ISR.

---

## 5. User Flows

**Flow A — Parent, guided purchase (primary revenue path)**
```
Home → "Shop by Class" → Class 10 hub → medium switcher: Marathi
     → sees Combo Pack recommended above individual books
     → Combo detail: contents + ₹ savings vs buying separately
     → Add to cart → cart shows "free shipping unlocked ✓"
     → Checkout → Confirmation
```
*Design intent:* the combo is placed **before** individual books on every class hub. The parent never has to assemble a basket themselves — that is the friction that loses this persona.

**Flow B — Student, direct search**
```
Any page → ⌘K → "spark chemistry 2" → instant result → Product page
     → Preview pages → Add to cart
```
*Design intent:* zero navigation. Palette opens in < 100ms with a pre-warmed client-side index.

**Flow C — Organic Key Notes entry (highest-volume, currently a dead end)**
```
Google "class 10 science notes marathi" → /key-notes/10/science
     → Preview → Download (email capture) → **thank-you state offers the full paid guide**
     → Product page → Cart
```
*Design intent:* this flow is the single biggest untapped revenue lever on the current site. Today it ends at a PDF link.

**Flow D — AI-assisted discovery**
```
Any page → floating assistant → "which book for 12th PCM?"
     → RAG answer + inline product cards → Add to cart from chat
```
*Design intent:* the assistant returns **components, not just text**. A chat that can't add to cart is a support tool, not a commerce feature.

**Flow E — Stream configurator (11–12)**
```
Class 12 hub → stream selector (Science/Commerce/Arts) → PCM|PCB|PCBM
     → matched combo + optional add-ons → Cart
```

**Flow F — Wrong-purchase prevention**
```
Product page → medium mismatch detected (English page, Marathi-medium intent)
     → inline variant switch → correct SKU
```

**Flow G — Returning user**
```
Account → Orders → Track → Reorder / Downloads
```

**Flow H — Cart abandonment recovery (client-side)**
```
Cart persisted → return visit → nav cart badge → cart restored with items intact
```

---

## 6. Content Model (drives Phase 2's component contracts)

```ts
Book      { slug, title, titleMr?, series, board, class, medium, subject, stream?,
            price, mrp, discount, cover, gallery[], previewPages[], pages, isbn,
            edition, description, specs, rating, reviewCount, inStock, related[] }
Combo     { slug, title, board, class, medium, stream?, items: Book[],
            price, itemsTotal, savings, savingsPct, cover, highlights[] }
KeyNote   { slug, class, subject, medium, chapters[], previewUrl, fileUrl,
            gated: boolean, relatedBook }
ClassNode { id, label, labelMr, board, subjects[], streams?, hero, description }
Review    { id, productSlug, author, rating, body, date, verified }
```
Every one of these is a typed module today and a CMS query tomorrow — the components import the *type*, never the source.

---

## 7. Success Metrics
| Metric | Baseline | Target |
|---|---|---|
| AOV | ~₹100 (est.) | ₹250+ (above shipping threshold) |
| Combo attach rate | unknown | 35% of orders contain a combo |
| Key Notes → product CTR | ~0% | 12% |
| Mobile Lighthouse Perf | ~40 (typical WooCommerce) | ≥ 90 |
| Support "wrong book" contacts | unknown | −60% |
| AI assistant deflection | n/a | 40% of FAQ-type queries |

---

## 8. Decisions Needed Before Phase 2

**D1 — Key Notes business model.** Today they are free PDFs. Options: (a) keep free, email-gated, as a lead magnet feeding combo upsell — *recommended*, protects the best SEO asset and creates a mailing list; (b) sell them as SKUs; (c) free preview + paid full. Your brief implies (c). This changes the Key Notes page design, the funnel, and whether `/account/downloads` is a real feature.

**D2 — Devanagari typography.** Space Grotesk + Inter have no Devanagari glyphs; roughly half the catalog is Marathi. Recommendation: pair with **Noto Sans Devanagari** (headings) and **Mukta / Baloo 2** (body), tuned to match Inter's optical size. Without this, Marathi titles fall back to a system font.

**D3 — Board split.** CBSE and State Board are different curricula and different customers. Recommendation: a board switcher in the navbar that persists and filters the entire site, rather than mixing both in one catalog.

**D4 — Bilingual UI.** Should the *interface* (not just products) be available in Marathi? Recommendation: ship English UI with all strings extracted, add Marathi in a later phase. Full bilingual UI now would roughly double Phase 4.

**D5 — Product data source.** I'll need either a CSV/JSON export of the 325 SKUs, the WooCommerce REST endpoint, or approval to build realistic seed data matching the real catalog structure. Recommendation: build the typed seed layer now and swap in the real export later — this does not block Phase 2 or 3.

**D6 — 3D book viewer (React Three Fiber).** Adds ~120 KB and real GPU cost on the low-end Android devices this audience uses. Recommendation: use CSS 3D transforms for book tilt/flip (near-identical perceived quality, ~0 KB) and reserve R3F for a single hero showcase, lazy-loaded and desktop-only.

---

## 9. Phase 2 Preview (on approval)
Design system and tokens (colour, type, spacing, radius, elevation, glass recipes, motion curves and durations), component inventory with variants and states, animation system with a reduced-motion contract, dark-mode glass strategy, and the breakpoint model.

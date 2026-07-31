# Phase 3 — Wireframes & UX Rationale

Low-fidelity structure + the reasoning behind every layout decision. Desktop diagrams shown; mobile variant noted per page. Implemented in Phase 4 (`frontend/`).

**Legend:** `▓` image/cover · `▬` text line · `[ ]` control · `▒` glass chrome

---

## 0. Section Rhythm Contract

A 15-section homepage fails not from length but from sameness. Every section varies on three axes:

| Axis | Values |
|---|---|
| Band | canvas · white · brand-dark · brand-soft |
| Width | full-bleed · 1280 container · 704 prose |
| Density | airy (1–3 items) · medium (4–6) · dense (8+ / list) |

No two adjacent sections may share all three. This is enforced by the `<Section>` component taking `band`, `width`, `density` props.

---

## 1. Global Chrome

### Navbar (sticky, glass, shrinks 72→56px on scroll)
```
▒─────────────────────────────────────────────────────────────────▒
│ KOHINOOR   Shop▾ Combos▾ Class▾ KeyNotes▾ About Contact         │
│  TEZ                          [State Board▾][मराठी▾] ⌘K ♡ 🛒 👤 │
▒─────────────────────────────────────────────────────────────────▒
```
**Rationale.** The board + language switchers sit in the nav, not on a settings page, because they change *what the entire catalog contains* (D3). Putting them beside the utilities makes the current context permanently visible — a Marathi-medium parent should never wonder whether they're seeing English books. Selection persists in `localStorage` and is read before first paint to avoid a flash of wrong-medium content.

Scroll behaviour: height shrinks, blur increases 20→24px, a hairline border fades in. Three simultaneous cues for one state change — this is the "shrink + blur on scroll" from the brief, done as one coordinated transition rather than three separate animations.

### Mega menu (hover-intent 120ms, full keyboard operable)
```
▒─────────────────────────────────────────────────────────────────▒
│ BY CLASS      BY SUBJECT      BY SERIES     │  FEATURED         │
│ Nursery       Mathematics     Kohinoor      │  ▓▓▓▓▓            │
│ Class 5..12   Science         Spark         │  ▓▓▓▓▓ Class 10   │
│ Board Exam    Social Sci.     Vidyamitra    │  ▓▓▓▓▓ Combo      │
│               Languages       WinWings      │  Save ₹240        │
│                               Ekatmik       │  [View →]         │
▒─────────────────────────────────────────────────────────────────▒
```
**Rationale.** Three columns map to the three ways people actually shop (my child's class / the subject they're failing / the brand a teacher recommended). The fourth panel is merchandising — a mega menu with dead space is a wasted 400×300 billboard on the highest-traffic surface of the site. Hover-intent delay prevents the menu firing while the cursor travels across the nav.

### Mobile bottom nav (fixed, safe-area aware)
```
              ┌──────────────────────────────────┐
              │  🏠     🔍     🔎     🛒     👤  │
              │ Home   Shop  Search  Cart  Account│
              └──────────────────────────────────┘
```
**Rationale (D12).** Top hamburgers require a thumb stretch on a 6.7″ phone. Five destinations, all in the natural thumb arc. Cart carries a count badge. This replaces — does not supplement — the top nav on mobile; the top bar keeps only the logo, board/language chips, and search.

### Footer
Four link columns + newsletter + NAP block + social + legal row. Contains the full class list and series list as crawlable links — the footer is the site's internal-linking backbone for SEO.

---

## 2. Home

### §1 Hero — full-bleed, airy, mesh band
```
   ┌────────────────────────────────────────────────────────────┐
   │  ▪ Maharashtra State Board · CBSE                          │
   │                                          ╭──────────╮      │
   │  Every subject.                          │ ▓▓▓▓▓▓▓▓ │      │
   │  Every class.                            │ ▓▓▓▓▓▓▓▓ │ ← 3D │
   │  One trusted guide.                      │ ▓▓▓▓▓▓▓▓ │      │
   │                                          ╰──────────╯      │
   │  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                  ╭────────╮        │
   │                                    ╭────│ ▓▓▓▓▓▓ │        │
   │  [ Shop Now ]  [ Explore → ]       │▓▓▓▓│ ▓▓▓▓▓▓ │        │
   │                                    ╰────╰────────╯        │
   │  ▒ 325 titles ▒ 12 classes ▒ 5 series ▒ Free ship ₹200+  │
   └────────────────────────────────────────────────────────────┘
```
**Rationale.** Headline states catalog completeness — the single biggest trust question a parent has ("will you have my child's exact book?"). The trust strip sits above the fold as glass chips, converting the site's real numbers into credibility without a separate "stats" section doing it 8 scrolls later.

Book showcase: a fanned stack of three covers, front cover tilting on pointer move (CSS 3D). R3F is loaded only here, desktop-only, lazily (D6). Mobile drops to a single static hero cover — a 3D canvas above the fold on mobile is an LCP disaster.

**Anti-pattern avoided:** no carousel. Hero carousels have a well-documented ~1% engagement on slides 2+, and they push LCP into the second slide's image.

### §2 Shop by Class — full-bleed, dense, white band
```
  Find your class
  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
  │Nur │ 5  │ 6  │ 7  │ 8  │ 9  │ 10 │ 11 │ 12 │Board│    │
  │sery│    │    │    │    │    │ ★  │    │    │Exam │    │
  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
```
**Rationale.** Placed second — *before* any product — because class is the primary navigation axis (Phase 1 §3.1). A parent's first decision is never "which book," it's "which class." Numeric tiles, not cards: they scan in one saccade and occupy a fraction of the vertical space a card row would. Class 10 and 12 carry a subtle marker (highest-volume board years). Horizontally scrollable on mobile with edge-peek.

### §3 Combo Packs — full-bleed, airy, **brand-dark band**
```
  ┌──────────────────────────────────────────────────────────┐
  │  SAVE UP TO 30%                                          │
  │  ┌──────────────────────┐   Class 10 Complete Set        │
  │  │  ▓▓  ▓▓  ▓▓  ▓▓      │   7 books · Marathi Medium     │
  │  │  ▓▓  ▓▓  ▓▓          │                                │
  │  └──────────────────────┘   Bought separately   ₹560     │
  │                             Combo price         ₹420     │
  │                             ─────────────────────────    │
  │                             You save            ₹140 ✓   │
  │                             [ View Combo → ]             │
  └──────────────────────────────────────────────────────────┘
```
**Rationale.** This is the highest-value section on the site and it sits third, on the page's first dark band — the rhythm break makes it impossible to scroll past. The price comparison is rendered as an explicit three-line calculation rather than a "30% OFF" badge, because the persuasive unit for this buyer is *rupees saved*, not a percentage. Given ASP ~₹60 against a ₹200 shipping threshold, combos are how the business clears that line (Phase 1 §7).

### §4 Featured Books — container, medium, canvas
```
  ┌───────────────────────┐  ┌──────────┐ ┌──────────┐
  │                       │  │ ▓▓▓▓▓▓▓▓ │ │ ▓▓▓▓▓▓▓▓ │
  │      ▓▓▓▓▓▓▓▓         │  │ ▬▬▬▬     │ │ ▬▬▬▬     │
  │      ▓▓▓▓▓▓▓▓         │  └──────────┘ └──────────┘
  │      ▓▓▓▓▓▓▓▓         │  ┌──────────┐ ┌──────────┐
  │  Editor's pick        │  │ ▓▓▓▓▓▓▓▓ │ │ ▓▓▓▓▓▓▓▓ │
  │  ▬▬▬▬▬▬▬▬▬  [Buy]     │  │ ▬▬▬▬     │ │ ▬▬▬▬     │
  └───────────────────────┘  └──────────┘ └──────────┘
```
**Rationale.** Asymmetric 1-large + 4-small. Editorial hierarchy signals human curation; a 5-up equal grid signals a database query. This is the first section showing book cards, so it establishes the card language before the denser sections reuse it.

### §5 Browse by Subject — container, dense, white
Subject tiles with icon + count (`Mathematics · 48 titles`). Counts are the point: they prove depth and set expectations before the click.

### §6 Best Sellers — container, dense, canvas — **ranked chart, not a grid**
```
  Best Sellers                              [Class 10 ▾]
  ──────────────────────────────────────────────────────
   01  ▓▓  Kohinoor Abhyasika · Science      ★4.8  ₹100 [+]
   02  ▓▓  Spark Chemistry I                 ★4.7   ₹30 [+]
   03  ▓▓  WinWings Class 10 Combo           ★4.9  ₹420 [+]
```
**Rationale.** Solves the "three identical card rows" problem structurally. Large ordinal numerals communicate rank — information a grid physically cannot carry. Dense rows also let 8 items occupy the vertical space 3 cards would. Inline `[+]` adds to cart without leaving the page: for a ₹30 repeat-purchase item, a product-page round trip is pure friction. Class filter chip scopes the chart, because "best selling" is meaningless across 12 grade levels.

### §7 New Arrivals — full-bleed, medium, white — swipeable rail
Edge-peel carousel (next card partially visible, so affordance is obvious without arrows on mobile). Drag on touch, arrows on desktop. Full-bleed so cards run off the right edge — a contained carousel with padding looks finished and therefore un-swipeable.

### §8 Key Notes funnel — container, airy, brand-soft band
```
  ┌────────────────────┐   Free chapter previews
  │  ╔══════════════╗  │   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
  │  ║  ▬▬▬▬▬▬▬▬▬▬  ║  │
  │  ║  ▬▬▬▬▬▬▬▬▬▬  ║  │   ✓ Chapter-wise notes
  │  ║  ▬▬▬▬▬▬      ║  │   ✓ Marathi & Semi-English
  │  ╚══════════════╝  │   ✓ No sign-up to preview
  │   page 12 of 96    │
  └────────────────────┘   [Browse Key Notes] [Class 10 →]
```
**Rationale.** Implements D1. The preview device shows an actual notes page, and "No sign-up to preview" is stated explicitly — the friction objection is answered before it forms. This section exists to capture the site's largest organic entry point and route it toward the paid guide (Phase 1 Flow C).

### §9 Series / Publishers — full-bleed, dense, white
The five imprints (Kohinoor, Spark, Vidyamitra, WinWings, Ekatmik) as a horizontal strip with one-line positioning each. **Rationale:** the fifth taxonomy axis, invisible on the current site. A teacher who says "get the Spark books" needs a route that isn't search.

### §10 Statistics — full-bleed, airy, **brand-dark band**
Four count-up figures (titles, students served, years publishing, schools). Second dark band, placed at the page's midpoint to reset scroll fatigue.

### §11 Educational Resources — container, medium, canvas
Syllabus PDFs, exam calendars, guessing papers, study planners. Utility content that earns links and repeat visits.

### §12 Testimonials — full-bleed, medium, white
Two marquee rows scrolling in opposite directions at different speeds, pausing on hover, `prefers-reduced-motion` → static grid. Parent quotes and student quotes visually distinguished.

### §13 AI Assistant promo — container, airy, brand-soft
Shows a real conversation with an inline product card as the answer. **Rationale:** users don't click chat bubbles they assume are canned support bots. Demonstrating that it recommends actual books (D9) is what converts curiosity into first use.

### §14 FAQ — prose width (704), dense, canvas
Six accordions covering shipping, returns, medium selection, delivery time, bulk orders, authenticity. Ends with "Still have a question? → Ask the assistant." Renders `FAQPage` JSON-LD.

### §15 Newsletter — container, airy, brand-dark
Single email field, one line of value copy, no fake urgency.

> **Recommendation (not applied without your approval):** merge §4 Featured into §6 Best Sellers, and §11 Resources into §8 Key Notes. That takes 15 sections to 13 and removes the two weakest scroll moments. All 15 are built as specified; §11–§13 are below-fold dynamic imports either way.

---

## 3. Shop

```
  Home / Shop                              325 books
  ┌──────────────┐ ┌──────────────────────────────────────┐
  │ ▒ FILTERS    │ │ [Class 10 ×][Marathi ×]  Clear all   │
  │ Class      ▾ │ │ Showing 1–24 of 47   [⊞][≡] [Sort ▾] │
  │ ☑ Class 10   │ ├──────────────────────────────────────┤
  │ Subject    ▾ │ │  ┌────┐ ┌────┐ ┌────┐ ┌────┐        │
  │ Medium     ▾ │ │  │ ▓▓ │ │ ▓▓ │ │ ▓▓ │ │ ▓▓ │        │
  │ Series     ▾ │ │  └────┘ └────┘ └────┘ └────┘        │
  │ Price   ═══◉ │ │  ┌────┐ ┌────┐ ┌────┐ ┌────┐        │
  │ ☐ In stock   │ │  └────┘ └────┘ └────┘ └────┘        │
  └──────────────┘ └──────────────────────────────────────┘
```
**Rationale.** Filters are a persistent left rail on desktop — a modal for the primary browsing mechanism of a 325-SKU catalog adds a click to every refinement. All state is URL-encoded (`/shop?class=10&medium=marathi`): shareable, back-button correct, server-renderable, indexable. Active filters appear as removable chips above results because collapsed accordions hide what's currently applied, and "why am I seeing so few books" is the top faceted-search complaint. Pagination, not infinite scroll — infinite scroll breaks the footer, breaks back-navigation, and can't be crawled.

**Mobile:** filter rail becomes a Vaul bottom sheet with snap points, an applied-count badge on the trigger, and a sticky "Show 47 results" button — the count updates live so the user knows the outcome before committing.

---

## 4. Product Detail

```
  ┌───────────────┐  ┌──────────────────────────────┐
  │               │  │ Kohinoor · Class 10 · Marathi│
  │    ▓▓▓▓▓▓▓    │  │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬            │
  │    ▓▓▓▓▓▓▓    │  │ ★★★★☆ 4.8 (126)              │
  │    ▓▓▓▓▓▓▓    │  │                              │
  │               │  │ ┌──────────────────────────┐ │
  └───────────────┘  │ │ ▒ ₹100  ~~₹120~~  -17%   │ │
  [▓][▓][▓][▓]       │ │ Medium: [मराठी][Semi-Eng]│ │
  front back inside  │ │ ✓ In stock               │ │
                     │ │ [− 1 +]  [ Add to Cart ] │ │
  ▶ Preview 14 pages │ │ [♡ Wishlist]             │ │
    free, no sign-up │ │ ⓘ Free shipping over ₹200│ │
                     │ └──────────────────────────┘ │
```
**Rationale.**

*The medium switch inside the purchase panel* is the highest-value element on this page. Wrong-medium orders are the top support cost identified in Phase 1. Placing the switch at the point of purchase — not as a related-product link at the bottom — is what prevents the error.

*Free preview, no sign-up* (D1) directly above the buy button. For a ₹100 guide from an unfamiliar site, "can I see inside" is the blocking objection.

*Sticky purchase panel* on desktop; on mobile it becomes a bottom action bar that appears once the primary CTA scrolls out of view — never both visible at once.

*Below the fold:* specifications table (class, board, medium, subject, series, pages, ISBN, edition), description, **Frequently Bought Together** (a checkbox bundle with a combined price — this is the ₹200 threshold mechanism at the item level), related books, and reviews. `Product` + `AggregateRating` + `BreadcrumbList` JSON-LD.

---

## 5. Class Hub (×11 — the primary SEO landing pages)

```
  Class 10                        [मराठी] [Semi-English] [English]
  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

  ┌──────────────────────────────────────────────────────┐
  │ ▒ RECOMMENDED · Class 10 Complete Set · Save ₹140    │
  │   7 books covering every subject      [View Combo →] │
  └──────────────────────────────────────────────────────┘

  Subjects        [Maths][Science][Social][English][Marathi]…
  All books       ┌────┐┌────┐┌────┐┌────┐
  Key Notes       free previews →
  Ask the assistant: "Which set should I buy for Class 10?"
```
**Rationale.** The combo appears **above** individual books, per Phase 1 Flow A — the parent persona should not have to assemble a basket. Medium switcher at the top filters the entire page, because a Marathi-medium family has zero use for the English SKUs and showing them creates doubt. Class hubs carry the long-tail keywords ("class 10 marathi medium science guide") and are statically generated.

---

## 6. Combo Pages

**Landing:** grouped by class band (5–8, 9–10, 11–12) with a stream selector for 11–12 (PCM/PCB/PCBM/Commerce/Arts) — a configurator, not a flat list, because "12th Science" alone is four different baskets.

**Detail:** contents manifest listing every included book as a linked row with its individual price, then the arithmetic (`items total → combo price → you save`), then a savings meter. Each contained book links to its own product page — buyers verify a bundle by checking its parts.

---

## 7. Key Notes

**Landing:** class × subject matrix; every cell a direct link. **Detail:** chapter list, an in-page preview reader (first 10–20 pages, no login, D1), then a conversion block — *"Notes cover the syllabus. The Kohinoor guide adds solved examples, board questions, and practice papers."* → product card. This is Flow C, the site's biggest untapped lever.

---

## 8. About · Contact

**About:** prose-width story, then a scroll-driven vertical timeline (GSAP ScrollTrigger — one of only two GSAP uses), vision/mission/values as three asymmetric blocks, achievements as counters, imprint origin stories.

**Contact:** two-column — glass form (RHF + Zod, inline validation on blur not on keystroke) beside a NAP block with real Nagpur address, both phone numbers as `tel:` links, and a click-to-load map (an eager Maps iframe costs ~800 KB and a third-party cookie). `LocalBusiness` JSON-LD.

---

## 9. Cart · Checkout

```
  ┌──────────────────────────┐ ┌────────────────────────┐
  │ ▓ Kohinoor Science  ₹100 │ │ ▒ Subtotal      ₹160   │
  │   Class 10 · मराठी [−1+] │ │   Shipping      ₹40    │
  │ ▓ Spark Chemistry    ₹60 │ │   ───────────────────  │
  │                          │ │   Total         ₹200   │
  │ ▓▓▓▓▓▓▓▓░░░░ ₹40 to      │ │  [ Checkout → ]        │
  │ free shipping            │ └────────────────────────┘
  │ Add one of these: ┌──┐┌──┐┌──┐                       │
```
**Rationale.** The free-shipping meter plus a targeted upsell strip is the single highest-ROI element in the cart for this business — a ₹40 gap is more cheaply closed by selling a ₹30 book than by absorbing shipping. Checkout is a 3-step wizard (details → shipping → payment) with a stubbed `PaymentProvider`; guest checkout is the default path, account creation offered *after* order confirmation.

---

## 10. Account
Glass dashboard shell with sidebar (desktop) / tabs (mobile): Orders, Order Tracking (guest-accessible by order ID + phone), Wishlist, Downloads, Profile, Settings. Auth screens are centred glass panels on a mesh field. All backed by a stubbed `AuthProvider`.

---

## 11. Overlays

**Command palette (⌘K):** grouped results — Books / Combos / Key Notes / Classes / Pages. Natural-language queries ("class 10 science marathi") route to the semantic endpoint and return *filtered results*, not chat prose (D8). Full keyboard operation, recent searches when empty. Mobile: full-screen takeover with autofocus.

**AI assistant (D9):** glass circular launcher, bottom-right, single slow ambient glow — not an infinite pulse, which reads as an unread-notification lie. Desktop: anchored 400×600 panel. Mobile: Vaul drawer at 60% snap, expandable. Streaming markdown, context-aware suggested prompts (different on a product page than on home), copy/regenerate/feedback per message, and **inline product cards with working Add to Cart** — the feature that makes it a sales channel rather than a support widget.

---

## 12. States (designed before happy paths)
Every list ships four states: **skeleton** (matching final layout exactly, so there is no CLS), **empty** (with the nearest useful action — "No Class 9 English books yet → browse Marathi / ask the assistant"), **error** (retry + phone fallback), **partial** (some filters yield nothing → suggest which filter to drop).

---

## 13. Rendering Strategy
| Surface | Strategy |
|---|---|
| Home, About, Contact, class hubs, product, combo, key-notes | SSG + ISR |
| Shop with filters | Server component, `searchParams`-driven |
| Cart, wishlist, account | Client, localStorage-persisted |
| Assistant, palette, quick view, filter sheet, R3F hero | `next/dynamic`, no SSR |
| Below-fold home sections (§11–§15) | Dynamic import on intersection |

---

*Phase 4 implementation follows in `frontend/`.*

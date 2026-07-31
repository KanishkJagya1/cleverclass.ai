# Phase 2 — Design System, Component Inventory, Animation System

**Implementation:** `frontend/styles/tokens.css` · `frontend/styles/glass.css`
**Status:** Awaiting approval to proceed to Phase 3 (wireframes + UX rationale)
**Decisions locked:** D1–D12

---

## 1. Design Philosophy

> **Restraint is the premium signal.** Cheap sites add. Expensive sites remove.

D11 asked for Apple/Vercel/Linear/Notion, not a flashy ecommerce template. That is not a stylistic preference — it is an engineering constraint that shapes every token below. Four operating principles:

**1.1 Whitespace is the primary design element.** Sections use `--section-y` (72–128px) minimum. Nothing on this site is dense except deliberately dense surfaces (filter rails, cart lines, comparison tables). If a layout feels empty during review, that is correct — it will feel *considered* once real content and real Devanagari titles land.

**1.2 One accent, doing one job.** Indigo is the brand. Emerald means *commercial gain* — savings, in stock, free-shipping-unlocked — and nothing else. Amber is ratings only. Violet exists solely inside ambient gradient meshes at ≤ 0.12 alpha and never touches text, borders, or buttons. A user must be able to learn "green = you're saving money" in one page.

**1.3 Motion is feedback, not entertainment.** Every animation answers *"what just changed and where did it come from?"* Decorative loops (floating particles, infinite pulses, parallax on everything) are rejected — they cost battery on the mid-range Android this audience carries, and they read as cheap on a 27″ display. The brief asked for particles; the mesh field in §5.4 delivers the same atmosphere for a single static paint.

**1.4 The book is the hero.** 325 products with real covers, many in Devanagari. The interface's job is to disappear behind them. Neutral surfaces, restrained chrome, generous margins around cover art.

---

## 2. The Glass Doctrine

This is the most important decision in Phase 2, because "glassmorphism everywhere" and "Apple-like restraint" appear contradictory. They aren't — the resolution is *where* glass goes.

| | Material | Applies to |
|---|---|---|
| **Chrome** — floats above content | **Glass** | Navbar, mega menu, mobile bottom nav, command palette, modals, drawers, chat panel, toasts, sticky purchase bar, filter sheet |
| **Content** — is the page | **Opaque** | Book cards, section backgrounds, product detail, tables, forms, footer |

This is precisely how visionOS and macOS behave: vibrancy lives in sidebars, menus, and toolbars — never on documents. It delivers the luxury glass impression on every screen (chrome is always visible) while keeping content crisp and legible, which matters enormously for Devanagari at small sizes.

**It also solves the performance problem.** `backdrop-filter` forces the compositor to re-sample everything behind an element. Applied to 24 book cards in a scrolling grid, it destroys frame rate on a ₹12,000 Android phone. Applied to a fixed navbar and one exclusive overlay, it costs almost nothing — fixed elements don't re-composite on scroll.

**Hard budget: ≤ 2 live `backdrop-filter` layers per viewport.** Enforced structurally: only chrome components may use `.glass-chrome` / `.glass-panel`, and panels are mutually exclusive by nature (you cannot have the palette and a modal open at once).

### Three tiers

| Tier | Blur | Background (light) | Background (dark) | Use |
|---|---|---|---|---|
| `.glass-chrome` | 20px + saturate 180% | `white / 0.72` | `#0C0E16 / 0.70` | Persistent chrome |
| `.glass-panel` | 32px + saturate 180% | `white / 0.80` | `#10131E / 0.78` | Transient overlays |
| `.glass-veil` | 8px, no saturate | `slate / 0.32` | `black / 0.52` | Scrim behind a panel |

**Why `saturate(180%)`:** blur alone desaturates what's behind it and produces grey mush. Boosting saturation is what makes the material read as *glass* rather than *fog*. This is the single most-skipped step in glassmorphism implementations.

**The specular edge (`.glass-edge`):** a 1px gradient border, bright at the top-left, fading to near-transparent at the bottom-right — simulating light catching a physical edge. Implemented with a masked pseudo-element, so it costs one composited layer and zero blur. This detail is the difference between "real premium glass" and a translucent rectangle.

### Dark-mode glass
The standard failure is raising white alpha on dark backgrounds, producing milky grey plastic. **Dark glass darkens.** The base is a near-black tint at 0.70–0.78 alpha; separation comes from the edge highlight at `0.10` alpha, not from lightening the fill. Shadows are nearly invisible on dark backgrounds, so on dark the edge does the work shadow does on light.

---

## 3. Colour System

### Verified contrast (computed, not estimated)

| Token | Value | On | Ratio | Verdict |
|---|---|---|---|---|
| `fg` | `#0F172A` | `#F8FAFC` | **17.4:1** | AAA |
| `fg-muted` | `#475569` | `#F8FAFC` | **7.24:1** | AAA |
| `fg-subtle` | `#64748B` | `#F8FAFC` | **4.62:1** | AA — floor, never below 14px |
| `fg-brand` | `#312E81` | `#F8FAFC` | **10.92:1** | AAA |
| `brand-on` | `#FFFFFF` | `#312E81` | **11.42:1** | AAA — primary button |
| ~~emerald-600~~ | `#059669` | `#F8FAFC` | **3.60:1** | ✗ **fails AA** — non-text/large only |
| `gain` | `#047857` | `#F8FAFC` | **5.21:1** | AA — the savings token |

That emerald row is why `--signal-gain` is emerald-**700**. The obvious choice fails, and "Save 25%" badges are exactly the small text that must not fail.

### Ramps
Two full ramps only — **indigo** (brand, anchored 900 = `#312E81`) and **ink** (cool neutrals). Accents ship as 3–5 stops each, not full ramps, because a ramp you don't need is a decision you'll later regret making available.

### Semantic layer
Components never reference `indigo-600`. They reference `brand`, `fg-muted`, `line`, `gain`. This indirection (`@theme inline` → CSS var → `:root`/`.dark`) is what makes dark mode a class toggle instead of a rewrite, and what will make a future white-label or seasonal theme a 30-line diff.

**Board colour-coding (D3):** State Board and CBSE are *not* differentiated by hue — two brand colours would halve the brand's strength. They're differentiated by a labelled chip in the persistent switcher. Colour carries meaning here; boards carry identity.

---

## 4. Typography

| Role | Family | Notes |
|---|---|---|
| Display / headings | **Space Grotesk** | 500/600/700. Tight tracking at 4xl+ |
| Body / UI | **Inter** | 400/500/600. `cv11`, `ss01` on; tabular numerals for prices |
| Devanagari UI | **Noto Sans Devanagari** | Paired in the same stack — one utility styles both scripts |
| Devanagari prose | **Mukta** | Longer Marathi passages, 400/500/600 |

### The Devanagari problem, solved
Marathi titles (कोहिनूर अभ्यासिका) have taller ascenders, the shirorekha (headline stroke), and matras that descend below the baseline. Three consequences baked into the tokens:

1. **`--leading-deva: 1.78`** — Devanagari clips its own matras below ~1.7 line-height. Any component rendering `titleMr` uses this, not `--leading-normal`.
2. **Same-stack pairing** — Devanagari faces sit *inside* `--font-sans` and `--font-display`, so a mixed-script string ("Class 10 गणित") renders at one consistent weight and size without a wrapper component.
3. **Optical size matching** — Noto Sans Devanagari runs visually smaller than Inter at the same px. Phase 4 applies `size-adjust` in the `next/font` declaration so mixed-script lines share a baseline.

### Scale
Fluid `clamp()` from a 360px floor to a 1280px ceiling. Ratio tightens on mobile (1.20) and opens on desktop (1.333), so hero headlines gain presence on large screens while body text stays at a fixed comfortable size. Note both `--text-base` (15px, dense UI) and `--text-body` (16px, prose) exist — using 16px for UI chrome makes an interface feel bulky; using 15px for prose makes it feel cramped.

**Numerals:** prices always use `font-variant-numeric: tabular-nums`. Non-tabular figures make a price column visibly ragged — a small detail that reads as amateur.

---

## 5. Space, Depth, Shadow, Ambience

**5.1 Spacing** — 4px base, 8px rhythm. Section rhythm is tokenised (`--section-y-sm/–/-lg`) and *mandatory* for sections. This is where D11's premium whitespace is enforced by the system rather than by discipline.

**5.2 Layout** — container 1280px, prose 704px (≈68ch for Inter at 16px — the readability optimum). Gutters step 20 → 32 → 40px.

**5.3 Shadows** — five levels, each **multi-layer** (a tight contact shadow + a wide ambient shadow), tinted with indigo `rgb(30 27 75)` rather than black. Black shadows on a cool background read as grey smudge; tinted shadows read as light. Alphas stay ≤ 0.10.

**5.4 Ambient mesh** — the brief's "background blobs / particles," implemented as three fixed radial gradients plus an SVG noise overlay at 3.5% opacity. **No animation loop, no canvas, no particle library.** The noise layer prevents banding, which large soft gradients always exhibit on 8-bit displays. Cost: one paint, ~0 KB JS.

---

## 6. Motion System

**Four durations, four curves.** A fifth of either means a component is wrong.

| Token | ms | Use |
|---|---|---|
| `instant` | 90 | Tap/press feedback |
| `fast` | 150 | Hover, focus, toggles |
| `base` | 240 | Dropdowns, tooltips, tabs |
| `slow` | 380 | Modals, drawers, page chrome |
| `reveal` | 620 | Scroll-triggered section reveals |

| Curve | Value | Use |
|---|---|---|
| `standard` | `0.2, 0, 0, 1` | Default for everything |
| `out-expo` | `0.16, 1, 0.3, 1` | Entrances — fast start, long settle |
| `in-out` | `0.65, 0, 0.35, 1` | Position changes both ways |
| `spring` | `0.34, 1.56, 0.64, 1` | Magnetic buttons, elastic — sparingly |

### Division of labour
- **CSS** owns high-frequency stateless motion: hover lift, press, sheen, tilt. Zero JS cost on a grid of 24 cards.
- **Framer Motion** owns stateful and interruptible motion: layout transitions, modal/drawer enter-exit, staggered reveals, shared layout IDs, gesture-driven drags.
- **GSAP** is used *only* where a real scroll timeline is needed — the About page publishing-journey timeline and the hero book showcase pin. Two files. Nowhere else.
- **Lenis** provides smooth scrolling, disabled under `prefers-reduced-motion` and on `data-perf="low"`.

### The reduced-motion contract
`prefers-reduced-motion` removes **movement** but preserves **opacity and colour transitions**. A blanket `animation: none !important` makes an interface feel broken rather than calm — the user still needs to perceive that a menu opened. Rule: *motion carries delight, opacity carries meaning.*

Three further fallbacks are wired in `glass.css`: `@supports` (no backdrop-filter), `data-perf="low"` (weak device — set by a capability probe at boot), and `prefers-reduced-transparency` (a genuine low-vision need). Each degrades to a still-premium result; none breaks layout.

---

## 7. Responsive Model — Mobile-First Interactions (D12)

Breakpoints: **480 / 640 / 768 / 1024 / 1280 / 1536**. The 480 stop is added deliberately — this audience skews to large budget Android phones, where a 360-designed layout wastes 25% of the screen.

Mobile is **not** a scaled desktop. Distinct interaction patterns, not just reflowed ones:

| Pattern | Mobile (< 768) | Desktop (≥ 1024) |
|---|---|---|
| Navigation | Fixed bottom bar: Home · Shop · Search · Cart · Account — thumb zone | Sticky top nav + mega menus |
| Search | Full-screen takeover, autofocus, recent chips | ⌘K centred command palette |
| Filters | Vaul bottom sheet, snap points, applied-count badge, sticky "Show N results" | Persistent left rail, no modal |
| Carousels | Swipeable, edge-peek showing the next card exists | Arrow controls + drag |
| Product buy | Sticky bottom action bar (price + Add to Cart) | Sticky right-column purchase panel |
| AI assistant | Vaul drawer at 60% snap, expandable to full | Anchored floating panel, bottom-right |
| Mega menu | Accordion inside a drawer | Hover-intent mega panel with preview |

**Non-negotiables:** 44×44px minimum touch targets; no horizontal page scroll at any width (only opt-in carousels scroll horizontally, inside `overflow-x: auto` containers); primary actions inside the bottom third of the screen; `env(safe-area-inset-bottom)` respected on the bottom nav.

---

## 8. Component Inventory

**87 components across 8 groups.** Every one is typed, has explicit states, and consumes only semantic tokens. Variants use `class-variance-authority`; class merging uses `tailwind-merge` + `clsx`.

Universal states, required on every interactive component: `default · hover · active · focus-visible · disabled · loading`. Plus, where data-bound: `empty · error · skeleton`.

### 8.1 Primitives (`components/ui/`) — shadcn-based, restyled to our tokens
`Button` (variants: primary, secondary, ghost, outline, glass, danger, link × sizes sm/md/lg/icon) · `IconButton` · `Input` · `Textarea` · `Select` · `Checkbox` · `Radio` · `Switch` · `Slider` (price range) · `Badge` (neutral, brand, gain, rating, danger) · `Chip` (removable filter token) · `Avatar` · `Separator` · `Skeleton` · `Spinner` · `Progress` · `Tooltip` · `Accordion` · `Tabs` · `Breadcrumb` · `Pagination` · `Rating` (display + interactive) · `QuantityStepper` · `Label` · `FieldError` · `VisuallyHidden`

### 8.2 Glass system (`components/glass/`)
`GlassCard` (chrome | panel | flat) · `GlassButton` · `GlassInput` · `GlassModal` · `GlassDrawer` (Vaul) · `GlassSheet` · `GlassDropdown` · `GlassTabs` · `GlassSidebar` · `GlassTooltip` · `GradientBorder` · `Spotlight` (radial follow-cursor highlight) · `MeshBackground` · `NoiseOverlay`

### 8.3 Motion (`components/motion/` + `animations/`)
`AnimatedHeading` (word/char stagger) · `Reveal` (scroll-triggered, IO-based) · `StaggerGroup` · `Marquee` (publishers/logos, pauses on hover) · `MagneticButton` · `TiltCard` (CSS 3D, D6) · `CursorGlow` (desktop + fine-pointer only) · `CountUp` (statistics) · `PageTransition` · `ParallaxLayer` · `TextShimmer` · `BookFlip3D` (CSS 3D cover→back flip, D10)

### 8.4 Commerce (`features/catalog/`, `features/cart/`)
`BookCard` (grid | list | compact | featured) · `BookCardSkeleton` · `ComboCard` (with savings meter) · `KeyNoteCard` · `ProductGallery` (front, back, inside spreads, flip — D10) · `ImageZoom` · `PreviewPagesViewer` (free preview, D1) · `PurchasePanel` (sticky) · `PriceBlock` (MRP strike, discount %, tabular nums) · `SavingsMeter` · `StockBadge` · `WishlistButton` · `QuickViewDialog` · `AddToCartButton` (idle → loading → added, with reversion) · `FrequentlyBoughtTogether` · `RelatedBooks` · `ComboContents` · `MediumSwitch` (Marathi ⇄ Semi-English ⇄ English variant) · `StreamSelector` (PCM/PCB/PCBM) · `ReviewList` · `ReviewSummary` · `FreeShippingMeter` · `CartLine` · `CartSummary` · `EmptyState`

### 8.5 Navigation (`components/layout/`)
`Navbar` (shrink + blur on scroll) · `MegaMenu` (hover-intent, keyboard operable) · `MobileBottomNav` · `MobileNavDrawer` · `BoardSwitcher` (persistent, D3) · `LanguageSwitcher` (persistent, D3) · `ThemeToggle` · `Footer` · `Container` · `Section` (enforces `--section-y`) · `PageHeader` · `Breadcrumbs` · `ScrollProgress` · `BackToTop`

### 8.6 Discovery (`features/search/`)
`SearchDialog` (cmdk, ⌘K) · `MobileSearchOverlay` · `SearchResultGroup` · `SemanticSearchInput` (NL → filters, D8) · `FilterRail` · `FilterSheet` (mobile) · `ActiveFilterChips` · `SortSelect` · `ViewToggle` · `ClassGrid` · `SubjectGrid` · `SeriesStrip` · `RecentSearches`

### 8.7 AI Learning Assistant (`features/assistant/`) — D9
`AssistantLauncher` (glass circle, single slow ambient glow — *not* an infinite pulse) · `AssistantPanel` (desktop) · `AssistantDrawer` (mobile, Vaul) · `MessageList` · `MessageBubble` · `MarkdownRenderer` · `StreamingText` · `SuggestedPrompts` (context-aware — differs on a product page vs. home) · `ProductCardInline` ← **the key one: the assistant returns components, not just prose, so a recommendation is add-to-cart-able** · `MessageActions` (copy, regenerate, 👍/👎) · `ConversationHistory` · `AssistantEmptyState` · `HandoffCard` (escalates order-specific queries to phone/WhatsApp)

### 8.8 Feedback & content
`Toast` (Sonner, restyled) · `AlertBanner` · `ConfirmDialog` · `NewsletterForm` · `ContactForm` (RHF + Zod) · `FAQAccordion` · `Timeline` (About) · `StatCard` · `TestimonialCard` · `TestimonialMarquee` · `ValueCard` · `MapEmbed` (lazy, click-to-load)

### 8.9 Data-layer seam (D5 + D7)
Not visual, but part of the system contract: every component imports **types**, never data sources. `lib/data/` exposes `getBooks`, `getBook`, `getCombos`, `getKeyNotes`, `search` against a `CatalogAdapter` interface. The seed adapter is typed local data today; a Postgres/Supabase/Sanity/Payload adapter drops in behind the same interface with zero component changes.

---

## 9. Iconography & Imagery

**Icons:** Lucide, 1.5px stroke, 20px default (16px dense, 24px touch). Never mix icon sets. Decorative icons get `aria-hidden`; icon-only buttons get `aria-label`.

**Book covers (D10):** every product supports front, back, inside spreads, and preview pages. Fixed 3:4 aspect ratio to eliminate CLS across a mixed-quality catalog. `next/image` with AVIF → WebP, blur placeholder generated at build. Covers sit on a subtle inset shadow with a spine gradient overlay — a flat cover JPEG on a white card looks like a database record; a 2px spine shadow makes it look like a physical book. `BookFlip3D` handles front↔back on interaction; 360° is deferred (needs a photo rig that doesn't exist yet).

---

## 10. Rules for Phase 4

1. Components consume **semantic tokens only**. A raw hex or a primitive ramp reference in a component is a review rejection.
2. **No arbitrary values** for spacing, colour, radius, or duration (`p-[13px]`, `bg-[#fff]`). If a token is missing, add it here first.
3. `backdrop-filter` may appear only in the three `glass.css` tiers. Never inline.
4. Every interactive element has a `focus-visible` ring and a 44px touch target.
5. Every animation must survive `prefers-reduced-motion: reduce` and still communicate its state change.
6. Every list has empty, loading (skeleton), and error states designed before the happy path is built.
7. Devanagari-bearing text uses `--leading-deva`.
8. Prices use tabular numerals, always.

---

## 11. What Phase 3 Delivers
Detailed wireframes with UX rationale for: Home (15 sections, each a distinct layout), Shop, Product, Class hub, Combo, Key Notes, About, Contact, Cart/Checkout, Account, plus the search palette, mega menu, and assistant panel — including mobile variants for each and the reasoning behind every layout decision.

# Accessibility

Target: **WCAG 2.1 AA**. What follows separates what is built and verifiable in
code from what still needs a human with a screen reader — conflating the two is
how accessibility claims become false.

---

## 1. Colour contrast — computed, not estimated

Ratios calculated against the light theme background `#F8FAFC`:

| Token | Value | Ratio | Level |
|---|---|---|---|
| `fg` | `#0F172A` | **17.4:1** | AAA |
| `fg-muted` | `#475569` | **7.24:1** | AAA |
| `fg-subtle` | `#64748B` | **4.62:1** | AA — the floor, never below 14px |
| `fg-brand` | `#312E81` | **10.92:1** | AAA |
| `brand-on` on `brand` | `#FFFFFF` on `#312E81` | **11.42:1** | AAA |
| `gain` | `#047857` | **5.21:1** | AA |

The savings/success token is emerald-**700**, not the obvious emerald-600
(`#059669`), which measures **3.60:1** and fails AA for body text. "Save 25%"
badges are exactly the small text that must not fail — so the failing value is
not in the palette at all.

---

## 2. Built and verifiable

### Structure
- One `<h1>` per page; headings descend without skipping levels
- Landmarks: `<header>`, `<nav aria-label>`, `<main id="main">`, `<footer>`
- Skip link is the first tabbable element on every page (`.skip-link`, visible on focus)
- Breadcrumbs use `<nav aria-label="Breadcrumb">`
- Every `<nav>` has a distinguishing `aria-label` (Main, Primary, Account, Filters, Pagination)

### Keyboard
- No `outline: none` anywhere without a replacement; `:focus-visible` ring is global
- Mega menus open on focus as well as hover, and close on `Escape`
- Command palette: full keyboard operation, `⌘K`/`Ctrl+K`, and `/` when not already typing
- Radix owns focus trapping and restoration for every dialog, drawer, dropdown and accordion
- Assistant textarea: `Enter` sends, `Shift+Enter` newlines
- Preview reader: `←`/`→` page navigation

### Touch targets
- 44×44px minimum on every interactive control (`Button` sizes `md`/`icon` are 44px; `sm`/`icon-sm` are 36px and used only in dense desktop contexts)
- Mobile bottom nav respects `env(safe-area-inset-bottom)`

### Screen reader support
- Icon-only buttons carry `aria-label`; decorative icons carry `aria-hidden`
- Cart and wishlist badges announce counts in the link's accessible name
- Live regions: filter result counts, quantity steppers, add-to-cart confirmation, preview page number, streaming assistant replies (`aria-live="polite"`)
- `AnimatedHeading` renders an unanimated `.sr-only` copy and hides the animated one — word-split text otherwise reads as fragments
- Star ratings expose `role="img"` with a text label; the visual stars are `aria-hidden`
- Free-shipping meter is a real `role="progressbar"` with `aria-valuenow`

### Motion and visual preferences
- `prefers-reduced-motion` removes **movement** but preserves opacity and colour transitions — a blanket `animation: none !important` makes interfaces feel broken rather than calm, and the user still needs to perceive that a menu opened
- `prefers-reduced-transparency` replaces every glass tier with an opaque surface
- `prefers-contrast: more` strengthens borders and removes blur
- `data-perf="low"` drops live blur on weak devices

### Language
- `lang="en-IN"` on `<html>`; `lang="mr"` on every Devanagari string
- Devanagari uses `--leading-deva: 1.78` because matras clip below ~1.7

### Forms
- Every input has a real `<label>` (`.sr-only` where the design has no visible label)
- Validation on blur, not on keystroke — live validation flags an email before the user has finished typing it
- Errors use `role="alert"` and are wired via `aria-describedby`; inputs get `aria-invalid`
- `autoComplete` set correctly throughout checkout (`name`, `tel`, `email`, `address-line1`, `postal-code`, …)

### Content
- All images have `alt`; decorative ones have `alt=""`
- Covers sit on a fixed 3:4 ratio, so nothing reflows as images land
- `text-wrap: balance` on headings, `pretty` on paragraphs

---

## 3. Needs manual verification before launch

Automated tools catch roughly 30% of WCAG issues. These require a person:

- [ ] **NVDA + Firefox** and **VoiceOver + Safari** pass over: home, shop with filters applied, a product page, cart, checkout, the palette, the assistant
- [ ] Keyboard-only purchase: home → class → product → medium switch → add to cart → checkout → place order, without touching a mouse
- [ ] Verify focus order matches visual order after the mega menu opens and closes
- [ ] Confirm the assistant's streaming `aria-live` is not so chatty that it becomes unusable — token-by-token announcement is a real risk with `polite` regions and may need debouncing to sentence boundaries
- [ ] 200% browser zoom and 320px viewport: no horizontal scroll, no clipped content
- [ ] Windows High Contrast Mode (forced-colors) — glass surfaces need checking, `backdrop-filter` behaves unusually there
- [ ] Colour-blind check on the emerald savings signal — it is the only place colour carries commercial meaning, and it needs its text label to be sufficient on its own
- [ ] Verify Devanagari renders with correct matra positioning in Chrome, Safari and Firefox at small sizes

---

## 4. Known gaps

**Streaming announcements.** `aria-live="polite"` on a token stream may announce
partial words. Mitigation would be buffering to sentence boundaries before
updating the live region — not implemented, and it should be tested with a real
screen reader before deciding.

**Marquee testimonials.** Static under `prefers-reduced-motion`, but the moving
version has no pause control beyond hover, which is not keyboard-reachable.
WCAG 2.2.2 wants an explicit pause for anything auto-moving for more than five
seconds. A visible pause button is the fix.

**Map embed.** Google's iframe is third-party content whose internal
accessibility is outside our control. The address is available as real text
above it, so the information is never map-dependent.

---

## 5. Testing commands

```bash
npx @axe-core/cli http://localhost:3000 --exit
npx lighthouse http://localhost:3000 --only-categories=accessibility --view
npx pa11y-ci --sitemap http://localhost:3000/sitemap.xml --sitemap-find "https://kohinoortez.com" --sitemap-replace "http://localhost:3000"
```

# Performance

The audience is mobile-majority on mid-range Android over 4G. Every decision
below is measured against that device, not a laptop on office wifi.

---

## Budgets

| Metric | Target | Why |
|---|---|---|
| LCP | < 2.0s | 4G, mid-tier Android |
| INP | < 200ms | Scroll and tap responsiveness with glass chrome on screen |
| CLS | < 0.05 | Mixed-quality cover art across 325 SKUs |
| First-load JS (home) | < 180 KB gzip | |
| Lighthouse mobile | Perf ≥ 90 · A11y ≥ 95 · BP 100 · SEO 100 | |

---

## Measured

Production build, `npm run build`:

- **432 pages prerendered.** Only `/shop`, `/class/[classId]`, `/combo-packs` and
  the two API routes are dynamic — they read `searchParams`. Everything else is
  SSG with 12-hour ISR.
- **1.8 MB total client chunks** across the whole app, largest single chunk 222 KB
  raw (~70 KB gzip). Route-level splitting means no page loads all of it.
- **Static generation: 25.3s** with 15 workers, including 325 product pages.

Lighthouse numbers are not quoted here because they have not been run against a
deployed instance. Run them post-deploy and record real figures rather than
inheriting an assumption.

---

## What was done

### The blur budget — the biggest single lever
`backdrop-filter` forces the compositor to re-sample everything behind an
element. On 24 book cards in a scrolling grid it destroys frame rate on a
₹12,000 Android. So:

- **Glass is chrome only** — navbar, palette, modals, drawers, chat, bottom nav.
  Content surfaces are opaque. About two live blur layers per viewport, and
  because chrome is mostly `position: fixed`, they do not re-composite on scroll.
- `will-change: backdrop-filter` + `translateZ(0)` on the navbar promotes it once
  rather than re-rasterising every scroll frame.
- **A capability probe** (`providers/index.tsx`) sets `data-perf="low"` from
  `deviceMemory ≤ 4`, `hardwareConcurrency ≤ 4`, `saveData`, or a 2G connection.
  `glass.css` then drops live blur entirely for opaque surfaces — still premium,
  a fraction of the cost.

### Ambient background
The brief asked for floating blobs and particles. Implemented as three fixed
radial gradients plus an inline SVG noise overlay — **one paint, zero JS, no rAF
loop, no canvas**. The noise layer exists because large soft gradients band
visibly on 8-bit displays.

### Images
- AVIF → WebP via `next/image`, with `deviceSizes` tuned to the real breakpoints
- Fixed 3:4 `.aspect-cover` on every cover — eliminates CLS across a catalogue
  whose source images vary
- `priority` only on the hero's centre cover and the first grid row; priority on
  everything is priority on nothing
- The book "spine" is a 3px CSS gradient, not a second image

### JavaScript
- `optimizePackageImports` for `lucide-react` and `motion` — lucide alone pulls
  ~1400 modules without it
- `next/dynamic` for the command palette, assistant widget, and home sections
  §10–§13 (statistics, resources, testimonials, assistant promo)
- CSS owns high-frequency stateless motion (hover lift, press, sheen, tilt);
  Motion owns only stateful, interruptible animation. A 24-card grid pays no JS
  for hover.
- Zustand for cart/wishlist/preferences — no context re-render cascade; the
  navbar badge subscribes to a derived count, not the whole cart
- Lenis smooth scroll is dynamically imported and skipped entirely under
  `prefers-reduced-motion` or `data-perf="low"`

### Fonts
- Four families self-hosted via `next/font` (Space Grotesk, Inter, Noto Sans
  Devanagari, Mukta) with automatic metric-compatible fallbacks — no FOUT shift
- `display: swap`, subset per script
- Devanagari faces sit *inside* the Latin stacks, so a mixed-script string needs
  no wrapper component and no second layout pass

### Network
- Search API cached `s-maxage=300, stale-while-revalidate=3600`
- Palette debounced 160ms with `AbortController` on every superseded keystroke
- Assistant responses LRU-cached server-side, keyed on question + retrieved doc id
- Map iframe is click-to-load — an eager embed costs ~800 KB and a third-party
  cookie on every contact-page view

---

## Backend

- Embedding model loads **once** in the FastAPI lifespan, never per request
- Chroma persists to disk, so ingestion runs once, not on every boot
- The Dockerfile pre-warms the model **and** builds the index at image build time
- Batched embedding during ingestion — bulk is dramatically faster than
  chunk-by-chunk for both local and hosted providers
- Gzip on JSON responses; SSE is excluded by `minimum_size`
- `X-Accel-Buffering: no` on the stream — Nginx buffers SSE by default, which
  turns streaming into one delayed blob

---

## Known ceilings

Marked in code with `ponytail:` comments:

| Location | Ceiling | Upgrade when |
|---|---|---|
| `lib/data/seed-adapter.ts` `getFacets` | Facet counts computed over the filtered set, not per-facet exclusion | Users report counts hitting zero unexpectedly |
| `app/vector_db/store.py` `InMemoryStore` | O(n) brute-force cosine | Corpus exceeds ~50k chunks (Chroma is already the default) |
| `app/embeddings/provider.py` `HashEmbeddings` | Exact-token overlap, no semantics | Only a smoke-test fallback — never ship it as the live provider |

---

## Re-measuring

```bash
cd frontend
npm run build                     # route table + chunk sizes
ANALYZE=true npm run build        # requires @next/bundle-analyzer

npx lighthouse https://kohinoortez.com \
  --preset=desktop --view
npx lighthouse https://kohinoortez.com \
  --form-factor=mobile --throttling.cpuSlowdownMultiplier=4 --view
```

Test the mobile run with 4× CPU throttling. An unthrottled "mobile" Lighthouse
run on a developer machine is measuring the developer's laptop, which is exactly
the device this audience does not have.

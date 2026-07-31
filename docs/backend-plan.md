# Backend plan — what a "proper backend" actually means here

**Prices are indicative and were correct as of mid-2026. Verify every one before budgeting — SaaS pricing changes constantly.**

---

## 0. The most important decision: don't build a second backend

The instinct is "I need a backend, so I'll build one in FastAPI next to the AI service." That is the expensive path, and it is wrong for this project.

Next.js Route Handlers **are** a backend. They run server-side Node, connect to a database, hold secrets, and deploy with the frontend. For a catalogue-and-orders site, putting ecommerce there means:

- one deploy, one log stream, one auth session, one set of types shared between server and client
- no CORS, no duplicated domain models, no drift between a Python `Book` and a TypeScript `Book`
- server components query the database directly — no HTTP hop between your own code

**Keep FastAPI for exactly what it's good at: the AI.** Embeddings, vector search, RAG. That's a genuinely different runtime need (Python ML libraries, a loaded model in memory, long-lived process). It is already built.

```
Browser
  ├─→ Next.js (Vercel)          catalogue · cart · orders · auth · payments · admin
  │      └─→ Postgres (Supabase/Neon)
  │      └─→ Razorpay · Resend · Shiprocket
  └─→ FastAPI (Render)          chat · RAG · semantic search        [already built]
```

---

## 1. What is actually missing

| # | Capability | Status now | Consequence today |
|---|---|---|---|
| 1 | Product database | Seed data generated at build | Can't add/edit a book without a code deploy |
| 2 | Admin panel | None | Non-technical staff can't touch anything |
| 3 | Orders | None | Checkout produces a fake order id and forgets it |
| 4 | Payments | Stub, always succeeds | No money can be collected |
| 5 | Auth | Stub session | Accounts, order history, downloads are all façades |
| 6 | Inventory | `inStock` boolean in seed data | Can oversell |
| 7 | Notifications | None | Customer gets no confirmation; you get no alert |
| 8 | Image hosting | Referenced paths, no files | Every cover is broken |
| 9 | Shipping | None | Manual courier booking, manual tracking |
| 10 | Analytics | None | No idea what sells |

Items 1–5 are launch-blocking. 6–9 are launch-blocking *in practice* — you can run 6 and 9 manually for the first few weeks, but not 7.

---

## 2. Recommended stack

### The short version

| Concern | Choice | Why |
|---|---|---|
| Database | **Supabase Postgres** | Postgres + auth + file storage + row-level security in one product. Removes three vendors. |
| Admin | **Payload CMS** (self-hosted on the same Postgres) | Free, TypeScript-native, generates a real admin UI from your schema. No per-seat fee. |
| Payments | **Razorpay** | The default for Indian ecommerce. UPI, cards, netbanking, wallets, COD reconciliation. |
| Auth | **Supabase Auth** | Already included. Phone OTP matters — this audience trusts a mobile number more than a password. |
| Email | **Resend** | 3,000/month free, clean API, good deliverability. |
| SMS / WhatsApp | **MSG91** or **Gupshup** | Indian providers, DLT-registered, far cheaper than Twilio for domestic. |
| Images | **Cloudflare R2** + `next/image` | Zero egress fees. Covers are read constantly and written rarely — egress is the whole cost model here. |
| Shipping | **Shiprocket** | Aggregates Delhivery/DTDC/Bluedart, gives you label printing and tracking webhooks. |
| Analytics | **Vercel Analytics** or **Plausible** | Both privacy-friendly; no cookie banner needed. |

### Why not the alternatives

- **Shopify / WooCommerce** — you'd be rebuilding the thing you're replacing, and giving up the entire custom frontend. Shopify's Hydrogen is an option only if you want Shopify to own the catalogue.
- **Sanity / Strapi Cloud** — good CMSs, but per-seat or per-project pricing adds up, and neither gives you orders. Payload on your own Postgres is free and handles both.
- **Clerk for auth** — excellent, but ₹2,000+/month once you pass 10k users, and Supabase Auth is already paid for by the database.
- **Stripe** — superb API, but weaker UPI support and INR settlement is more awkward than Razorpay for a domestic-only business.

---

## 3. Database schema (the minimum)

```sql
-- Catalogue -----------------------------------------------------------------
books            id, slug, title, title_mr, series, board, class_id, medium,
                 subject, stream, price, mrp, pages, isbn, edition,
                 description, highlights[], rating, review_count,
                 in_stock, stock_qty, published_at, created_at, updated_at
book_images      id, book_id, kind(front|back|inside), url, width, height, sort
book_previews    id, book_id, url, page_no
combos           id, slug, title, title_mr, board, class_id, medium, stream,
                 price, description, highlights[], in_stock
combo_items      combo_id, book_id, sort
key_notes        id, slug, class_id, subject, medium, chapters[],
                 total_pages, related_book_id
reviews          id, book_id, author, rating, title, body, verified, created_at

-- Commerce ------------------------------------------------------------------
customers        id, phone (unique), email, name, created_at
addresses        id, customer_id, line1, line2, city, state, pincode, is_default
orders           id, order_no (KT-XXXXXX), customer_id, status, subtotal,
                 shipping_cost, total, payment_status, razorpay_order_id,
                 razorpay_payment_id, shipping_address (jsonb snapshot),
                 placed_at, updated_at
order_items      id, order_id, book_id|combo_id, title_snapshot,
                 price_snapshot, qty
shipments        id, order_id, courier, awb, status, tracking_url, shipped_at

-- Ops -----------------------------------------------------------------------
newsletter       id, email, subscribed_at, unsubscribed_at
contact_messages id, name, email, phone, topic, message, created_at, handled
```

**Two things people get wrong here.**

*Snapshot price and title onto `order_items`.* If you join to `books` at display time, changing a price next term silently rewrites last term's invoices. An order is a historical record, not a live query.

*Index on `(class_id, medium, board)`.* That is the shape of nearly every query this site makes — the class hubs, the shop facets, and the combo lookups all filter on exactly those three columns.

---

## 4. API surface

You already have `CatalogAdapter` (`lib/data/adapter.ts`). Implementing it against Postgres means server components keep calling `catalog.getBooks(...)` and nothing else changes.

These are the genuinely **new** endpoints:

### Orders & payments
```
POST /api/orders/create
  → validates cart server-side (never trust client prices),
    recomputes totals, creates a Razorpay order, returns { orderId, amount, razorpayOrderId }

POST /api/orders/verify
  → verifies Razorpay signature, marks order paid, decrements stock,
    triggers confirmation email + SMS

POST /api/webhooks/razorpay
  → the authoritative payment status. Signature-verified.
    Handles the case where the browser closes before returning.

GET  /api/orders/:orderNo?phone=…
  → guest order tracking (no login)
```

**Recompute the cart total on the server.** The single most common ecommerce vulnerability is trusting the price the browser sent. The client tells you *slugs and quantities*; the server decides what it costs.

**The webhook is the source of truth, not the browser redirect.** Users close tabs mid-payment. If you only mark orders paid on redirect, you will lose real, paid orders.

### Auth
```
POST /api/auth/otp/send        phone → OTP via MSG91
POST /api/auth/otp/verify      → session
POST /api/auth/logout
GET  /api/auth/session
```

Phone OTP over email/password, for this audience specifically. A parent buying one set of books a year will not remember a password.

### Ops
```
POST /api/newsletter           (currently a stub in newsletter-form.tsx)
POST /api/contact              (currently a stub in contact-form.tsx)
POST /api/webhooks/shiprocket  tracking status updates
GET  /api/admin/*              Payload handles this — you don't write it
```

---

## 5. Costs

### Monthly running cost

| Service | Free tier | Paid entry | Notes |
|---|---|---|---|
| Vercel | Hobby (non-commercial only) | **Pro $20/mo** | Commercial use requires Pro |
| Supabase | 500 MB DB, 1 GB storage | **Pro $25/mo** | Free tier pauses after 7 days idle — not viable for production |
| Render (AI backend) | Free tier sleeps | **Starter $7/mo** | 512 MB; enough for MiniLM embeddings |
| Cloudflare R2 | 10 GB storage | ~$0.015/GB | **Zero egress** — the reason to pick it |
| Resend | 3,000 emails/mo | $20/mo at 50k | Free tier covers early volume |
| MSG91 SMS | — | ~₹0.15–0.25/SMS | Plus one-time DLT registration (~₹5,900) |
| Payload CMS | Self-hosted, free | — | Runs on the Supabase Postgres you already pay for |
| Plausible | — | $9/mo | Or Vercel Analytics, included in Pro |
| **Total** | | **≈ $61–70/mo (₹5,200–6,000)** | Before transaction fees |

### Transaction costs

| Method | Razorpay fee | Note |
|---|---|---|
| UPI | **0%** | Regulated to zero MDR in India. Your customers will mostly use this. |
| RuPay debit | **0%** | Also zero-MDR by regulation |
| Other cards / netbanking / wallets | **~2% + GST** | |
| Settlement | T+2 days standard | T+1 available at extra cost |

On a ₹420 combo paid by UPI, your payment cost is **zero**. That matters enormously at this price point — a 2% flat fee would be ₹8.40 on a ₹60 book, which is real margin.

**One-time:** Razorpay onboarding is free (needs PAN, GST, bank account, business proof). DLT registration for SMS is ~₹5,900 one-off.

### AI running cost

With `gpt-4o-mini` and local embeddings (no per-query embedding cost), a typical exchange is ~1,200 input + 150 output tokens ≈ **₹0.02–0.03 per conversation**. The server-side LRU cache means repeated questions ("how long does delivery take") cost nothing after the first.

Even at 5,000 conversations/month that's under ₹150. The AI is not your cost problem.

### Shipping

Shiprocket: no platform fee on the entry plan; ~₹27–40 per 500g shipment depending on zone. You're already charging ₹40 below the threshold and absorbing it above, so model this against your actual parcel weights — a 7-book combo is well over 500g and will cost meaningfully more than a single guide.

### Realistic first-year total

**₹75,000–90,000/year** in infrastructure and services, before transaction fees and shipping. The dominant costs are Vercel Pro and Supabase Pro; everything else is small.

---

## 6. Build order

Do not build all of this at once. This sequence keeps a working site at every step.

**Phase A — catalogue off seed data (1–2 weeks)**
1. Provision Supabase, create the schema above
2. Import the real 325 SKUs (CSV → Postgres)
3. Write `postgresAdapter` implementing `CatalogAdapter`
4. Change one line in `lib/data/index.ts`
5. Install Payload CMS against the same database → staff can edit books

*The site is now real, still without payments.*

**Phase B — orders and payments (1–2 weeks)**
6. Razorpay account + test keys
7. `POST /api/orders/create` with server-side total recomputation
8. Razorpay Checkout in the payment step
9. `POST /api/webhooks/razorpay` — signature-verified, authoritative
10. Implement `PaymentProvider` against it; delete the stub
11. Resend confirmation email + MSG91 SMS

*You can now take money.*

**Phase C — accounts (1 week)**
12. Supabase Auth with phone OTP
13. Implement `AuthProvider`; delete the stub
14. Wire `/account/orders` and `/account/downloads` to real data

**Phase D — operations (ongoing)**
15. Shiprocket integration + tracking webhook
16. Stock decrement on paid order, low-stock alerts
17. Analytics, then GA4 ecommerce events if you want funnel data

**Before any of this:** set up 301 redirects from the old WooCommerce URLs. The existing site has ranking product pages. Losing them costs more than everything above combined, and it is the one mistake you cannot undo later.

---

## 7. What you do *not* need

- **A separate Node/Express or FastAPI ecommerce API.** Route Handlers cover it.
- **Kubernetes, Docker Compose, a VPS.** Managed services at this scale, always.
- **Redis.** Postgres handles this volume. Add caching when you measure a problem.
- **A microservice per domain.** 325 SKUs and a few hundred orders a month is one application.
- **GraphQL.** Server components query the database directly; there is no client-server API boundary to design.

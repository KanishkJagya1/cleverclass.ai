# Deployment

Frontend on Vercel, backend on Render (or AWS). They are independent — the site
works with the backend down; only the assistant degrades, and it degrades to a
phone number rather than a spinner.

---

## 1. Frontend — Vercel

### Settings
| Field | Value |
|---|---|
| Root directory | `frontend` |
| Framework | Next.js (auto-detected) |
| Build command | `npm run build` |
| Install command | `npm install` |
| Node version | 20.x or 22.x |

### Environment variables
| Key | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://kohinoortez.com` | Canonicals, OG, sitemap, JSON-LD |
| `BACKEND_URL` | `https://kohinoor-assistant.onrender.com` | Server-side only — never exposed |
| `BACKEND_API_KEY` | *(optional)* | Must match the backend's `API_KEY` |

`BACKEND_URL` is read in `next.config.ts` (rewrites) and `app/api/chat/route.ts`
(SSE proxy). Because both run server-side, the backend origin never reaches the
browser and there is no CORS preflight on any message.

### Domain
Point `kohinoortez.com` and `www` at Vercel; redirect `www` → apex (or the
reverse — just pick one, since split canonicals halve link equity).

### Deploy
```bash
npm i -g vercel
cd frontend
vercel --prod
```

### What the build produces
432 prerendered pages. `/shop` and `/class/[classId]` stay dynamic because they
read `searchParams`; everything else is SSG with 12-hour ISR — a catalogue that
changes by term does not need per-request rendering.

---

## 2. Backend — Render

### Option A: Docker (recommended)
The Dockerfile pre-warms the embedding model **and** builds the vector index at
image build time, so a cold start does not pay for either.

| Field | Value |
|---|---|
| Environment | Docker |
| Root directory | `backend` |
| Dockerfile path | `./Dockerfile` |
| Health check path | `/health` |
| Instance type | Starter (512 MB) minimum — the embedding model needs ~300 MB |

### Option B: Native Python
```
Build:  pip install -r requirements.txt
Start:  uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1
```

**One worker, always.** Each worker loads its own copy of the embedding model.
Two workers on a 512 MB instance will OOM. Scale by adding instances.

### Persistent disk
Chroma writes to `CHROMA_PATH`. Without a disk, every deploy re-ingests on first
boot (slow cold start but functionally correct). Mount a 1 GB disk at
`/app/vector_db` to avoid it.

### Environment variables
Copy from `backend/.env.example`. The minimum for a useful deployment:

```
ENVIRONMENT=production
ALLOWED_ORIGINS=["https://kohinoortez.com","https://www.kohinoortez.com"]
API_KEY=<generate a long random string>
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
VECTOR_STORE=chroma
CHROMA_PATH=/app/vector_db/chroma
```

---

## 3. AWS alternative

**ECS Fargate** — 1 vCPU / 2 GB, ALB in front, health check `/health`, EFS
mounted at `/app/vector_db` for Chroma persistence.

**App Runner** — simpler: point it at the ECR image, set `/health` as the health
check. No persistent disk, so it re-ingests on each deploy. Acceptable for a
corpus this size (seconds, not minutes).

**Lambda is a poor fit.** The embedding model makes cold starts unacceptable and
SSE streaming through API Gateway is awkward. Use a container.

---

## 4. Post-deploy verification

```bash
# Backend
curl https://<backend>/health
# → {"status":"ok","documents":<n>,...}   documents:0 means ingestion failed

curl -X POST https://<backend>/chat/sync \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"message":"How long does delivery take?","history":[]}'

# Frontend
curl -I https://kohinoortez.com
curl https://kohinoortez.com/sitemap.xml | head -20
curl https://kohinoortez.com/robots.txt
```

Then, in a browser:
- ⌘K opens the palette and returns results
- Add to cart updates the navbar badge, and the free-shipping meter crosses ₹200 correctly
- The medium switch on a product page swaps to the correct SKU
- Dark mode toggles without the glass going milky
- Mobile: bottom nav, filter sheet, no horizontal scroll at 360px
- The assistant streams, and returns an add-to-cart-able card for "which book for 12th PCM?"

---

## 5. Updating the knowledge base

Two routes, both authenticated with `X-API-Key`:

```bash
# Upload a single document
curl -X POST https://<backend>/upload \
  -H "X-API-Key: $API_KEY" -F "file=@new-policy.md"

# Re-read the whole knowledge directory after a git deploy
curl -X POST https://<backend>/reindex -H "X-API-Key: $API_KEY"
```

Chunk ids are content-addressed, so re-ingestion upserts changed chunks in place
rather than duplicating the corpus. Both routes clear the response cache.

---

## 6. CI

```yaml
name: CI
on: [push, pull_request]

jobs:
  frontend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build

  backend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      # test_rag.py runs against the in-memory store and hash embeddings, so CI
      # needs neither a model download nor an API key.
      - run: pip install pydantic pydantic-settings
      - run: python test_rag.py
```

---

## 7. Before going live

- [ ] Replace the seed catalogue with the real 325-SKU export (`lib/data/index.ts`)
- [ ] Add real cover images to `public/covers/` or point `remotePatterns` at your CDN
- [ ] Add PWA icons to `public/icons/` (192, 512, maskable-512)
- [ ] Wire a real `PaymentProvider`
- [ ] Wire a real `AuthProvider`
- [ ] Set `API_KEY` on the backend and `BACKEND_API_KEY` on Vercel
- [ ] Submit the sitemap in Google Search Console
- [ ] Set up 301s from the old WooCommerce URLs — the existing site has ranking
      product pages, and losing them is the most expensive mistake available here
- [ ] Verify the NAP in the footer, contact page and JSON-LD all match Google Business Profile exactly

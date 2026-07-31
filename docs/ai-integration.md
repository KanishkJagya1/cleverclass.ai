# AI Learning Assistant — integration guide

Not a support widget. It answers buying questions, explains the difference
between series, recommends by class and stream, and returns **add-to-cart-able
product cards** alongside its prose (D9). That is what makes it a sales channel.

---

## Request path

```
Browser
  └─ POST /api/chat                     Next.js edge route (frontend/app/api/chat/route.ts)
      └─ POST {BACKEND_URL}/chat        FastAPI (backend/app/api/routes.py)
          ├─ order-question guard       → phone handoff, retrieval never runs
          ├─ retrieve (Chroma)          → filter by min_relevance
          ├─ no matches?                → refuse, LLM never called
          ├─ build prompt               → system rules + context + 6-turn history
          └─ stream tokens (SSE)        → ("token" | "products" | "done")
```

Proxying through Next keeps everything on one origin: no CORS, no preflight per
message, and the backend URL never reaches the browser.

---

## SSE contract

The frontend parser (`features/assistant/use-assistant.ts`) expects exactly:

```
data: {"type":"token","value":"Shipping is free "}
data: {"type":"products","value":[{...ProductHit}]}
data: {"type":"done"}
```

Frames are separated by a blank line. A partial frame at the end of a network
chunk is held in a buffer until the rest arrives. Malformed frames are skipped
rather than thrown — a bad frame should degrade the answer, not kill the stream.

Products are emitted **after** the prose so cards land under a complete answer
instead of appearing mid-sentence.

---

## Grounding — the part that matters

A publisher's chatbot inventing a price, a syllabus detail or a delivery promise
creates real support cost and real distrust. Refusing is always the cheaper
failure, so there are three gates:

**1. Order questions never reach retrieval.** A regex catches "where is my
order", "track my parcel", "refund status" and returns the phone number. A
static corpus cannot answer these, and pretending otherwise wastes the
customer's time.

**2. Relevance floor.** Retrieved chunks below `MIN_RELEVANCE` (default 0.28
cosine) are discarded. If nothing survives, the LLM is **never called** — there
is no context, so there is nothing to improvise from. The user gets `REFUSAL`
with the phone number.

**3. Prompt rules.** `app/prompts/system.py` states the grounding rules before
anything else, forbids inventing titles/ISBNs/prices, and caps answers at 2–4
sentences because parents read on phones.

Verified by `test_rag.py`:
- `test_refuses_when_corpus_is_silent` — empty corpus + "capital of France" → refusal
- `test_order_questions_hand_off` — three phrasings → phone handoff
- `test_grounded_answer_uses_context` — covered question → grounded answer with sources

---

## Tuning `MIN_RELEVANCE`

The single most important number in the system.

| Symptom | Meaning | Action |
|---|---|---|
| Real questions get refused | Floor too high | Lower by 0.03 and re-check |
| Answers drift off-topic | Floor too low | Raise by 0.03 |
| Everything refuses | Corpus empty or embeddings mismatched | Check `/health` `documents` |

**Re-tune whenever you change the embedding provider.** Cosine scores are not
comparable across models — a 0.28 floor tuned for MiniLM is meaningless for
`text-embedding-3-small`.

---

## Providers

| Concern | Default | Alternatives |
|---|---|---|
| LLM | `echo` (extractive) | `openai`, `gemini` |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` | OpenAI `text-embedding-3-small` |
| Vector store | Chroma (on disk) | in-memory; FAISS/pgvector behind the same Protocol |

### Why `echo` is the default
It returns the highest-scoring sentences from retrieved context. Grounded by
construction — it cannot hallucinate, because it only repeats retrieved text.
This means the entire stack (RAG, SSE transport, chat UI, streaming, product
cards) is developable and testable **before anyone provisions an API key**, and
CI runs with no network calls.

Switch to real generation:
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

`TEMPERATURE=0.2` on purpose. This assistant states prices and shipping terms;
creativity is a defect here, not a feature.

---

## The corpus

```
backend/knowledge/
├── company.md        history, the five series, what's in a guide
├── policies.md       shipping, returns, refunds, bulk orders
├── buying-guide.md   choosing a medium, combos vs singles, streams, key notes
└── catalog.json      structured product rows for recommendations
```

**Prose and products are separate on purpose.** Answers come from the document
corpus; product cards come from structured catalogue rows. Mixing them means a
paragraph about shipping can be "retrieved" as a book.

### Updating
```bash
# Single document, at runtime
curl -X POST http://localhost:8000/upload -H "X-API-Key: $API_KEY" -F "file=@faq.md"

# Re-read the whole directory after a deploy
curl -X POST http://localhost:8000/reindex -H "X-API-Key: $API_KEY"
```
Chunk ids are content-addressed (`source::index::sha1`), so re-ingestion upserts
changed chunks in place instead of duplicating the corpus. Both routes clear the
response cache.

### Regenerating `catalog.json`
It mirrors the frontend's `SearchHit` shape. Generate it from whichever adapter
is live — seed today, a database later — so the assistant and the storefront can
never disagree about what exists.

---

## Semantic search (D8)

`GET /search?q=...` shares the same catalogue index and returns **structured
filters**, not prose:

```json
{
  "hits": [...],
  "filters": {"classId":"10","medium":"english","subject":"Science"},
  "interpreted": "Class 10 · english · Science"
}
```

The ⌘K palette calls the lexical `/api/search` first (instant, local) and only
falls back to this when lexical returns nothing. Facet parsing is a lookup table
rather than an LLM call — "class 10 marathi science" has to resolve in
single-digit milliseconds inside a palette, and a model round-trip cannot.

One subtlety worth knowing: language names are ambiguous — "marathi" is both a
medium and a subject. The parser removes the matched medium token before subject
detection, otherwise *"10th marathi maths"* resolves its subject to Marathi and
never reaches "maths". There is a regression test for exactly this.

---

## Failure behaviour

| Failure | What the user sees |
|---|---|
| Backend unreachable | "The assistant is temporarily unavailable. Please call +91 71042 99010." |
| Backend 5xx | Same, with a tappable call button |
| Mid-stream exception | Error frame injected into the stream, then `done` — the UI never hangs |
| Corpus has no answer | Explicit refusal + phone number |
| Order-specific question | Handoff to phone with a request for the order reference |

Every failure path ends at a phone number. An assistant that fails into a
spinner loses the sale; one that fails into a phone call does not.

---

## Cost

With `gpt-4o-mini`, ~700 max tokens, and local embeddings (no per-query embedding
cost), a typical exchange is roughly 1,200 input + 150 output tokens. The
server-side LRU cache is keyed on question + top retrieved document id, so the
long tail of repeated questions ("how long does delivery take") costs nothing
after the first.

To cut cost further: lower `TOP_K` (fewer context chunks), lower `MAX_TOKENS`,
or raise `CACHE_SIZE`.

---

## Extending it

The assistant currently answers from a static corpus. Natural next steps, in
order of value:

1. **Live stock and price lookup** — a tool call into the catalogue adapter, so
   "is this in stock" stops being a refusal.
2. **Order status** — remove the phone handoff once order management exists.
3. **Conversation analytics** — the 👍/👎 feedback is captured in UI state only;
   persisting it gives you a ranked list of what the assistant answers badly.
4. **Marathi responses** — the corpus is English; the model can answer in
   Marathi, but the retrieved context would need Marathi chunks to stay grounded.

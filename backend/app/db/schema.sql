-- CleverClass.AI — canonical schema.
--
-- SQLite (WAL). The workload is read-heavy with a single human writer, so
-- Postgres would cost a container and ~200 MB on a box that already runs the
-- LMS stack, and buy nothing. See docs/backend-plan.md.
--
-- Conventions:
--   * Slugs are the public identity; ids are internal and opaque.
--   * TS arrays (highlights, variants, chapters…) are stored as JSON text and
--     round-tripped by the repo layer — they are never queried by element.
--   * Timestamps are ISO-8601 UTC strings, matching what the TS types expect
--     and what JSON serialises to without a converter.
--   * Money is whole rupees, INTEGER. There are no paise anywhere in this
--     catalogue and a float would eventually print ₹284.99999.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Migration bookkeeping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  applied_at  TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS books (
  id              TEXT    PRIMARY KEY,
  slug            TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL,
  title_mr        TEXT,
  series          TEXT    NOT NULL,   -- kohinoor|spark|vidyamitra|winwings|ekatmik
  board           TEXT    NOT NULL,   -- state|cbse
  class_id        TEXT    NOT NULL,   -- nursery|5..12|board-exam
  medium          TEXT    NOT NULL,   -- marathi|semi-english|english
  subject         TEXT    NOT NULL,
  stream          TEXT,               -- science-pcm|science-pcb|science-pcbm|commerce|arts

  price           INTEGER NOT NULL,
  mrp             INTEGER,

  pages           INTEGER NOT NULL DEFAULT 0,
  isbn            TEXT,
  edition         TEXT    NOT NULL DEFAULT '',
  description     TEXT    NOT NULL DEFAULT '',
  highlights      TEXT    NOT NULL DEFAULT '[]',   -- JSON string[]

  -- Admin-authored sales copy. Indexed into cc_marketing; never book content.
  marketing_copy  TEXT    NOT NULL DEFAULT '',
  -- Admin-authored chapter/topic list. This is what the bot uses to answer
  -- "does it cover trigonometry?" without touching a single page of the book.
  chapter_list    TEXT    NOT NULL DEFAULT '[]',   -- JSON string[]

  rating          REAL    NOT NULL DEFAULT 0,
  review_count    INTEGER NOT NULL DEFAULT 0,

  in_stock        INTEGER NOT NULL DEFAULT 1,      -- 0|1
  stock_qty       INTEGER,                         -- NULL = untracked
  best_seller_rank INTEGER,

  status          TEXT    NOT NULL DEFAULT 'draft', -- draft|published|archived
  published_at    TEXT    NOT NULL DEFAULT '',

  variants        TEXT    NOT NULL DEFAULT '[]',   -- JSON slug[]
  related         TEXT    NOT NULL DEFAULT '[]',   -- JSON slug[]

  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,

  CHECK (status IN ('draft','published','archived')),
  CHECK (in_stock IN (0,1)),
  CHECK (price >= 0),
  CHECK (mrp IS NULL OR mrp >= price)
);

CREATE INDEX IF NOT EXISTS idx_books_status       ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_class_medium ON books(class_id, medium, status);
CREATE INDEX IF NOT EXISTS idx_books_subject      ON books(subject);
CREATE INDEX IF NOT EXISTS idx_books_series       ON books(series);
CREATE INDEX IF NOT EXISTS idx_books_stream       ON books(stream);
CREATE INDEX IF NOT EXISTS idx_books_price        ON books(price);
CREATE INDEX IF NOT EXISTS idx_books_bestseller   ON books(best_seller_rank)
  WHERE best_seller_rank IS NOT NULL;

-- Cover art. `kind` drives the gallery tabs; a book with no rows here renders
-- the generated <CoverImage> placeholder rather than a broken box.
CREATE TABLE IF NOT EXISTS book_images (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id   TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind      TEXT    NOT NULL,          -- front|back|inside
  src       TEXT    NOT NULL,
  alt       TEXT    NOT NULL DEFAULT '',
  width     INTEGER NOT NULL DEFAULT 600,
  height    INTEGER NOT NULL DEFAULT 800,
  blur_data_url TEXT,
  position  INTEGER NOT NULL DEFAULT 0,
  CHECK (kind IN ('front','back','inside'))
);
CREATE INDEX IF NOT EXISTS idx_book_images_book ON book_images(book_id, position);

CREATE TABLE IF NOT EXISTS combos (
  id            TEXT    PRIMARY KEY,
  slug          TEXT    NOT NULL UNIQUE,
  title         TEXT    NOT NULL,
  title_mr      TEXT,
  board         TEXT    NOT NULL DEFAULT 'state',
  class_id      TEXT    NOT NULL,
  medium        TEXT    NOT NULL,
  stream        TEXT,
  price         INTEGER NOT NULL,
  mrp           INTEGER,
  description   TEXT    NOT NULL DEFAULT '',
  highlights    TEXT    NOT NULL DEFAULT '[]',
  rating        REAL    NOT NULL DEFAULT 0,
  review_count  INTEGER NOT NULL DEFAULT 0,
  in_stock      INTEGER NOT NULL DEFAULT 1,
  status        TEXT    NOT NULL DEFAULT 'draft',
  published_at  TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  CHECK (status IN ('draft','published','archived'))
);
CREATE INDEX IF NOT EXISTS idx_combos_class ON combos(class_id, medium, status);
CREATE INDEX IF NOT EXISTS idx_combos_stream ON combos(stream);

CREATE TABLE IF NOT EXISTS combo_items (
  combo_id   TEXT    NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  book_slug  TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (combo_id, book_slug)
);

CREATE TABLE IF NOT EXISTS combo_images (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id  TEXT    NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  kind      TEXT    NOT NULL DEFAULT 'front',
  src       TEXT    NOT NULL,
  alt       TEXT    NOT NULL DEFAULT '',
  width     INTEGER NOT NULL DEFAULT 600,
  height    INTEGER NOT NULL DEFAULT 800,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_combo_images_combo ON combo_images(combo_id, position);

CREATE TABLE IF NOT EXISTS key_notes (
  id                TEXT    PRIMARY KEY,
  slug              TEXT    NOT NULL UNIQUE,
  title             TEXT    NOT NULL,
  title_mr          TEXT,
  class_id          TEXT    NOT NULL,
  subject           TEXT    NOT NULL,
  medium            TEXT    NOT NULL,
  board             TEXT    NOT NULL DEFAULT 'state',
  chapters          TEXT    NOT NULL DEFAULT '[]',  -- JSON string[]
  total_pages       INTEGER NOT NULL DEFAULT 0,
  related_book_slug TEXT,
  status            TEXT    NOT NULL DEFAULT 'draft',
  updated_at        TEXT    NOT NULL,
  CHECK (status IN ('draft','published','archived'))
);
CREATE INDEX IF NOT EXISTS idx_key_notes_class ON key_notes(class_id, subject, status);

CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT    PRIMARY KEY,
  product_slug  TEXT    NOT NULL,
  author        TEXT    NOT NULL,
  rating        INTEGER NOT NULL,
  title         TEXT    NOT NULL DEFAULT '',
  body          TEXT    NOT NULL DEFAULT '',
  date          TEXT    NOT NULL,
  verified      INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'published',
  CHECK (rating BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_slug, status);

-- ---------------------------------------------------------------------------
-- Full-text search over books (FTS5, external content)
--
-- Every column named here must exist on `books` — that is what `content=`
-- requires. Kept in sync by the three triggers below rather than by
-- application code, so a direct sqlite3 UPDATE can never desync the index.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  title, title_mr, subject, series, description, highlights, chapter_list,
  content='books',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS books_fts_ai AFTER INSERT ON books BEGIN
  INSERT INTO books_fts(rowid, title, title_mr, subject, series, description, highlights, chapter_list)
  VALUES (new.rowid, new.title, new.title_mr, new.subject, new.series, new.description, new.highlights, new.chapter_list);
END;

CREATE TRIGGER IF NOT EXISTS books_fts_ad AFTER DELETE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, title_mr, subject, series, description, highlights, chapter_list)
  VALUES ('delete', old.rowid, old.title, old.title_mr, old.subject, old.series, old.description, old.highlights, old.chapter_list);
END;

CREATE TRIGGER IF NOT EXISTS books_fts_au AFTER UPDATE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, title_mr, subject, series, description, highlights, chapter_list)
  VALUES ('delete', old.rowid, old.title, old.title_mr, old.subject, old.series, old.description, old.highlights, old.chapter_list);
  INSERT INTO books_fts(rowid, title, title_mr, subject, series, description, highlights, chapter_list)
  VALUES (new.rowid, new.title, new.title_mr, new.subject, new.series, new.description, new.highlights, new.chapter_list);
END;

-- ---------------------------------------------------------------------------
-- PDF assets, page text, and free-page ranges
--
-- This is the core of the "print sample" feature. `book_pages.is_free` is the
-- single gate that decides what the preview API will serve and what the RAG
-- corpus is allowed to contain.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS book_assets (
  id            TEXT    PRIMARY KEY,
  book_id       TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  sha256        TEXT    NOT NULL,
  original_name TEXT    NOT NULL DEFAULT '',
  byte_size     INTEGER NOT NULL DEFAULT 0,
  page_count    INTEGER NOT NULL DEFAULT 0,
  storage_path  TEXT    NOT NULL,          -- relative to MEDIA_ROOT
  is_current    INTEGER NOT NULL DEFAULT 1,
  process_state TEXT    NOT NULL DEFAULT 'pending', -- pending|processing|ready|failed
  process_error TEXT,
  pages_done    INTEGER NOT NULL DEFAULT 0, -- drives the admin progress bar
  outline       TEXT    NOT NULL DEFAULT '[]', -- JSON PDF bookmarks, for "first chapter"
  uploaded_by   TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  CHECK (process_state IN ('pending','processing','ready','failed')),
  CHECK (is_current IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_assets_book ON book_assets(book_id, is_current);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_book_sha ON book_assets(book_id, sha256);

-- Text for EVERY page is stored, free or locked. Storing only free pages would
-- mean re-parsing the whole PDF each time an admin edits the range.
-- `is_free` is denormalised from free_page_ranges inside one transaction.
CREATE TABLE IF NOT EXISTS book_pages (
  asset_id    TEXT    NOT NULL REFERENCES book_assets(id) ON DELETE CASCADE,
  page_no     INTEGER NOT NULL,
  text        TEXT    NOT NULL DEFAULT '',
  char_count  INTEGER NOT NULL DEFAULT 0,
  text_sha1   TEXT    NOT NULL DEFAULT '',
  is_free     INTEGER NOT NULL DEFAULT 0,
  render_path TEXT,
  rendered_at TEXT,
  PRIMARY KEY (asset_id, page_no),
  CHECK (is_free IN (0,1)),
  CHECK (page_no >= 1)
);
CREATE INDEX IF NOT EXISTS idx_pages_free ON book_pages(asset_id, is_free);

CREATE TABLE IF NOT EXISTS free_page_ranges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  start_page INTEGER NOT NULL,
  end_page   INTEGER NOT NULL,
  CHECK (start_page >= 1),
  CHECK (end_page >= start_page)
);
-- The hot path: "is page N free for this book?" — one indexed lookup.
CREATE INDEX IF NOT EXISTS idx_free_ranges_lookup
  ON free_page_ranges(book_id, start_page, end_page);

CREATE TABLE IF NOT EXISTS free_range_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  old_spec   TEXT    NOT NULL DEFAULT '',
  new_spec   TEXT    NOT NULL DEFAULT '',
  changed_by TEXT,
  changed_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_free_history_book ON free_range_history(book_id, changed_at);

-- What is currently embedded, per collection. This is what turns a re-index
-- into a delta instead of a full rebuild, and it is how newly-locked pages get
-- DELETED from the vector store rather than lingering forever.
CREATE TABLE IF NOT EXISTS corpus_docs (
  doc_id      TEXT    NOT NULL,
  collection  TEXT    NOT NULL,
  book_id     TEXT,
  source_sha  TEXT    NOT NULL,
  page_no     INTEGER,
  indexed_at  TEXT    NOT NULL,
  PRIMARY KEY (collection, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_corpus_book ON corpus_docs(book_id, collection);

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT    PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'admin',   -- admin|editor
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL,
  CHECK (role IN ('admin','editor'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id            TEXT    PRIMARY KEY,          -- sha256 of the cookie value
  user_id       TEXT    NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token    TEXT    NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  action     TEXT    NOT NULL,          -- book.create, book.free_ranges.update, …
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT    NOT NULL DEFAULT '{}',  -- JSON
  ip         TEXT,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON admin_audit(entity, entity_id);

-- ---------------------------------------------------------------------------
-- Orders (no payment gateway yet — these are confirmed-by-phone requests)
--
-- Totals are ALWAYS recomputed server-side from `books.price` at insert time.
-- The client's numbers are never trusted, and `unit_price` is snapshotted so a
-- later price change does not rewrite history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT    PRIMARY KEY,
  order_number   TEXT    NOT NULL UNIQUE,   -- CC-XXXXXX
  status         TEXT    NOT NULL DEFAULT 'requested',
                 -- requested|confirmed|packed|shipped|delivered|cancelled
  customer_name  TEXT    NOT NULL,
  phone          TEXT    NOT NULL,
  email          TEXT,
  address_line1  TEXT    NOT NULL DEFAULT '',
  address_line2  TEXT    NOT NULL DEFAULT '',
  city           TEXT    NOT NULL DEFAULT '',
  state          TEXT    NOT NULL DEFAULT '',
  pincode        TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',

  subtotal       INTEGER NOT NULL DEFAULT 0,
  shipping       INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,

  source         TEXT    NOT NULL DEFAULT 'checkout', -- checkout|single|assistant
  payment_status TEXT    NOT NULL DEFAULT 'unpaid',   -- unpaid|paid|refunded
  payment_ref    TEXT,                                -- Razorpay id, later

  ip             TEXT,
  user_agent     TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  CHECK (status IN ('requested','confirmed','packed','shipped','delivered','cancelled')),
  CHECK (payment_status IN ('unpaid','paid','refunded'))
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_phone   ON orders(phone);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  format      TEXT    NOT NULL DEFAULT 'book',   -- book|combo|key-note
  title       TEXT    NOT NULL,
  class_id    TEXT    NOT NULL DEFAULT '',
  medium      TEXT    NOT NULL DEFAULT '',
  unit_price  INTEGER NOT NULL,                  -- snapshot at order time
  qty         INTEGER NOT NULL DEFAULT 1,
  line_total  INTEGER NOT NULL,
  CHECK (qty >= 1)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status  TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  actor      TEXT,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);

-- Contact form + newsletter. These exist so the forms stop faking success.
CREATE TABLE IF NOT EXISTS leads (
  id         TEXT    PRIMARY KEY,
  kind       TEXT    NOT NULL,          -- contact|newsletter|callback
  name       TEXT    NOT NULL DEFAULT '',
  email      TEXT    NOT NULL DEFAULT '',
  phone      TEXT    NOT NULL DEFAULT '',
  topic      TEXT    NOT NULL DEFAULT '',
  message    TEXT    NOT NULL DEFAULT '',
  handled    INTEGER NOT NULL DEFAULT 0,
  ip         TEXT,
  created_at TEXT    NOT NULL,
  CHECK (kind IN ('contact','newsletter','callback'))
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(kind, handled, created_at);

-- ---------------------------------------------------------------------------
-- Chat metrics (shape borrowed from lms-tutor/tutor/metrics.py, which is
-- proven on this box, plus the sales-specific columns)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            REAL    NOT NULL,
  day           TEXT    NOT NULL,
  month         TEXT    NOT NULL,
  ip            TEXT,
  client_id     TEXT,
  intent        TEXT,
  status        TEXT,     -- answered|refused|teaching_pivot|price_hallucination|error
  message       TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  llm_calls     INTEGER NOT NULL DEFAULT 0,
  model         TEXT,
  cost          REAL    NOT NULL DEFAULT 0,
  n_passages    INTEGER NOT NULL DEFAULT 0,
  collections   TEXT,     -- JSON: which collections were queried
  products      TEXT,     -- JSON: slugs surfaced
  preview_shown INTEGER NOT NULL DEFAULT 0,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_ts     ON chat_log(ts);
CREATE INDEX IF NOT EXISTS idx_chat_day    ON chat_log(day);
CREATE INDEX IF NOT EXISTS idx_chat_intent ON chat_log(intent, day);

-- ---------------------------------------------------------------------------
-- Runtime settings the owner can change without a redeploy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings_kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

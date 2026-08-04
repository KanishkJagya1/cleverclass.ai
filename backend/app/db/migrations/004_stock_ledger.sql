-- Append-only stock ledger.
--
-- `books.stock_qty` alone cannot answer the questions a shop actually asks:
-- "why is this 3 when we received 20?", "did that cancelled order put the copy
-- back?", "who set this to 0 last Tuesday?". A single mutable integer has no
-- answer to any of them, and a lost update between two concurrent order
-- confirmations is invisible forever.
--
-- So movements are the truth and the quantity is their SUM. `books.stock_qty`
-- survives as a DENORMALISED CACHE, rewritten inside the same transaction as
-- the movement, because the catalogue lists 24 books per page and summing a
-- ledger per row per request is not a trade worth making.
-- `inventory.reconcile()` rebuilds the cache from the ledger and is the
-- authority if they ever disagree.
--
-- NULL stock_qty means UNTRACKED and that convention is preserved: all 324
-- existing books are untracked today, and forcing them to a tracked zero would
-- take the entire catalogue out of stock the moment this migration ran.

CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE,

  -- Signed. Negative removes stock, positive adds it. Never zero: a movement
  -- that changes nothing is noise in an audit trail.
  delta       INTEGER NOT NULL,

  -- Balance immediately AFTER this movement, recorded at write time. Redundant
  -- with SUM(delta), and deliberately so — it makes "what did we think the
  -- stock was at 14:32" answerable without replaying the whole ledger, and it
  -- is how a corrupted cache gets spotted.
  balance     INTEGER NOT NULL,

  reason      TEXT    NOT NULL,
              -- opening|received|sold|cancelled|returned|damaged|correction|recount
  reference   TEXT,   -- order number, invoice, supplier note
  note        TEXT    NOT NULL DEFAULT '',

  -- Who. NULL means the system did it (an order confirmation, say) rather than
  -- a person.
  actor_id    TEXT,
  created_at  TEXT    NOT NULL,

  CHECK (delta <> 0),
  CHECK (balance >= 0),
  CHECK (reason IN ('opening','received','sold','cancelled','returned',
                    'damaged','correction','recount'))
);

CREATE INDEX IF NOT EXISTS idx_stock_book ON stock_movements(book_id, id);
CREATE INDEX IF NOT EXISTS idx_stock_created ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_reference ON stock_movements(reference);

-- The point below which the low-stock alert fires. Per book, because a fast
-- mover and a slow one do not share a sensible threshold.
ALTER TABLE books ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 5;

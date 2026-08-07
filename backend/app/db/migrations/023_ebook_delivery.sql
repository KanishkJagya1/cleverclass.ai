-- E-book delivery: who may download what, and every time they did.
--
-- Entitlement is DERIVED, not stored. A row saying "this customer owns this
-- book" would be a second source of truth beside the order, and the two would
-- drift the first time an order was refunded or cancelled — leaving someone
-- with a permanent download of a book they were refunded for. The order is the
-- truth; `ebook.entitlements()` reads it.
--
-- What IS stored is the log. It exists for two reasons that a derived view
-- cannot serve:
--   * a cap on downloads per purchase, so a link cannot be handed round as an
--     unlimited mirror;
--   * evidence. Every delivered copy is watermarked with the buyer, so if one
--     appears on a sharing site, this table says whose copy it was and when
--     they took it.

CREATE TABLE IF NOT EXISTS ebook_downloads (
  id           TEXT    PRIMARY KEY,
  order_id     TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_number TEXT    NOT NULL,
  slug         TEXT    NOT NULL,
  customer_id  TEXT,
  -- Recorded because "it wasn't me" is the first thing said about a leak, and
  -- an IP plus a timestamp is the only thing that can answer it.
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ebook_downloads_order
  ON ebook_downloads(order_number, slug);

CREATE INDEX IF NOT EXISTS idx_ebook_downloads_customer
  ON ebook_downloads(customer_id, created_at DESC);

-- Reviews: provenance, verified purchase, moderation.
--
-- The existing table has a `verified` flag but NO link to a customer or an
-- order, so "verified purchase" was unenforceable — the column could only ever
-- have been set by hand. These columns are what make it a fact rather than a
-- claim.
--
-- ⚠ THE 1,106 SEEDED REVIEWS ARE FABRICATED and are currently shown to visitors
-- as genuine. Keeping them visible is a deliberate, temporary decision (they
-- make the catalogue look populated during development). `source` is what keeps
-- that decision reversible: every existing row is tagged 'seed' here, so
-- hiding them later is one UPDATE rather than an archaeological dig through
-- 1,106 rows trying to work out which were real.

ALTER TABLE reviews ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE reviews ADD COLUMN order_id    TEXT REFERENCES orders(id);
ALTER TABLE reviews ADD COLUMN source      TEXT NOT NULL DEFAULT 'customer';
                                           -- customer|seed|import
ALTER TABLE reviews ADD COLUMN admin_reply TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN replied_at  TEXT;
ALTER TABLE reviews ADD COLUMN created_at  TEXT;

-- Tag everything that exists today. Anything written from here on defaults to
-- 'customer', so the two can never be confused again.
UPDATE reviews SET source = 'seed' WHERE source = 'customer';

CREATE INDEX IF NOT EXISTS idx_reviews_slug   ON reviews(product_slug, status);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_source ON reviews(source);
-- One review per customer per product. A UNIQUE index rather than an
-- application check: the check loses to two concurrent submits, the index
-- cannot. Partial, so the 1,106 seeded rows (customer_id NULL) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_customer
  ON reviews(product_slug, customer_id) WHERE customer_id IS NOT NULL;

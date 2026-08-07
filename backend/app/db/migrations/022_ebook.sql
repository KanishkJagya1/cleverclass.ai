-- E-book support: a title can be sold as a printed copy, a download, or both,
-- each priced on its own.
--
-- WHY A SEPARATE `delivery` COLUMN, not more values in `format`.
-- `format` already means the KIND of product — book, combo, key-note — and a
-- combo can perfectly well be sold as a download too. Folding "is it printed
-- or digital" into the same column would make those two questions inseparable
-- and every query that asks one would accidentally answer the other.
--
-- The two dimensions are orthogonal, so they get two columns:
--     format   = what it is        (book | combo | key-note)
--     delivery = how it arrives    (physical | digital)
--
-- CONSEQUENCES worth stating, because they are easy to miss and expensive:
--   * Stock applies to `physical` lines ONLY. A download cannot sell out, and
--     deducting inventory for one would slowly zero a book that never shipped.
--   * Shipping is charged on physical lines ONLY. An all-digital order that
--     attracts a delivery fee is a support ticket every single time.
--   * A cart may hold BOTH deliveries of the same title, so `delivery` joins
--     the uniqueness key — otherwise adding the e-book silently replaces the
--     printed copy already in the basket.

ALTER TABLE books ADD COLUMN ebook_price INTEGER;
-- Defaults chosen so every existing row keeps behaving exactly as it does
-- today: printed, no download.
ALTER TABLE books ADD COLUMN ebook_available INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN physical_available INTEGER NOT NULL DEFAULT 1;

ALTER TABLE cart_items ADD COLUMN delivery TEXT NOT NULL DEFAULT 'physical';
ALTER TABLE order_items ADD COLUMN delivery TEXT NOT NULL DEFAULT 'physical';

-- Replaces the (customer, slug, format) uniqueness from migration 015. SQLite
-- cannot alter an index, so the old one is dropped and rebuilt with delivery
-- included.
DROP INDEX IF EXISTS idx_cart_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_unique
  ON cart_items(customer_id, slug, format, delivery);

CREATE INDEX IF NOT EXISTS idx_books_ebook
  ON books(ebook_available, status, deleted_at);

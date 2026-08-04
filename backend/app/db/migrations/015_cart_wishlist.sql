-- Server-side cart and wishlist.
--
-- Both live in browser localStorage today (zustand), which means a customer who
-- fills a basket on their phone and opens the laptop finds it empty, and
-- clearing site data throws away a considered purchase. Persisting them is also
-- what makes an abandoned-cart reminder possible at all.
--
-- ⚠ QUANTITIES ARE STORED; PRICES ARE NOT. The line price is always re-read
-- from `books` when the cart is loaded. Storing a price here would create a
-- second source of truth that silently goes stale, and "the cart said ₹250" is
-- an argument no shop wants to have — `orders.create_order` already re-prices
-- from the database for exactly this reason.

CREATE TABLE IF NOT EXISTS cart_items (
  id          TEXT    PRIMARY KEY,
  customer_id TEXT    NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  -- book|combo, matching the order item vocabulary.
  format      TEXT    NOT NULL DEFAULT 'book',
  qty         INTEGER NOT NULL DEFAULT 1,
  added_at    TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  CHECK (qty >= 1)
);

-- One row per product per customer. A UNIQUE index rather than "check then
-- insert": two tabs adding the same book at once would otherwise create two
-- rows and the customer sees the title twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_unique
  ON cart_items(customer_id, slug, format);
CREATE INDEX IF NOT EXISTS idx_cart_customer ON cart_items(customer_id);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id          TEXT    PRIMARY KEY,
  customer_id TEXT    NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  added_at    TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_unique
  ON wishlist_items(customer_id, slug);
CREATE INDEX IF NOT EXISTS idx_wishlist_customer ON wishlist_items(customer_id);

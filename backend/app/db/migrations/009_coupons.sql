-- Coupons and redemptions.
--
-- Discounts are the one place where a client-trusted number becomes free money,
-- so the shape here is built for server-side recomputation: a coupon is stored
-- as RULES, never as an amount. The amount is derived from the cart every time
-- it is asked for, including once more at order creation.

CREATE TABLE IF NOT EXISTS coupons (
  id              TEXT    PRIMARY KEY,
  -- Stored upper-case; matched case-insensitively. People type "save10" on a
  -- phone keyboard and "SAVE10" on a laptop and mean the same coupon.
  code            TEXT    NOT NULL UNIQUE,
  description     TEXT    NOT NULL DEFAULT '',

  kind            TEXT    NOT NULL,   -- percent|flat|free_shipping|bxgy
  -- percent: 10 = 10%.  flat: 50 = ₹50 off.  bxgy: buy `buy_qty` get
  -- `get_qty` free (cheapest qualifying lines are the free ones).
  value           INTEGER NOT NULL DEFAULT 0,
  buy_qty         INTEGER NOT NULL DEFAULT 0,
  get_qty         INTEGER NOT NULL DEFAULT 0,

  -- Caps. `max_discount` is what stops "20% off" costing ₹4,000 on a bulk
  -- school order that nobody anticipated.
  min_cart        INTEGER NOT NULL DEFAULT 0,
  max_discount    INTEGER,

  starts_at       TEXT,
  ends_at         TEXT,

  -- Usage limits. NULL means unlimited; 0 would mean "unusable", and the
  -- difference matters.
  usage_limit     INTEGER,
  per_user_limit  INTEGER NOT NULL DEFAULT 1,
  used_count      INTEGER NOT NULL DEFAULT 0,

  -- Scoping. Empty means "everything". JSON arrays rather than join tables:
  -- these lists are short, read on every cart, and never queried across.
  product_slugs   TEXT    NOT NULL DEFAULT '[]',
  class_ids       TEXT    NOT NULL DEFAULT '[]',
  series          TEXT    NOT NULL DEFAULT '[]',

  first_order_only INTEGER NOT NULL DEFAULT 0,
  -- Applied without the customer typing anything, when it qualifies.
  auto_apply      INTEGER NOT NULL DEFAULT 0,

  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL,
  created_by      TEXT,

  CHECK (kind IN ('percent','flat','free_shipping','bxgy')),
  CHECK (value >= 0),
  CHECK (min_cart >= 0),
  CHECK (per_user_limit >= 0)
);

CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active, auto_apply);

-- One row per successful use. This is what enforces the caps, and what a
-- redemption report is built from.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id   TEXT    NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id    TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id TEXT    REFERENCES customers(id),
  -- Guest checkout has no customer_id, so the phone number is the fallback
  -- identity for per-user limits. Imperfect, and better than no limit at all.
  phone       TEXT    NOT NULL DEFAULT '',
  amount      INTEGER NOT NULL,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_redemptions_coupon   ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_customer ON coupon_redemptions(coupon_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_phone    ON coupon_redemptions(coupon_id, phone);
-- A coupon can be counted against an order exactly once. An application check
-- loses to a double-submitted checkout; a unique index does not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_redemptions_once
  ON coupon_redemptions(coupon_id, order_id);

-- Which coupon an order used, and what it saved. Denormalised onto the order
-- because an invoice must show the discount that was actually applied, even if
-- the coupon is later edited or deleted.
ALTER TABLE orders ADD COLUMN coupon_code     TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN discount        INTEGER NOT NULL DEFAULT 0;

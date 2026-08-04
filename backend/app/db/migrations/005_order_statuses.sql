-- Widen the order status enum to cover the real lifecycle.
--
-- Same CHECK-constraint rebuild as migration 003, and the stakes are higher
-- here: `order_items` and `order_events` both reference `orders` with
-- ON DELETE CASCADE, and SQLite implements DROP TABLE as "delete every row,
-- then drop". With foreign keys enforced this migration would silently destroy
-- every line item and every timeline entry in the shop's order history — an
-- unrecoverable data loss that leaves the orders table itself looking fine.
--
-- Hence the pragma. It is honoured because the migration runner uses
-- executescript(), which commits on its own rather than running inside our
-- transaction.
PRAGMA foreign_keys = OFF;

CREATE TABLE orders_new (
  id             TEXT    PRIMARY KEY,
  order_number   TEXT    NOT NULL UNIQUE,
  status         TEXT    NOT NULL DEFAULT 'requested',
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

  source         TEXT    NOT NULL DEFAULT 'checkout',
  payment_status TEXT    NOT NULL DEFAULT 'unpaid',
  payment_ref    TEXT,

  ip             TEXT,
  user_agent     TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  customer_id    TEXT    REFERENCES customers(id),

  -- Set when stock was deducted for this order, so a second confirmation
  -- cannot deduct twice and a cancellation knows whether there is anything to
  -- give back. Without it, "confirm, cancel, confirm" quietly loses inventory.
  stock_applied_at TEXT,

  CHECK (status IN (
    'requested',          -- placed, nothing agreed yet
    'pending_payment',    -- awaiting the customer's transfer/proof
    'confirmed',          -- payment accepted, stock deducted
    'processing',         -- being picked
    'packed',
    'shipped',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'refund_requested',
    'refund_approved',
    'refund_rejected',
    'returned'
  )),
  CHECK (payment_status IN ('unpaid','paid','refunded'))
);

INSERT INTO orders_new
  (id, order_number, status, customer_name, phone, email, address_line1,
   address_line2, city, state, pincode, notes, subtotal, shipping, total,
   source, payment_status, payment_ref, ip, user_agent, created_at, updated_at,
   customer_id)
SELECT
   id, order_number, status, customer_name, phone, email, address_line1,
   address_line2, city, state, pincode, notes, subtotal, shipping, total,
   source, payment_status, payment_ref, ip, user_agent, created_at, updated_at,
   customer_id
  FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_phone    ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at);

PRAGMA foreign_keys = ON;

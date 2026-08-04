-- Multiple delivery addresses per customer.
--
-- Until now a customer had exactly one address, held as five columns on
-- `customers`. That is wrong for the actual use case here: a parent buys for
-- home and for a boarding school, and a student orders to a hostel in term
-- time and home in the holidays. One address means retyping the other one
-- every single order.
--
-- The columns on `customers` are kept and become the DEFAULT address mirror,
-- so nothing that reads them breaks. `addresses` is the truth.

CREATE TABLE IF NOT EXISTS addresses (
  id           TEXT    PRIMARY KEY,
  customer_id  TEXT    NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- What the customer calls it: "Home", "School", "Hostel".
  label        TEXT    NOT NULL DEFAULT 'Home',
  -- Recipient can differ from the account holder — a parent ordering to a
  -- child's hostel needs the child's name on the parcel.
  name         TEXT    NOT NULL DEFAULT '',
  phone        TEXT    NOT NULL DEFAULT '',

  line1        TEXT    NOT NULL,
  line2        TEXT    NOT NULL DEFAULT '',
  city         TEXT    NOT NULL,
  state        TEXT    NOT NULL DEFAULT '',
  pincode      TEXT    NOT NULL,

  is_default   INTEGER NOT NULL DEFAULT 0,
  -- Soft delete: an address referenced by a past order must stay readable, so
  -- deleting one hides it from the picker rather than removing the row.
  deleted_at   TEXT,

  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_addresses_customer
  ON addresses(customer_id, deleted_at);
-- At most one default per customer, enforced by the database rather than by
-- application care. Two "default" addresses is a silent bug that shows up as
-- an order shipped to the wrong place.
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_default
  ON addresses(customer_id) WHERE is_default = 1 AND deleted_at IS NULL;

-- Which address an order was shipped to. Nullable, because guest orders have
-- no saved address and every order placed before today has none either.
ALTER TABLE orders ADD COLUMN address_id TEXT REFERENCES addresses(id);

-- Migrate the single address every existing customer already has, so nobody
-- has to retype what they already gave us.
INSERT INTO addresses
  (id, customer_id, label, name, phone, line1, line2, city, state, pincode,
   is_default, created_at, updated_at)
SELECT
  'adr_' || substr(hex(randomblob(8)), 1, 16),
  id, 'Home', name, phone,
  address_line1, address_line2, city, state, pincode,
  1, created_at, updated_at
FROM customers
WHERE TRIM(COALESCE(address_line1, '')) <> ''
  AND TRIM(COALESCE(pincode, '')) <> '';

-- Manual payment verification, shaped so a real gateway replaces it cleanly.
--
-- The columns are deliberately gateway-shaped rather than
-- bank-transfer-shaped: `provider`, `provider_ref` and `amount` are what
-- Razorpay or Stripe would fill in, and the manual flow simply writes
-- 'manual' and a UTR into the same slots. That is what makes the later swap a
-- new PaymentProvider implementation instead of a schema migration on a table
-- full of live financial records.

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT    PRIMARY KEY,
  order_id      TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  provider      TEXT    NOT NULL DEFAULT 'manual',   -- manual|razorpay|stripe
  method        TEXT    NOT NULL DEFAULT 'upi',      -- upi|bank_transfer|cash|card
  -- UTR / transaction reference the customer quotes, or the gateway's id.
  provider_ref  TEXT,

  -- Stored in whole rupees, like every other money column here. Never a float:
  -- binary floating point cannot represent 0.1, and money that does not add up
  -- is the one bug a shop cannot be talked out of.
  amount        INTEGER NOT NULL,

  status        TEXT    NOT NULL DEFAULT 'awaiting',
                -- awaiting|submitted|approved|rejected|correction_requested

  -- Proof of payment. A path under MEDIA_ROOT, never inside a web root — the
  -- same rule the book PDFs follow. Served only through an authorised endpoint.
  proof_path    TEXT,
  proof_sha256  TEXT,

  -- Who reviewed it, and what they said. `reviewer_note` is shown to the
  -- customer on a rejection, so they know what to fix.
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  reviewer_note TEXT    NOT NULL DEFAULT '',

  customer_note TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,

  CHECK (amount >= 0),
  CHECK (status IN ('awaiting','submitted','approved','rejected',
                    'correction_requested')),
  CHECK (provider IN ('manual','razorpay','stripe'))
);

CREATE INDEX IF NOT EXISTS idx_payments_order  ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);
-- The admin verification queue reads this constantly.
CREATE INDEX IF NOT EXISTS idx_payments_queue  ON payments(status, updated_at)
  WHERE status IN ('submitted','correction_requested');

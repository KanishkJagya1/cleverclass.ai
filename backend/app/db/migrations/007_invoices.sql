-- Invoices, with the GST fields an Indian bookshop actually needs.
--
-- ⚠ PRINTED BOOKS ARE GST-EXEMPT IN INDIA. Printed books, brochures and
-- newspapers under HSN 4901/4902 are nil-rated. So `gst_rate` defaults to 0 and
-- the invoice will normally show no tax at all. It is a per-book column rather
-- than a constant because this catalogue also sells things that are NOT exempt
-- if the shop expands — stationery, kits, digital downloads — and discovering
-- that after issuing a year of invoices is a tax problem, not a code problem.
-- Anything non-exempt gets its own rate on its own row.

ALTER TABLE books ADD COLUMN hsn_code TEXT NOT NULL DEFAULT '4901';
ALTER TABLE books ADD COLUMN gst_rate INTEGER NOT NULL DEFAULT 0;  -- percent

CREATE TABLE IF NOT EXISTS invoices (
  id             TEXT    PRIMARY KEY,
  order_id       TEXT    NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,

  -- CC/2026-27/0001. Sequential and GAPLESS within a financial year, because a
  -- missing number in an invoice series is something an auditor asks about.
  invoice_number TEXT    NOT NULL UNIQUE,
  financial_year TEXT    NOT NULL,          -- "2026-27"
  sequence       INTEGER NOT NULL,

  -- Everything below is a SNAPSHOT taken at issue time, deliberately
  -- denormalised. An invoice is a legal record of what was charged on a date;
  -- if it re-read today's prices, addresses or tax rates it would silently
  -- rewrite history every time someone opened it.
  seller_name    TEXT    NOT NULL,
  seller_gstin   TEXT    NOT NULL DEFAULT '',
  seller_state   TEXT    NOT NULL DEFAULT '',
  buyer_name     TEXT    NOT NULL,
  buyer_address  TEXT    NOT NULL DEFAULT '',
  buyer_state    TEXT    NOT NULL DEFAULT '',
  buyer_gstin    TEXT    NOT NULL DEFAULT '',

  subtotal       INTEGER NOT NULL DEFAULT 0,   -- taxable value
  cgst           INTEGER NOT NULL DEFAULT 0,
  sgst           INTEGER NOT NULL DEFAULT 0,
  igst           INTEGER NOT NULL DEFAULT 0,
  shipping       INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,

  -- Line detail as JSON: qty, rate, HSN and tax per line, frozen at issue.
  lines_json     TEXT    NOT NULL DEFAULT '[]',

  issued_at      TEXT    NOT NULL,
  issued_by      TEXT,
  -- Invoices are never deleted. A cancelled order gets a credit note, so the
  -- series stays unbroken.
  cancelled_at   TEXT,
  cancel_reason  TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_year  ON invoices(financial_year, sequence);

-- One row per financial year, holding the last number issued. A dedicated
-- counter rather than MAX(sequence)+1: under two concurrent issues the MAX
-- approach hands the same number to both, and a duplicate invoice number is
-- exactly the thing that must never happen.
CREATE TABLE IF NOT EXISTS invoice_counters (
  financial_year TEXT    PRIMARY KEY,
  last_sequence  INTEGER NOT NULL DEFAULT 0
);

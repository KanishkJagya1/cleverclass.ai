-- Shipments, carriers and zones.
--
-- Manual AWB entry by decision: real carrier APIs need a business contract per
-- carrier or an aggregator account, and neither exists yet. What this buys with
-- zero credentials is the thing customers actually want — a tracking number and
-- a working link to the carrier's own tracking page.
--
-- `carriers` is a table rather than a constant so the shop can add whoever it
-- starts using next without a deploy.

CREATE TABLE IF NOT EXISTS carriers (
  code          TEXT    PRIMARY KEY,     -- delhivery, bluedart, …
  name          TEXT    NOT NULL,
  -- `{awb}` is substituted at render time. Stored as a template because every
  -- carrier's tracking URL has a different shape and they change them.
  tracking_url  TEXT    NOT NULL DEFAULT '',
  phone         TEXT    NOT NULL DEFAULT '',
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS shipments (
  id            TEXT    PRIMARY KEY,
  order_id      TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier_code  TEXT    NOT NULL,
  awb           TEXT    NOT NULL,

  status        TEXT    NOT NULL DEFAULT 'ready',
                -- ready|dispatched|in_transit|out_for_delivery|delivered
                -- |failed|returned
  -- Free text from the carrier's own tracking page, pasted by staff. Useful
  -- and explicitly NOT parsed — nothing depends on its shape.
  last_update   TEXT    NOT NULL DEFAULT '',

  -- What the customer is told to expect. A date, not a promise: it is set from
  -- the zone's estimate and adjusted by hand.
  expected_at   TEXT,
  dispatched_at TEXT,
  delivered_at  TEXT,

  weight_grams  INTEGER,
  charge        INTEGER NOT NULL DEFAULT 0,
  notes         TEXT    NOT NULL DEFAULT '',

  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  created_by    TEXT,

  CHECK (status IN ('ready','dispatched','in_transit','out_for_delivery',
                    'delivered','failed','returned'))
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_awb   ON shipments(awb);
-- One AWB per carrier. The same number from two carriers is possible; the same
-- number twice from one carrier is a typo, and catching it here beats
-- discovering it when two customers track the same parcel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_carrier_awb
  ON shipments(carrier_code, awb);

-- Shipping zones by PIN prefix. Deliberately prefix-based rather than a full
-- pincode table: India has ~19,000 pincodes and this shop needs "local,
-- Maharashtra, rest of India", which the first 1-3 digits answer.
CREATE TABLE IF NOT EXISTS shipping_zones (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  -- JSON array of prefixes, longest match wins: ["440","441"] or ["4"].
  pin_prefixes  TEXT    NOT NULL DEFAULT '[]',
  rate          INTEGER NOT NULL DEFAULT 0,
  free_above    INTEGER,                 -- NULL = never free in this zone
  days_min      INTEGER NOT NULL DEFAULT 3,
  days_max      INTEGER NOT NULL DEFAULT 7,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 100
);

-- The carriers this shop is most likely to meet. Tracking URLs are the public
-- consumer pages, so they work without any account.
INSERT OR IGNORE INTO carriers (code, name, tracking_url, sort_order) VALUES
  ('delhivery',  'Delhivery',   'https://www.delhivery.com/track/package/{awb}', 10),
  ('bluedart',   'Blue Dart',   'https://www.bluedart.com/tracking?trackFor=0&trackNo={awb}', 20),
  ('dtdc',       'DTDC',        'https://www.dtdc.in/tracking.asp?strCnno={awb}', 30),
  ('indiapost',  'India Post',  'https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx?ID={awb}', 40),
  ('xpressbees', 'XpressBees',  'https://www.xpressbees.com/shipment/tracking?awb={awb}', 50),
  ('ekart',      'Ekart',       'https://ekartlogistics.com/shipmenttrack/{awb}', 60),
  ('shiprocket', 'Shiprocket',  'https://shiprocket.co/tracking/{awb}', 70),
  ('other',      'Other',       '', 999);

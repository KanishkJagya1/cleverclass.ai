-- Internal notes on an order.
--
-- A separate table rather than a column, for two reasons. `orders.notes`
-- already holds what the CUSTOMER typed at checkout — appending staff remarks
-- there would overwrite it and blur who said what. And a note is an event with
-- an author and a time, so it belongs in a log, not a field that the last
-- writer wins.
--
-- These are never shown to the customer. Anything the customer should see goes
-- through the support thread, which has its own internal/external flag.

CREATE TABLE IF NOT EXISTS order_notes (
  id          TEXT    PRIMARY KEY,
  order_id    TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id   TEXT,
  author_name TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL,
  -- Pinned notes lead the list: "customer asked us to call after 6pm" has to
  -- survive the twenty routine notes that follow it.
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,

  CHECK (length(trim(body)) > 0),
  CHECK (pinned IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_order_notes_order
  ON order_notes(order_id, pinned DESC, created_at DESC);

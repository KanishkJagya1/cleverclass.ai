-- What people search for, and what they do not find.
--
-- The zero-result queries are the valuable half. "Class 10 Sanskrit Marathi"
-- returning nothing is a customer who left, and it is also the clearest signal
-- the shop has about which title to stock or publish next. Nothing currently
-- records that at all.

CREATE TABLE IF NOT EXISTS search_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Lower-cased and trimmed. The raw string is not kept: it adds nothing and
  -- search boxes collect typos, email addresses and the occasional password
  -- pasted into the wrong field.
  q           TEXT    NOT NULL,
  results     INTEGER NOT NULL DEFAULT 0,
  -- suggest|search — a suggestion request is a keystroke, a search is intent.
  -- Mixing them would make "popular searches" a list of one-letter prefixes.
  source      TEXT    NOT NULL DEFAULT 'search',
  customer_id TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_q       ON search_log(q);
CREATE INDEX IF NOT EXISTS idx_search_created ON search_log(created_at);
-- The two reports this table exists for.
CREATE INDEX IF NOT EXISTS idx_search_zero
  ON search_log(results, created_at) WHERE results = 0;

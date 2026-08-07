-- Master data: class, series, board, subject, stream.
--
-- These five were hardcoded — as CHECK-comment conventions on `books` and as
-- a `CLASSES` constant in the frontend. That meant adding a series was a code
-- change and a deploy, which is not something a shop owner should need a
-- developer for.
--
-- WHY `code` AND `id`. `books` stores these as free text (`books.series` is
-- the string 'kohinoor', not a foreign key). Rewriting 324 rows and every
-- query to use integer keys would be a large, risky change for no gain the
-- admin can see. Instead `code` IS the value stored on `books`, so the masters
-- table is a registry of allowed values plus their presentation — labels,
-- ordering, active flag — and existing data keeps working untouched.
--
-- The consequence, made explicit because it is the thing that will bite: a
-- master row is NOT protected by a foreign key. Nothing at the database level
-- stops a code being deleted while books still reference it. `masters.py`
-- enforces that instead, by counting referencing books before any delete.

CREATE TABLE IF NOT EXISTS masters (
  id          TEXT    PRIMARY KEY,
  -- class|series|board|subject|stream
  kind        TEXT    NOT NULL,
  -- The value as stored on `books`. Lower-case for class/series/board/stream;
  -- subjects are Title Case because they are displayed verbatim on the site.
  code        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  label_mr    TEXT    NOT NULL DEFAULT '',
  -- Streams belong to classes 11-12 only. Held as a CSV of class codes rather
  -- than a join table: it is read on every form render and never queried by
  -- itself, so a table would add a join to buy nothing.
  applies_to  TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- Inactive hides a master from the pickers WITHOUT breaking the books that
  -- already use it — the honest middle ground between keeping and deleting.
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,

  CHECK (kind IN ('class','series','board','subject','stream')),
  CHECK (is_active IN (0,1)),
  CHECK (length(trim(code)) > 0),
  CHECK (length(trim(label)) > 0)
);

-- One code per kind. Two 'kohinoor' series rows would make the picker
-- ambiguous and the books unattributable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_masters_kind_code
  ON masters(kind, code);

CREATE INDEX IF NOT EXISTS idx_masters_kind_order
  ON masters(kind, is_active, sort_order);

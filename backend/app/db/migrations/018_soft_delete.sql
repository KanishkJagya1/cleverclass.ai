-- Soft delete for the catalogue.
--
-- A book cannot simply be removed. Orders, invoices and the stock ledger all
-- reference `books.id`, and an invoice that cannot name what was sold is a
-- problem for an auditor, not just a broken page. So "delete" marks the row and
-- hides it; the history keeps resolving.
--
-- This is deliberately NOT the same as `status = 'archived'`. Archived means
-- "we no longer sell this, but it is still ours" — it stays in the admin lists
-- and can be republished. Deleted means "this was a mistake, get it out of my
-- way", and it leaves the lists entirely while remaining recoverable.

ALTER TABLE books ADD COLUMN deleted_at TEXT;
ALTER TABLE books ADD COLUMN deleted_by TEXT;

-- Every catalogue query filters on `deleted_at IS NULL`, so it belongs in the
-- index rather than forcing a scan to find the live rows.
CREATE INDEX IF NOT EXISTS idx_books_live
  ON books(status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_books_deleted
  ON books(deleted_at) WHERE deleted_at IS NOT NULL;

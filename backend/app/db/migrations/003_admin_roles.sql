-- Widen admin roles from admin|editor to the five real ones.
--
-- SQLite cannot alter a CHECK constraint in place, so this is the standard
-- twelve-step table rebuild: new table, copy, drop, rename. Wrapped in the
-- migration runner's transaction, so a failure leaves the old table untouched.
--
-- The FIRST admin becomes super_admin. Someone has to be able to manage
-- accounts, and if nobody is, the deployment is locked out of its own user
-- management with no way back in short of a manual SQL edit. Ordering by
-- created_at makes that "whoever set the system up", which is the right person.

-- Foreign keys OFF for the rebuild, and ON again at the end.
--
-- `admin_sessions.user_id` references this table with ON DELETE CASCADE.
-- SQLite implements DROP TABLE as "delete every row, then drop", so with keys
-- enforced the drop would fire that cascade and silently sign out every admin —
-- including whoever is running the deploy. The pragma is a no-op inside a
-- transaction, which is only safe to rely on here because the migration runner
-- uses executescript(), and that commits on its own.
PRAGMA foreign_keys = OFF;

CREATE TABLE admin_users_new (
  id            TEXT    PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'editor',
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL,
  -- Default is now the LEAST privileged role, not the most. A row inserted by
  -- code that forgets to pass a role should be able to do the least, not the
  -- most — the old default of 'admin' failed that test.
  CHECK (role IN ('super_admin','admin','store_manager','support','editor'))
);

INSERT INTO admin_users_new
  (id, email, name, password_hash, role, is_active, last_login_at, created_at)
SELECT id, email, name, password_hash, role, is_active, last_login_at, created_at
  FROM admin_users;

DROP TABLE admin_users;
ALTER TABLE admin_users_new RENAME TO admin_users;

-- Promote the earliest account so admin management is reachable at all.
UPDATE admin_users
   SET role = 'super_admin'
 WHERE id = (SELECT id FROM admin_users ORDER BY created_at, id LIMIT 1);

PRAGMA foreign_keys = ON;

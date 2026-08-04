-- In-app notifications for staff and customers.
--
-- Email is push and can be missed, filtered or unconfigured — this is the pull
-- channel. It is also the only one that works today, given SMTP is not set up:
-- a new order still reaches the shop owner through the admin bell even when no
-- mail is being sent.

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT    PRIMARY KEY,

  -- Exactly one of these is set. `admin_id NULL` on an admin notification means
  -- "any staff member", which is how a new order reaches whoever is looking.
  audience    TEXT    NOT NULL,          -- admin|customer
  admin_id    TEXT REFERENCES admin_users(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,

  kind        TEXT    NOT NULL,
              -- order.new|payment.awaiting|stock.low|ticket.new|refund.requested
              -- |order.shipped|order.delivered|review.pending
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  -- Where clicking it goes. Stored rather than derived, so a notification
  -- still links correctly after the route it points at is renamed.
  link        TEXT    NOT NULL DEFAULT '',
  severity    TEXT    NOT NULL DEFAULT 'info',   -- info|warning|urgent

  entity      TEXT,                              -- order|ticket|book|payment
  entity_id   TEXT,

  read_at     TEXT,
  created_at  TEXT    NOT NULL,

  CHECK (audience IN ('admin','customer')),
  CHECK (severity IN ('info','warning','urgent'))
);

-- The bell polls "unread for me", so the index covers exactly that.
CREATE INDEX IF NOT EXISTS idx_notif_admin
  ON notifications(audience, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_customer
  ON notifications(customer_id, read_at, created_at);
-- One notification per event per audience. Without this, a retried webhook or
-- a double-clicked admin action produces duplicate bells for one thing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedupe
  ON notifications(audience, kind, entity_id)
  WHERE entity_id IS NOT NULL;

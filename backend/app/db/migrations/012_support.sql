-- Support ticketing.
--
-- The contact form currently writes a `leads` row and nothing else: there is no
-- reply, no status and no way for a customer to see what happened. That is a
-- suggestion box, not support. These tables make a conversation.

CREATE TABLE IF NOT EXISTS tickets (
  id            TEXT    PRIMARY KEY,
  -- Human reference, quoted in emails and read out on the phone. Same
  -- unambiguous alphabet as order numbers: no O/0, no I/1/L.
  reference     TEXT    NOT NULL UNIQUE,

  -- Nullable: guests get support too, and requiring an account before someone
  -- can report a missing parcel is exactly backwards.
  customer_id   TEXT    REFERENCES customers(id),
  order_id      TEXT    REFERENCES orders(id),

  -- Captured even for signed-in customers: the address they want replies at is
  -- not always the one on the account.
  email         TEXT    NOT NULL,
  name          TEXT    NOT NULL DEFAULT '',
  phone         TEXT    NOT NULL DEFAULT '',

  subject       TEXT    NOT NULL,
  category      TEXT    NOT NULL DEFAULT 'general',
                -- general|order|delivery|payment|refund|product|technical
  status        TEXT    NOT NULL DEFAULT 'open',
                -- open|pending_customer|resolved|closed
  priority      TEXT    NOT NULL DEFAULT 'normal',   -- low|normal|high|urgent

  assignee_id   TEXT REFERENCES admin_users(id),

  -- SLA clocks. `first_response_at` is the number support teams are judged on,
  -- and it cannot be reconstructed later from message timestamps once a ticket
  -- has been reopened.
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  first_response_at TEXT,
  resolved_at   TEXT,
  closed_at     TEXT,
  last_customer_at  TEXT,
  last_staff_at     TEXT,

  CHECK (status IN ('open','pending_customer','resolved','closed')),
  CHECK (priority IN ('low','normal','high','urgent')),
  CHECK (category IN ('general','order','delivery','payment','refund',
                      'product','technical'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_email    ON tickets(email);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id, status);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          TEXT    PRIMARY KEY,
  ticket_id   TEXT    NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

  -- customer|staff|system. `system` records status changes in the same thread
  -- so the timeline reads as one story rather than two.
  author_kind TEXT    NOT NULL,
  author_id   TEXT,
  author_name TEXT    NOT NULL DEFAULT '',

  body        TEXT    NOT NULL,
  -- An internal note is staff-only and MUST never reach the customer. Kept in
  -- the same table so the thread stays chronological, and filtered on read —
  -- a separate table would drift out of order.
  is_internal INTEGER NOT NULL DEFAULT 0,

  created_at  TEXT    NOT NULL,
  CHECK (author_kind IN ('customer','staff','system'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages ON ticket_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id          TEXT    PRIMARY KEY,
  ticket_id   TEXT    NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id  TEXT    REFERENCES ticket_messages(id) ON DELETE CASCADE,
  filename    TEXT    NOT NULL,
  -- Under MEDIA_ROOT, never inside a web root — same rule as book PDFs and
  -- payment proofs. Served only through an authorised endpoint.
  path        TEXT    NOT NULL,
  mime        TEXT    NOT NULL DEFAULT '',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  sha256      TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments ON ticket_attachments(ticket_id);

-- Knowledge base. Fed to the sales bot's `cc_policy` collection, which already
-- exists and is indexed at boot — so an answer written once here is also an
-- answer the assistant can give.
CREATE TABLE IF NOT EXISTS kb_articles (
  id          TEXT    PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT 'general',
  is_published INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_kb_published ON kb_articles(is_published, sort_order);

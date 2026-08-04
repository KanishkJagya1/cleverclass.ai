-- Customer accounts: email/password + Google, verification, sessions, outbound mail.
--
-- Deliberately separate from `admin_users`. An admin is staff with write access
-- to the catalogue; a customer is a buyer. Sharing one table would mean one
-- privilege-escalation bug away from a shopper editing prices, and the two have
-- almost no columns in common.

CREATE TABLE IF NOT EXISTS customers (
  id                TEXT    PRIMARY KEY,
  email             TEXT    NOT NULL,
  -- Lower-cased email. Real people type "Ravi@Gmail.com" on Monday and
  -- "ravi@gmail.com" on Friday and must land on the same account; a UNIQUE on
  -- the raw column would happily create two.
  email_norm        TEXT    NOT NULL UNIQUE,
  email_verified_at TEXT,

  -- NULL for Google-only accounts. Not an empty string: NULL means "this
  -- account has no password", which is what lets the login route say
  -- "continue with Google" instead of "wrong password" forever.
  password_hash     TEXT,

  -- Google's `sub` claim. Stable and unique per Google account, unlike email,
  -- which a Workspace admin can reassign to a different person.
  google_sub        TEXT    UNIQUE,

  name              TEXT    NOT NULL DEFAULT '',
  phone             TEXT    NOT NULL DEFAULT '',
  avatar_url        TEXT,

  -- Default delivery address, so checkout is prefilled on the second order.
  address_line1     TEXT    NOT NULL DEFAULT '',
  address_line2     TEXT    NOT NULL DEFAULT '',
  city              TEXT    NOT NULL DEFAULT '',
  state             TEXT    NOT NULL DEFAULT '',
  pincode           TEXT    NOT NULL DEFAULT '',

  marketing_opt_in  INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'active',  -- active|disabled
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,

  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  last_login_at     TEXT,
  CHECK (status IN ('active','disabled'))
);
CREATE INDEX IF NOT EXISTS idx_customers_google ON customers(google_sub);

-- Sessions store a SHA-256 fingerprint of the cookie value, never the value
-- itself — same rule as admin_sessions. A stolen database then yields no usable
-- cookies.
CREATE TABLE IF NOT EXISTS customer_sessions (
  id           TEXT    PRIMARY KEY,     -- sha256(cookie value)
  customer_id  TEXT    NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  last_seen_at TEXT,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_cust_sessions_customer ON customer_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_sessions_expiry   ON customer_sessions(expires_at);

-- Verification and password-reset tokens. Hashed for the same reason as
-- sessions: these are bearer credentials that arrive by email.
CREATE TABLE IF NOT EXISTS email_tokens (
  id          TEXT    PRIMARY KEY,      -- sha256(token)
  customer_id TEXT    NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,         -- verify|reset
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL,
  CHECK (kind IN ('verify','reset'))
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_customer ON email_tokens(customer_id, kind);

-- Every outbound email is a row FIRST, then a send attempt.
--
-- Without this, "did the reset email go out?" is unanswerable, and an SMTP
-- outage silently swallows sign-ups. The row is the record; delivery is a
-- status on it. It also means the whole auth flow works with no SMTP
-- configured at all — mail queues visibly instead of vanishing.
CREATE TABLE IF NOT EXISTS email_outbox (
  id          TEXT    PRIMARY KEY,
  to_email    TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  body_text   TEXT    NOT NULL,
  body_html   TEXT,
  kind        TEXT    NOT NULL,         -- verify|reset|welcome|order|shipping
  status      TEXT    NOT NULL DEFAULT 'queued',  -- queued|sent|failed|skipped
  error       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  related_id  TEXT,                     -- order id, customer id, …
  created_at  TEXT    NOT NULL,
  sent_at     TEXT,
  CHECK (status IN ('queued','sent','failed','skipped'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox(status, created_at);

-- Link orders to an account when one is signed in. Nullable on purpose: guest
-- checkout must keep working, and it is how every order placed before today
-- stays valid.
ALTER TABLE orders ADD COLUMN customer_id TEXT REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at);

-- Editable email templates.
--
-- Rows are OVERRIDES. Every template also exists as a built-in default in
-- `app/services/templates.py`, and an absent or deactivated row falls back to
-- it — so a shop that breaks its own password-reset template does not stop
-- being able to reset passwords.

CREATE TABLE IF NOT EXISTS email_templates (
  key         TEXT    PRIMARY KEY,     -- verify_email, order_shipped, …
  subject     TEXT    NOT NULL,
  -- Sanitised on save, never on render: rendering-time sanitising would have
  -- to run on every send, and a payload stored unsanitised also fires in the
  -- admin preview pane.
  body_html   TEXT    NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  updated_by  TEXT
);

-- One row per previous version, so a bad edit is one click back rather than a
-- retype from memory.
CREATE TABLE IF NOT EXISTS email_template_versions (
  id          TEXT    PRIMARY KEY,
  key         TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  body_html   TEXT    NOT NULL,
  saved_at    TEXT    NOT NULL,
  saved_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_template_versions ON email_template_versions(key, saved_at);

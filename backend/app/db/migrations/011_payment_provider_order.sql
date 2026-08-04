-- Store the gateway's own order id alongside our payment.
--
-- Without this the checkout callback verifies a signature over an order id the
-- BROWSER supplied. The signature is genuine — Razorpay really did sign it —
-- but it can be a signature for a *different, cheaper* order the attacker
-- created themselves. Verifying the signature proves Razorpay signed something;
-- comparing this column proves it signed OUR something.

ALTER TABLE payments ADD COLUMN provider_order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_payments_provider_order
  ON payments(provider_order_id);

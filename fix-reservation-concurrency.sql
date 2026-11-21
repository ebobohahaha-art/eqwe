-- Run in the hosted PostgreSQL SQL console for Production DATABASE_URL.
-- No rows, balances or held reservations are deleted or refunded.
BEGIN;
LOCK TABLE token_reservations IN SHARE ROW EXCLUSIVE MODE;
DROP INDEX IF EXISTS one_unsettled_request_per_customer;
CREATE INDEX IF NOT EXISTS pending_reservations_by_customer
  ON token_reservations(customer_id) WHERE status IN ('held','review');
COMMIT;

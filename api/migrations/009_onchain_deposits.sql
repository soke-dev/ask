-- Deposits discovered on Base, recorded in the ledger.
--
-- A top-up is a USDC transfer into the person's embedded wallet. Nothing in
-- this app initiates it — somebody sends from anywhere — so the only way to
-- know it happened is to read the chain and write down what was found.

ALTER TABLE wallet_entries
  -- The on-chain truth, at USDC's six decimals. `amount_kobo` stays the
  -- unified naira column every other flow uses, but a dollar amount converted
  -- to naira and back would not round-trip, so the original is kept.
  ADD COLUMN amount_usdc NUMERIC(20,6),
  -- The rate applied when the row was written. Recorded because a conversion
  -- with an unknown rate cannot be checked later, and rates move.
  ADD COLUMN fx_rate NUMERIC(12,4),
  ADD COLUMN tx_hash TEXT,
  ADD COLUMN log_index INTEGER,
  ADD COLUMN from_address TEXT;

/*
 * The idempotency rule.
 *
 * A scan re-reads block ranges it has seen before — after a restart, an
 * overlapping window, or a reorg — and every one of those would otherwise
 * insert the same deposit again, crediting money that arrived once. One
 * transfer is one (tx_hash, log_index) pair, forever, so the database refuses
 * the duplicate rather than trusting the scanner to never retry.
 */
CREATE UNIQUE INDEX wallet_entries_onchain_idx
  ON wallet_entries (tx_hash, log_index)
  WHERE tx_hash IS NOT NULL;

ALTER TABLE wallet_entries ADD CONSTRAINT wallet_entries_tx_shape
  CHECK ((tx_hash IS NULL) = (log_index IS NULL));

-- How far the deposit scanner has read for this person. Null means never
-- scanned, which starts a first pass over a bounded look-back window.
ALTER TABLE users ADD COLUMN deposit_scan_block BIGINT;

COMMENT ON COLUMN wallet_entries.amount_usdc IS
  'On-chain amount at 6 decimals. The authority for deposits; amount_kobo is its naira value on the day.';
COMMENT ON COLUMN users.deposit_scan_block IS
  'Highest Base block scanned for incoming USDC. Null = not yet scanned.';

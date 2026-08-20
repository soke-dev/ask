-- Withdrawals, recorded against the transaction that carried them out.
--
-- Reuses wallet_entries so the ledger stays one list. The tx_hash column added
-- in 009 already carries the on-chain reference, and its unique index means a
-- retried relay cannot record the same withdrawal twice.

ALTER TABLE wallet_entries
  ADD COLUMN to_address TEXT,
  -- What relaying cost us. Withdrawals are gasless for the person, not free
  -- for the platform, and a fee nobody measures is a fee nobody controls.
  ADD COLUMN gas_eth NUMERIC(20,12);

-- An authorisation nonce is single-use on chain, but a client that retries
-- before the first attempt confirms would submit the same one twice. Recorded
-- here so the second attempt is refused without spending gas to find out.
CREATE TABLE withdrawal_authorizations (
  nonce        TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_address   TEXT NOT NULL,
  amount_usdc  NUMERIC(20,6) NOT NULL CHECK (amount_usdc > 0),
  valid_before TIMESTAMPTZ NOT NULL,
  tx_hash      TEXT,
  status       TEXT NOT NULL DEFAULT 'issued',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at   TIMESTAMPTZ,
  CHECK (status IN ('issued', 'submitted', 'confirmed', 'failed'))
);
CREATE INDEX withdrawal_auth_user_idx ON withdrawal_authorizations (user_id, created_at DESC);

COMMENT ON COLUMN wallet_entries.gas_eth IS
  'ETH the relayer spent carrying out this withdrawal. Cost to the platform.';

-- Privy becomes the source of truth for who someone is.
--
-- Privy issues each user a DID (`did:privy:...`) that never changes, and an
-- embedded Base wallet created at signup. Email is still recorded, but it is
-- no longer the key: people change email addresses, and Privy allows several
-- login methods to resolve to one account.

ALTER TABLE users
  ADD COLUMN privy_did TEXT UNIQUE,
  -- Nullable because a Privy account exists before its wallet finishes
  -- provisioning, and because email-only accounts are valid.
  ADD COLUMN wallet_address TEXT,
  ADD COLUMN wallet_chain TEXT NOT NULL DEFAULT 'base',
  ADD COLUMN wallet_created_at TIMESTAMPTZ;

CREATE INDEX users_privy_did_idx ON users (privy_did);
CREATE INDEX users_wallet_idx ON users (wallet_address) WHERE wallet_address IS NOT NULL;

-- Email was NOT NULL because it was the only identifier. Privy accounts can
-- authenticate by wallet alone, so it has to be allowed to be absent — while
-- still being unique when present, which is what the partial index gives.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- An address is 0x plus 40 hex characters, stored lowercase so that two
-- casings of the same wallet cannot become two rows. EIP-55 checksum casing is
-- a display concern, not a storage one.
ALTER TABLE users ADD CONSTRAINT users_wallet_address_format
  CHECK (wallet_address IS NULL OR wallet_address ~ '^0x[0-9a-f]{40}$');

-- KYC is Privy-independent: a verified identity belongs to the person, not to
-- the login method. Recorded here so a re-login never loses it.
ALTER TABLE identity_checks
  ADD COLUMN verified_name TEXT;

COMMENT ON COLUMN users.privy_did IS
  'Privy DID (did:privy:...). Stable across email changes and login methods.';
COMMENT ON COLUMN identity_checks.verified_name IS
  'Legal name as returned by the KYC provider. The only name the app trusts.';

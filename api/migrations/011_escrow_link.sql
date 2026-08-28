-- Ties a question to its job in the escrow contract.
--
-- Nullable throughout: the ledger path still works, and a question funded
-- before the contract existed has no job to point at. A row with a null
-- chain_job_id is one the database settled on its own, which is a fact worth
-- being able to see rather than a gap to paper over.

ALTER TABLE questions
  ADD COLUMN chain_job_id  TEXT,
  ADD COLUMN fund_tx       TEXT,
  ADD COLUMN release_tx    TEXT,
  ADD COLUMN refund_tx     TEXT,
  -- Kept so the fund authorisation can be rebuilt and retried without asking
  -- the asker to sign a second time.
  ADD COLUMN fund_salt     TEXT;

CREATE UNIQUE INDEX questions_chain_job_idx
  ON questions (chain_job_id) WHERE chain_job_id IS NOT NULL;

ALTER TABLE tasks
  ADD COLUMN claim_tx      TEXT,
  -- keccak of the evidence, as recorded on chain. Lets a reviewer prove which
  -- file they judged, and stops an asker disputing against different footage.
  ADD COLUMN evidence_hash TEXT;

COMMENT ON COLUMN questions.chain_job_id IS
  'bytes32 job id in AskEscrow. Null means this question was never funded on chain.';

-- The USDC a job is funded with, fixed at quote time.
--
-- A bounty is set in naira but escrowed in USDC, so the amount has to be
-- converted — and converted exactly once. The EIP-3009 nonce is
-- keccak(jobId, amount, salt), so recomputing the amount at relay time from a
-- rate that has since moved produces a different nonce and the signature no
-- longer verifies. Storing it keeps the two halves talking about the same
-- number.

ALTER TABLE questions
  ADD COLUMN fund_usdc NUMERIC(20,6),
  -- The rate used, so the conversion can be checked rather than being an
  -- unexplainable figure months later.
  ADD COLUMN fund_rate NUMERIC(12,4);

COMMENT ON COLUMN questions.fund_usdc IS
  'USDC amount quoted for escrow. Fixed at quote time — the nonce depends on it.';

-- Identity checks become a real queue that a person works through.
--
-- Until now `identity_checks` only recorded an outcome, because the outcome
-- was invented by a three-second timer in the client. A reviewer needs the
-- thing being reviewed, so the submission itself is stored: the number, the
-- name claimed against it, and who decided what.

ALTER TABLE identity_checks
  ADD COLUMN nin              TEXT,
  ADD COLUMN submitted_name   TEXT,
  ADD COLUMN reviewed_at      TIMESTAMPTZ,
  ADD COLUMN rejection_reason TEXT;

-- A NIN is exactly 11 digits. Checked here as well as in the API so that a
-- malformed one cannot reach a reviewer and waste their time.
ALTER TABLE identity_checks ADD CONSTRAINT identity_checks_nin_format
  CHECK (nin IS NULL OR nin ~ '^[0-9]{11}$');

-- One pending submission per person. Without this, tapping submit twice puts
-- two identical rows in the queue and a reviewer decides the same case twice.
CREATE UNIQUE INDEX identity_checks_one_pending
  ON identity_checks (user_id)
  WHERE status = 'pending';

-- Approving a check means asserting a legal name, so the two must arrive
-- together. A verified row with no name would leave the app showing a shield
-- next to nothing.
ALTER TABLE identity_checks ADD CONSTRAINT identity_checks_verified_has_name
  CHECK (status <> 'verified' OR verified_name IS NOT NULL);

COMMENT ON COLUMN identity_checks.nin IS
  'Submitted NIN. Visible only to reviewers, never to other users.';
COMMENT ON COLUMN identity_checks.submitted_name IS
  'The name the person claims. Compared against the NIN record by a reviewer.';

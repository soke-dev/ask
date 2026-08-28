-- Keys that let a program act as a person.
--
-- Every route on this server authenticates a Privy token issued to a phone.
-- An agent has no phone and no login, so it needs its own credential — but not
-- its own identity: a key belongs to a user, and a request carrying it is that
-- user acting through a program. The agent inherits their wallet, their USDC,
-- their questions and their history, and no route downstream has to know the
-- difference.
--
-- That also settles who pays. An agent dispatching a job spends its owner's
-- balance, against the same escrow, with the same refund path if nobody goes.
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What it is for, so a person with several can revoke the right one.
  name         TEXT NOT NULL,
  -- SHA-256 of the key. The key itself is shown once, at creation, and is not
  -- recoverable: a table of live credentials in plaintext is a table that
  -- leaks every agent at once the day the database does.
  token_hash   TEXT NOT NULL UNIQUE,
  -- The first few characters, so a key can be recognised in a list without
  -- being usable from one.
  hint         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  -- Revoked rather than deleted, so a key that turns up in a log later can
  -- still be identified as one that was withdrawn.
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX api_keys_user_idx ON api_keys (user_id) WHERE revoked_at IS NULL;

-- How a question arrived, so the two audiences can be told apart.
--
-- An agent's questions look exactly like a person's on the board, which is the
-- point — a verifier should not care. But nothing recorded which was which,
-- and without that there is no way to know whether the agent side is used at
-- all, or to answer the first question anybody asks about it.
ALTER TABLE questions ADD COLUMN asked_by_key UUID REFERENCES api_keys(id) ON DELETE SET NULL;
CREATE INDEX questions_asked_by_key_idx ON questions (asked_by_key) WHERE asked_by_key IS NOT NULL;

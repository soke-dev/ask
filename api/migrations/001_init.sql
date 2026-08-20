-- Ask Nearby — initial schema.
--
-- Money is stored in kobo as BIGINT, never a float. Naira has a subunit and
-- binary floating point cannot hold 0.1 exactly; a drift of one kobo per job
-- is a reconciliation bug that takes months to find. The client works in whole
-- naira, so the API multiplies on the way in and divides on the way out —
-- that conversion lives in one place and nowhere else.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email

-- ── People ──────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        CITEXT UNIQUE NOT NULL,
  phone        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE profiles (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  username     CITEXT UNIQUE,
  avatar_url   TEXT,
  home_area    TEXT,
  home_state   TEXT,
  -- Set when the first-run sheet is finished or skipped, so it is asked once.
  onboarded_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The NIN itself is deliberately absent. It is checked against the provider
-- once and only the outcome is kept, so it cannot leak from this database.
CREATE TYPE identity_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');

CREATE TABLE identity_checks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       identity_status NOT NULL DEFAULT 'pending',
  method       TEXT NOT NULL DEFAULT 'nin',
  provider_ref TEXT,
  checked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX identity_checks_user_idx ON identity_checks (user_id, created_at DESC);

-- ── Places ──────────────────────────────────────────────────────────────────

CREATE TABLE places (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  provider_place_id TEXT,
  name              TEXT NOT NULL,
  area              TEXT,
  state             TEXT,
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX places_provider_idx
  ON places (provider, provider_place_id)
  WHERE provider_place_id IS NOT NULL;

-- ── Questions ───────────────────────────────────────────────────────────────

CREATE TYPE visibility AS ENUM ('public', 'private');

CREATE TABLE questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  place_id         UUID REFERENCES places(id) ON DELETE SET NULL,
  bounty_kobo      BIGINT NOT NULL CHECK (bounty_kobo > 0),
  visibility       visibility NOT NULL DEFAULT 'public',
  deadline_minutes INTEGER NOT NULL CHECK (deadline_minutes > 0),
  verified_only    BOOLEAN NOT NULL DEFAULT FALSE,
  dispatched_at    TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX questions_asker_idx ON questions (asker_id, created_at DESC);
CREATE INDEX questions_open_idx  ON questions (dispatched_at DESC) WHERE closed_at IS NULL;

-- ── Tasks ───────────────────────────────────────────────────────────────────

CREATE TYPE task_status AS ENUM (
  'accepted', 'submitted', 'confirmed', 'disputed', 'expired', 'abandoned'
);

CREATE TABLE tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One question, one verifier. This unique constraint is the rule itself: a
  -- second person cannot take a job already taken, whatever the UI allows.
  question_id  UUID NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  verifier_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       task_status NOT NULL DEFAULT 'accepted',
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX tasks_verifier_idx ON tasks (verifier_id, accepted_at DESC);

CREATE TABLE answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX answers_task_idx ON answers (task_id);

-- ── Evidence and its checks ────────────────────────────────────────────────

CREATE TYPE evidence_kind AS ENUM ('photo', 'video');

CREATE TABLE evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind             evidence_kind NOT NULL,
  storage_key      TEXT NOT NULL,
  mime             TEXT,
  bytes            BIGINT,
  width            INTEGER,
  height           INTEGER,
  duration_seconds NUMERIC(6,2),
  -- Where the phone was when it captured this, and how far that is from the
  -- place the question named. Advisory: GPS drifts, and a mall is bigger than
  -- its pin. Shown to the asker as a fact, never used to auto-reject.
  captured_lat     DOUBLE PRECISION,
  captured_lng     DOUBLE PRECISION,
  distance_metres  INTEGER,
  captured_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidence_task_idx ON evidence (task_id);

CREATE TYPE check_verdict AS ENUM ('pass', 'warn', 'fail', 'skipped');

-- One row per check per piece of evidence, including the ones that did not
-- run. A skipped check with a reason is a fact; a missing row is an unknown,
-- and the two must not look the same when a dispute is being reviewed.
CREATE TABLE evidence_checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  tier        SMALLINT NOT NULL,
  verdict     check_verdict NOT NULL,
  score       NUMERIC(10,3),
  threshold   NUMERIC(10,3),
  detail      TEXT,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidence_checks_evidence_idx ON evidence_checks (evidence_id);

-- A verifier told to retake gets a new attempt against the same task. Capped
-- in the API so a failing gate cannot be used to sit on a job indefinitely.
CREATE TABLE submission_attempts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt    SMALLINT NOT NULL,
  verdict    check_verdict NOT NULL,
  overridden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, attempt)
);

-- ── Money ───────────────────────────────────────────────────────────────────

CREATE TYPE wallet_kind AS ENUM (
  'hold', 'refund', 'earning', 'deposit', 'tip', 'withdrawal', 'fee'
);

CREATE TABLE wallet_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        wallet_kind NOT NULL,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  pending     BOOLEAN NOT NULL DEFAULT FALSE,
  question_id UUID REFERENCES questions(id) ON DELETE SET NULL,
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wallet_entries_user_idx ON wallet_entries (user_id, created_at DESC);

-- ── Disputes ────────────────────────────────────────────────────────────────

CREATE TYPE dispute_status AS ENUM (
  'awaiting_verifier', 'awaiting_admin', 'resolved_asker', 'resolved_verifier'
);

CREATE TABLE disputes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id    UUID NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  task_id        UUID REFERENCES tasks(id) ON DELETE SET NULL,
  asker_reason   TEXT NOT NULL,
  verifier_reply TEXT,
  status         dispute_status NOT NULL DEFAULT 'awaiting_verifier',
  admin_note     TEXT,
  resolved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX disputes_status_idx ON disputes (status, created_at DESC);

-- ── Notifications ───────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  href       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

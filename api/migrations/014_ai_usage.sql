-- What each account has spent on the AI helpers today.
--
-- Kept per day and per kind rather than as one number, because the two helpers
-- cost very different amounts and will not want the same ceiling: tidying a
-- question is a few hundred tokens and a convenience, while the relevance
-- check is most of the image and part of how somebody gets paid.
--
-- Rows are never deleted on the request path. A day's row stops being written
-- to at midnight and simply sits there; pruning is a housekeeping job, not
-- something worth doing while a person waits for a button.
CREATE TABLE ai_usage (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- UTC, matching CURRENT_DATE on the server. A day boundary that moves with
  -- the caller's timezone would let one account reset its own allowance.
  day      DATE NOT NULL,
  kind     TEXT NOT NULL,
  used     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);

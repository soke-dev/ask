-- Where to reach somebody when the app is not open.
--
-- Keyed on the token rather than the user: one account signs in on a phone and
-- a tablet and both should ring, and the same device can be handed to a
-- different account, at which point the row must follow the device rather than
-- accumulate. ON CONFLICT (token) DO UPDATE re-points it in one statement.
CREATE TABLE push_tokens (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cleared when Expo tells us the token is dead, so a device that has
  -- uninstalled the app stops being sent to.
  failed_at  TIMESTAMPTZ
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id) WHERE failed_at IS NULL;

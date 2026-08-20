-- Alert and privacy settings, stored per person.
--
-- Columns rather than a JSON blob: the notification sender will need to ask
-- "who within 5km wants job alerts?", and that is an indexed boolean scan on a
-- column, versus deserialising every row to look inside a document.
--
-- Defaults match the app's own, so a row created before this migration and a
-- row created after it behave identically. Product news is the one that starts
-- off: nobody installed this to hear from us.

ALTER TABLE profiles
  ADD COLUMN alert_jobs_nearby         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN alert_question_taken      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN alert_evidence_back       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN alert_payments            BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN alert_reviews             BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN alert_product_news        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN answers_public_by_default BOOLEAN NOT NULL DEFAULT TRUE;

-- Only the people who want a given alert, without scanning everyone.
CREATE INDEX profiles_alert_jobs_nearby_idx
  ON profiles (user_id) WHERE alert_jobs_nearby;

COMMENT ON COLUMN profiles.answers_public_by_default IS
  'Pre-selects sharing when paying for a question. Never applied retroactively.';

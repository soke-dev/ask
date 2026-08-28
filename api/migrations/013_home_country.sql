-- Where somebody is, at country level.
--
-- One country today, so this is always 'Nigeria' for now — which is exactly
-- why it is worth recording. The moment there is a second, every existing row
-- needs to say which one it meant, and backfilling a guess across live
-- accounts is worse than storing the obvious answer now.

ALTER TABLE profiles
  ADD COLUMN home_country TEXT NOT NULL DEFAULT 'Nigeria';

COMMENT ON COLUMN profiles.home_country IS
  'Country the person takes jobs in. Nigeria-only today; recorded so a second one needs no backfill.';

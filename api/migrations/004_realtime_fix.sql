-- Fixes notify_change() from 003.
--
-- The original read NEW.question_id inside a CASE branch that only applied to
-- the `tasks` table. PL/pgSQL does not lazily skip the untaken branches of a
-- CASE when resolving record fields — it resolves every field reference in the
-- expression against the actual record type — so any write to `questions`,
-- which has no question_id column, failed with:
--
--   ERROR: record "new" has no field "question_id"
--
-- That is worse than a broken notification: the trigger is AFTER INSERT on the
-- same transaction, so the error aborted the write itself. Creating a question
-- would have failed outright.
--
-- Converting the row to JSONB first sidesteps it entirely. `rec->>'missing'`
-- returns NULL rather than raising, so one function can serve every table
-- without needing to know which columns each one has.

CREATE OR REPLACE FUNCTION notify_change() RETURNS TRIGGER AS $$
DECLARE
  rec   JSONB;
  topic TEXT;
BEGIN
  -- Explicit rather than COALESCE(NEW, OLD): record-typed COALESCE is awkward
  -- in PL/pgSQL, and DELETE leaves NEW unset.
  IF TG_OP = 'DELETE' THEN
    rec := to_jsonb(OLD);
  ELSE
    rec := to_jsonb(NEW);
  END IF;

  topic := CASE TG_TABLE_NAME
    WHEN 'questions'      THEN 'question:' || (rec->>'id')
    WHEN 'tasks'          THEN 'question:' || (rec->>'question_id')
    WHEN 'disputes'       THEN 'question:' || (rec->>'question_id')
    WHEN 'answers'        THEN 'task:'     || (rec->>'task_id')
    WHEN 'evidence'       THEN 'task:'     || (rec->>'task_id')
    WHEN 'wallet_entries' THEN 'user:'     || (rec->>'user_id')
    WHEN 'notifications'  THEN 'user:'     || (rec->>'user_id')
    ELSE TG_TABLE_NAME
  END;

  -- A row whose topic column is NULL has nobody to notify, and 'question:'
  -- with nothing after it would be a topic every such row shared.
  IF topic IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  PERFORM pg_notify('changes', json_build_object(
    'table', TG_TABLE_NAME,
    'op',    lower(TG_OP),
    'id',    rec->>'id',
    'topic', topic,
    'at',    extract(epoch from now())
  )::text);

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

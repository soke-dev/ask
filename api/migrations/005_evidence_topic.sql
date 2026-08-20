-- Routes evidence and answers to the question's topic instead of the task's.
--
-- 003 sent them to 'task:<id>'. That looked tidy — the row has a task_id, so
-- use it — but it broke the thing the topic scheme exists for.
--
-- The asker watches one screen, for one question. "The evidence came back" is
-- the event they are actually waiting for. Publishing it to the task's topic
-- meant they had to first learn the task id (a second request), then take out
-- a second subscription, and hold both open — all to hear about their own
-- question. A verifier accepting the job would race that setup, so the asker
-- could miss the notification entirely on a slow connection.
--
-- One question, one topic. The extra lookup is a primary key hit on a table
-- that is written once per job, which is nothing next to a second round trip
-- from a phone on Nigerian mobile data.

CREATE OR REPLACE FUNCTION notify_change() RETURNS TRIGGER AS $$
DECLARE
  rec   JSONB;
  topic TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := to_jsonb(OLD);
  ELSE
    rec := to_jsonb(NEW);
  END IF;

  topic := CASE TG_TABLE_NAME
    WHEN 'questions'      THEN 'question:' || (rec->>'id')
    WHEN 'tasks'          THEN 'question:' || (rec->>'question_id')
    WHEN 'disputes'       THEN 'question:' || (rec->>'question_id')
    WHEN 'wallet_entries' THEN 'user:'     || (rec->>'user_id')
    WHEN 'notifications'  THEN 'user:'     || (rec->>'user_id')
    WHEN 'answers'        THEN 'question:' ||
      (SELECT t.question_id::text FROM tasks t WHERE t.id = (rec->>'task_id')::uuid)
    WHEN 'evidence'       THEN 'question:' ||
      (SELECT t.question_id::text FROM tasks t WHERE t.id = (rec->>'task_id')::uuid)
    ELSE TG_TABLE_NAME
  END;

  -- Covers both a NULL topic column and a lookup that found no task — the
  -- latter happens on cascade deletes, where the task row may already be gone.
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

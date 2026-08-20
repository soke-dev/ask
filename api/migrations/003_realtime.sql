-- Realtime, using Postgres' own LISTEN/NOTIFY rather than a polling loop.
--
-- Any write to a watched table fires a trigger that publishes a small JSON
-- envelope on the `changes` channel. The API keeps one connection LISTENing
-- and fans each envelope out to whichever clients subscribed to that topic.
--
-- The alternative — clients polling "has anything changed?" every few seconds
-- — costs a query per client per interval whether or not anything happened,
-- and still shows stale data for up to one interval. This costs nothing while
-- idle and delivers in milliseconds.
--
-- Two constraints shape what the payload can be:
--
--   1. NOTIFY payloads are capped at 8000 bytes. A row with a long question
--      body and an admin note could approach that, and Postgres raises an
--      error on overflow — which would abort the transaction that was merely
--      trying to announce itself. So the payload carries identifiers only.
--   2. The client re-fetches on notification. That keeps authorisation in the
--      API where it belongs, instead of pushing row contents to every
--      listener and filtering afterwards.

CREATE OR REPLACE FUNCTION notify_change() RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
  record_id UUID;
  topic TEXT;
BEGIN
  record_id := COALESCE(NEW.id, OLD.id);

  -- The topic decides who hears about this. Everything to do with one
  -- question travels on that question's topic, so an asker watching their
  -- tracking screen gets the task, the evidence and the dispute without
  -- subscribing to three separate things.
  topic := CASE TG_TABLE_NAME
    WHEN 'questions'  THEN 'question:' || COALESCE(NEW.id, OLD.id)
    WHEN 'tasks'      THEN 'question:' || COALESCE(NEW.question_id, OLD.question_id)
    WHEN 'disputes'   THEN 'question:' || COALESCE(NEW.question_id, OLD.question_id)
    WHEN 'answers'    THEN 'task:'     || COALESCE(NEW.task_id, OLD.task_id)
    WHEN 'evidence'   THEN 'task:'     || COALESCE(NEW.task_id, OLD.task_id)
    WHEN 'wallet_entries'  THEN 'user:' || COALESCE(NEW.user_id, OLD.user_id)
    WHEN 'notifications'   THEN 'user:' || COALESCE(NEW.user_id, OLD.user_id)
    ELSE TG_TABLE_NAME
  END;

  payload := json_build_object(
    'table', TG_TABLE_NAME,
    'op',    lower(TG_OP),
    'id',    record_id,
    'topic', topic,
    'at',    extract(epoch from now())
  );

  PERFORM pg_notify('changes', payload::text);

  -- AFTER triggers ignore the return value, but returning NULL from a row
  -- trigger is a habit worth not forming.
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Attached AFTER, so nothing is announced that has not actually been written,
-- and announcements are only delivered when the transaction commits — Postgres
-- holds NOTIFY until commit, so a rolled-back write never reaches a listener.
CREATE TRIGGER questions_notify
  AFTER INSERT OR UPDATE OR DELETE ON questions
  FOR EACH ROW EXECUTE FUNCTION notify_change();

CREATE TRIGGER tasks_notify
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_change();

CREATE TRIGGER disputes_notify
  AFTER INSERT OR UPDATE OR DELETE ON disputes
  FOR EACH ROW EXECUTE FUNCTION notify_change();

CREATE TRIGGER answers_notify
  AFTER INSERT OR UPDATE OR DELETE ON answers
  FOR EACH ROW EXECUTE FUNCTION notify_change();

CREATE TRIGGER evidence_notify
  AFTER INSERT OR UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION notify_change();

CREATE TRIGGER wallet_entries_notify
  AFTER INSERT OR UPDATE OR DELETE ON wallet_entries
  FOR EACH ROW EXECUTE FUNCTION notify_change();

CREATE TRIGGER notifications_notify
  AFTER INSERT OR UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notify_change();

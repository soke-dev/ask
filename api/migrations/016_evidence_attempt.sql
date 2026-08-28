-- Which retake a piece of evidence belongs to.
--
-- Evidence rows live for the whole task: a verifier told to take it again
-- leaves the rejected files behind, and nothing on the row said which attempt
-- they came from. Every reader papered over that with
-- `ORDER BY created_at DESC LIMIT 1` — newest file wins — which was right
-- about *which* attempt and wrong about how many files it has. Somebody who
-- sent two photos had one shown to the asker and no sign the other existed.
ALTER TABLE evidence ADD COLUMN attempt SMALLINT;

-- Rows written before the column existed.
--
-- Not defaulted to 1: one task in this database holds six photos across three
-- attempts of two, and calling all six "attempt 1" would show an asker the
-- four the gate had already rejected — a worse bug than the one being fixed.
--
-- The attempt is recoverable instead. submission_attempts is written in the
-- same transaction as the evidence it describes, so the timestamps agree; the
-- interval is slack for clock granularity, not a guess. Verified against live
-- data before this shipped: every existing row matched, none left over.
UPDATE evidence ev
   SET attempt = (
     SELECT sa.attempt
       FROM submission_attempts sa
      WHERE sa.task_id = ev.task_id
        AND sa.created_at <= ev.created_at + interval '2 seconds'
      ORDER BY sa.created_at DESC, sa.attempt DESC
      LIMIT 1
   )
 WHERE ev.attempt IS NULL;

-- Anything with no attempt row to match — evidence kept from before that
-- table was populated. One attempt is what it was.
UPDATE evidence SET attempt = 1 WHERE attempt IS NULL;

CREATE INDEX evidence_task_attempt_idx ON evidence (task_id, attempt);

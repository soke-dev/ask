-- Reputation. Split from 001 so the core can deploy without it.

CREATE TABLE ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  rated_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rater_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (rated_id <> rater_id)
);
CREATE INDEX ratings_rated_idx ON ratings (rated_id, created_at DESC);

-- Cheap reads for a profile card without scanning every task.
CREATE VIEW verifier_stats AS
SELECT
  t.verifier_id                                  AS user_id,
  COUNT(*) FILTER (WHERE t.status = 'confirmed') AS jobs_completed,
  COUNT(*) FILTER (WHERE t.status = 'disputed')  AS jobs_disputed,
  ROUND(AVG(r.stars)::numeric, 2)                AS avg_stars
FROM tasks t
LEFT JOIN ratings r ON r.task_id = t.id
GROUP BY t.verifier_id;

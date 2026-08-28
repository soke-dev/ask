import { storage } from './storage.js';

/**
 * The whole of the last attempt's evidence, as one joinable row.
 *
 * Three routes needed this and all three had written the same shortcut:
 * `ORDER BY created_at DESC LIMIT 1`. That was right about *which* attempt —
 * evidence rows survive a retake, so the newest file does belong to the latest
 * one — and wrong about how many files an attempt has. A verifier who sent two
 * photos had one of them shown and no indication the other existed.
 *
 * Fixing it in three places would have left a fourth reader free to write the
 * shortcut again, which is how it got to three. So the join lives here.
 *
 * Expects the surrounding query to expose the task as `t`, and exposes the
 * result as `e`. `array_agg` over no rows yields NULL, so a task with nothing
 * attached still produces its row of NULLs and the LEFT JOIN keeps behaving.
 */
export const LATEST_EVIDENCE = `
  LEFT JOIN LATERAL (
    SELECT (array_agg(kind::text ORDER BY created_at))[1]      AS kind,
           (array_agg(distance_metres ORDER BY created_at))[1] AS distance_metres,
           (array_agg(captured_at ORDER BY created_at))[1]     AS captured_at,
           array_agg(storage_key ORDER BY created_at)          AS keys
      FROM evidence
     WHERE task_id = t.id
       -- IS NOT DISTINCT FROM, not =, so rows written before the attempt
       -- column existed still match each other rather than dropping out.
       AND attempt IS NOT DISTINCT FROM (
             SELECT max(attempt) FROM evidence WHERE task_id = t.id
           )
  ) e ON TRUE`;

/**
 * Storage keys to paths the app can actually load.
 *
 * Tolerant of the column being NULL — a task with no evidence yet is the
 * normal state for most of a job's life, not an error.
 */
export function evidenceUrls(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  return keys
    .filter((k): k is string => typeof k === 'string' && k.length > 0)
    .map((k) => storage.urlFor(k));
}

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config, hasDatabase } from '../config.js';
import { query, transaction } from '../db.js';
import { runGate } from '../checks/run.js';
import { storage } from '../storage.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.media.maxBytes, files: config.media.maxPhotos },
});

const Body = z.object({
  kind: z.enum(['photo', 'video']),
  question: z.string().min(1),
  placeName: z.string().optional(),
  taskId: z.string().uuid().optional(),
  capturedLat: z.coerce.number().optional(),
  capturedLng: z.coerce.number().optional(),
  targetLat: z.coerce.number().optional(),
  targetLng: z.coerce.number().optional(),
});

export const evidenceRouter = Router();

/**
 * Checks a submission and, when a task is named and a database is configured,
 * records it.
 *
 * The check runs whether or not there is a database. That split is deliberate:
 * the gate is useful on its own while the rest of the backend is still being
 * built, and the client can call this endpoint against a local server long
 * before questions and tasks are persisted anywhere.
 */
evidenceRouter.post('/check', upload.array('files', config.media.maxPhotos), async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_request', detail: parsed.error.issues });
    return;
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'no_files' });
    return;
  }

  const body = parsed.data;
  const captured =
    body.capturedLat !== undefined && body.capturedLng !== undefined
      ? { lat: body.capturedLat, lng: body.capturedLng }
      : null;
  const target =
    body.targetLat !== undefined && body.targetLng !== undefined
      ? { lat: body.targetLat, lng: body.targetLng }
      : null;

  let report;
  try {
    report = await runGate({
      kind: body.kind,
      files: files.map((f) => f.buffer),
      question: body.question,
      placeName: body.placeName ?? null,
      captured,
      target,
    });
  } catch (error) {
    // A crash in the gate must not swallow the verifier's trip. Let it through
    // and say the check did not run, rather than blocking on our own bug.
    console.error('gate failed:', error);
    res.json({
      verdict: 'warn',
      checks: [
        {
          name: 'gate',
          tier: 1,
          verdict: 'skipped',
          detail: 'The automatic check could not run. Your evidence was not blocked.',
        },
      ],
      attemptsLeft: config.maxAttempts,
    });
    return;
  }

  if (!body.taskId || !hasDatabase()) {
    res.json({ ...report, stored: false, attemptsLeft: config.maxAttempts });
    return;
  }

  // Retakes are capped so a failing gate cannot be used to sit on a job while
  // the deadline runs down on the asker.
  const prior = await query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM submission_attempts WHERE task_id = $1',
    [body.taskId],
  );
  const attempt = (prior[0]?.count ?? 0) + 1;
  if (attempt > config.maxAttempts) {
    res.status(429).json({
      error: 'too_many_attempts',
      detail: `This job allows ${config.maxAttempts} attempts.`,
    });
    return;
  }

  const stored = await transaction(async (client) => {
    const saved = await Promise.all(
      files.map((f) => storage.put(f.buffer, f.mimetype)),
    );

    const evidenceRows = await Promise.all(
      saved.map((file, i) =>
        client.query<{ id: string }>(
          `INSERT INTO evidence
             (task_id, attempt, kind, storage_key, mime, bytes, width, height,
              duration_seconds, captured_lat, captured_lng, distance_metres, captured_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
           RETURNING id`,
          [
            body.taskId,
            // Stamped so a reader can take the whole of the last attempt
            // rather than the newest single file out of all of them.
            attempt,
            body.kind,
            file.key,
            files[i]?.mimetype ?? null,
            file.bytes,
            report.facts.width,
            report.facts.height,
            report.facts.durationSeconds,
            captured?.lat ?? null,
            captured?.lng ?? null,
            report.facts.distanceMetres,
          ],
        ),
      ),
    );

    // Checks hang off the first piece of evidence: the gate judges the
    // submission as a whole, not each file separately.
    const evidenceId = evidenceRows[0]?.rows[0]?.id;
    if (evidenceId) {
      for (const check of report.checks) {
        await client.query(
          `INSERT INTO evidence_checks (evidence_id, name, tier, verdict, score, threshold, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            evidenceId,
            check.name,
            check.tier,
            check.verdict,
            check.score ?? null,
            check.threshold ?? null,
            check.detail,
          ],
        );
      }
    }

    await client.query(
      'INSERT INTO submission_attempts (task_id, attempt, verdict) VALUES ($1,$2,$3)',
      [body.taskId, attempt, report.verdict],
    );

    return evidenceRows.map((r) => r.rows[0]?.id).filter(Boolean) as string[];
  });

  res.json({
    ...report,
    stored: true,
    evidenceIds: stored,
    attempt,
    attemptsLeft: Math.max(0, config.maxAttempts - attempt),
  });
});

import { Router } from 'express';
import { attemptLogin, issueToken, requireAdmin } from '../adminAuth.js';
import { one, query, transaction } from '../db.js';

export const adminRouter: Router = Router();

/** Exchanges the shared password for a short-lived token. */
adminRouter.post('/login', (req, res) => {
  const password = String((req.body as { password?: unknown })?.password ?? '');
  const ip = req.ip ?? 'unknown';

  const result = attemptLogin(password, ip);
  if (!result.ok) {
    res.status(401).json({ error: result.detail ?? 'Wrong password.' });
    return;
  }
  res.json(issueToken());
});

adminRouter.use(requireAdmin);

/** Counts for the dashboard header. One round trip rather than six. */
adminRouter.get('/overview', async (_req, res) => {
  const [row] = await query<Record<string, number>>(`
    SELECT
      (SELECT count(*) FROM users)                                          AS users,
      (SELECT count(*) FROM users WHERE wallet_address IS NOT NULL)         AS with_wallet,
      (SELECT count(*) FROM identity_checks WHERE status = 'verified')      AS verified,
      (SELECT count(*) FROM questions)                                      AS questions,
      (SELECT count(*) FROM questions WHERE closed_at IS NULL)              AS open_questions,
      (SELECT count(*) FROM tasks)                                          AS tasks,
      (SELECT count(*) FROM disputes WHERE status = 'awaiting_admin')       AS disputes_to_decide,
      (SELECT count(*) FROM disputes WHERE status = 'awaiting_verifier')    AS disputes_waiting,
      (SELECT COALESCE(sum(amount_kobo), 0) FROM wallet_entries
        WHERE kind = 'hold' AND NOT pending)                                AS held_kobo
  `);
  res.json(row ?? {});
});

/** Everyone, newest first, with the numbers that matter for support. */
adminRouter.get('/users', async (req, res) => {
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await query(
    `SELECT u.id,
            u.email,
            u.privy_did      AS "privyDid",
            u.wallet_address AS "walletAddress",
            u.created_at     AS "createdAt",
            p.username,
            p.home_area      AS "homeArea",
            p.onboarded_at   AS "onboardedAt",
            COALESCE(i.status::text, 'unverified') AS "identityStatus",
            i.verified_name  AS "verifiedName",
            (SELECT count(*) FROM questions q WHERE q.asker_id = u.id)   AS "questionsAsked",
            (SELECT count(*) FROM tasks t WHERE t.verifier_id = u.id)    AS "jobsTaken"
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT status, verified_name FROM identity_checks
          WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
       ) i ON TRUE
      WHERE $1 = '' OR u.email ILIKE '%' || $1 || '%' OR p.username ILIKE '%' || $1 || '%'
      ORDER BY u.created_at DESC
      LIMIT 200`,
    [search],
  );
  res.json({ users: rows });
});

/**
 * One combined activity feed.
 *
 * A UNION rather than four separate endpoints the client has to interleave —
 * ordering across tables is the database's job, and doing it here means the
 * client cannot get the merge subtly wrong.
 */
adminRouter.get('/activity', async (_req, res) => {
  const rows = await query(`
    SELECT * FROM (
      SELECT 'question' AS kind, q.id, q.created_at AS at,
             q.body AS detail, p.username AS who, q.bounty_kobo AS amount_kobo
        FROM questions q LEFT JOIN profiles p ON p.user_id = q.asker_id
      UNION ALL
      SELECT 'job', t.id, t.accepted_at,
             t.status::text, p.username, NULL
        FROM tasks t LEFT JOIN profiles p ON p.user_id = t.verifier_id
      UNION ALL
      SELECT 'dispute', d.id, d.created_at,
             d.asker_reason, NULL, NULL
        FROM disputes d
      UNION ALL
      SELECT 'money', w.id, w.created_at,
             w.kind::text, p.username, w.amount_kobo
        FROM wallet_entries w LEFT JOIN profiles p ON p.user_id = w.user_id
    ) feed
    ORDER BY at DESC
    LIMIT 100
  `);
  res.json({ activity: rows });
});

/** Disputes with both sides and the evidence, for deciding. */
adminRouter.get('/disputes', async (_req, res) => {
  const rows = await query(
    `SELECT d.id, d.status::text, d.asker_reason AS "askerReason",
            d.verifier_reply AS "verifierReply", d.admin_note AS "adminNote",
            d.created_at AS "createdAt",
            q.id AS "questionId", q.body AS question, q.bounty_kobo AS "bountyKobo",
            pl.name AS "placeName",
            asker.username AS "askerName", verifier.username AS "verifierName",
            e.kind::text AS "evidenceKind", e.distance_metres AS "distanceMetres"
       FROM disputes d
       JOIN questions q ON q.id = d.question_id
       LEFT JOIN places pl ON pl.id = q.place_id
       LEFT JOIN profiles asker ON asker.user_id = q.asker_id
       LEFT JOIN tasks t ON t.id = d.task_id
       LEFT JOIN profiles verifier ON verifier.user_id = t.verifier_id
       LEFT JOIN LATERAL (
         SELECT kind, distance_metres FROM evidence
          WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1
       ) e ON TRUE
      ORDER BY
        CASE d.status WHEN 'awaiting_admin' THEN 0 WHEN 'awaiting_verifier' THEN 1 ELSE 2 END,
        d.created_at DESC
      LIMIT 100`,
  );
  res.json({ disputes: rows });
});

/**
 * Rules on a dispute and moves the held money in the same transaction.
 *
 * Both halves or neither: a dispute marked resolved without the matching
 * wallet entry is money that silently vanished, and the reverse pays twice.
 */
adminRouter.post('/disputes/:id/resolve', async (req, res) => {
  const { winner, note } = req.body as { winner?: unknown; note?: unknown };
  if (winner !== 'asker' && winner !== 'verifier') {
    res.status(400).json({ error: 'winner must be "asker" or "verifier"' });
    return;
  }

  try {
    const outcome = await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT d.id, d.status, d.question_id, d.task_id,
                q.asker_id, q.bounty_kobo
           FROM disputes d JOIN questions q ON q.id = d.question_id
          WHERE d.id = $1
          FOR UPDATE OF d`,
        [req.params.id],
      );
      const dispute = rows[0];
      if (!dispute) return { error: 'not_found' as const };
      if (String(dispute.status).startsWith('resolved')) {
        return { error: 'already_resolved' as const };
      }

      await client.query(
        `UPDATE disputes
            SET status = $2::dispute_status, admin_note = $3, resolved_at = now()
          WHERE id = $1`,
        [
          dispute.id,
          winner === 'asker' ? 'resolved_asker' : 'resolved_verifier',
          typeof note === 'string' ? note.slice(0, 2000) : null,
        ],
      );

      if (winner === 'asker') {
        await client.query(
          `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, memo)
           VALUES ($1, 'refund', $2, $3, 'Dispute resolved for the asker')`,
          [dispute.asker_id, dispute.bounty_kobo, dispute.question_id],
        );
        await client.query(`UPDATE questions SET closed_at = now() WHERE id = $1`, [
          dispute.question_id,
        ]);
        if (dispute.task_id) {
          await client.query(`UPDATE tasks SET status = 'abandoned' WHERE id = $1`, [
            dispute.task_id,
          ]);
        }
      } else if (dispute.task_id) {
        await client.query(
          `UPDATE tasks SET status = 'confirmed', completed_at = now() WHERE id = $1`,
          [dispute.task_id],
        );
      }

      return { ok: true as const };
    });

    if ('error' in outcome) {
      res.status(outcome.error === 'not_found' ? 404 : 409).json({ error: outcome.error });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'failed' });
  }
});

/**
 * Deletes an account and everything hanging off it.
 *
 * Refused while money is held: the rows cascade away, but the naira behind a
 * hold is real and someone is owed it. Resolve the open jobs first.
 */
adminRouter.delete('/users/:id', async (req, res) => {
  const held = await one<{ held: number }>(
    `SELECT COALESCE(sum(amount_kobo), 0)::bigint AS held
       FROM wallet_entries w
       JOIN questions q ON q.id = w.question_id
      WHERE w.kind = 'hold' AND q.asker_id = $1 AND q.closed_at IS NULL`,
    [req.params.id],
  );

  if (held && held.held > 0) {
    res.status(409).json({
      error: 'money_held',
      detail: `₦${(held.held / 100).toLocaleString()} is still held on open questions.`,
    });
    return;
  }

  const removed = await one<{ id: string }>(
    `DELETE FROM users WHERE id = $1 RETURNING id`,
    [req.params.id],
  );
  if (!removed) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true, deleted: removed.id });
});

/**
 * The identity queue.
 *
 * Pending first: these are people who cannot take verified-only jobs until
 * somebody looks. Recently decided ones follow so a mistake can be spotted.
 */
adminRouter.get('/identity', async (_req, res) => {
  const rows = await query(
    `SELECT ic.id, ic.status::text, ic.nin, ic.submitted_name AS "submittedName",
            ic.verified_name AS "verifiedName", ic.rejection_reason AS "rejectionReason",
            ic.created_at AS "createdAt", ic.reviewed_at AS "reviewedAt",
            u.id AS "userId", u.email, p.username
       FROM identity_checks ic
       JOIN users u ON u.id = ic.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
      ORDER BY CASE ic.status WHEN 'pending' THEN 0 ELSE 1 END, ic.created_at DESC
      LIMIT 100`,
  );
  res.json({ checks: rows });
});

/**
 * Approves or rejects one check.
 *
 * Approving requires a name, because that name becomes the only one the app
 * will ever display for this person — the database constraint enforces the
 * same rule, so a reviewer cannot grant a shield that stands next to nothing.
 */
adminRouter.post('/identity/:id/decide', async (req, res) => {
  const { approve, verifiedName, reason } = req.body as {
    approve?: unknown;
    verifiedName?: unknown;
    reason?: unknown;
  };

  if (typeof approve !== 'boolean') {
    res.status(400).json({ error: 'approve must be true or false' });
    return;
  }

  const name = String(verifiedName ?? '').trim();
  if (approve && name.length < 3) {
    res.status(400).json({ error: 'name_required', detail: 'Enter the name on the NIN record.' });
    return;
  }

  const updated = await one<{ id: string }>(
    `UPDATE identity_checks
        SET status           = $2::identity_status,
            verified_name    = $3,
            rejection_reason = $4,
            reviewed_at      = now(),
            checked_at       = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [
      req.params.id,
      approve ? 'verified' : 'rejected',
      approve ? name.slice(0, 120) : null,
      approve ? null : String(reason ?? '').slice(0, 500) || null,
    ],
  );

  if (!updated) {
    res.status(409).json({ error: 'not_pending', detail: 'Already decided, or no such check.' });
    return;
  }
  res.json({ ok: true });
});

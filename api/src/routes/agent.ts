import { Router } from 'express';
import { authenticate } from '../auth.js';
import { authenticateAgent, mintKey } from '../agentAuth.js';
import { config, hasAgents } from '../config.js';
import { one, query, transaction } from '../db.js';
import { storage } from '../storage.js';
import { triage } from '../agentTriage.js';
import { LATEST_EVIDENCE, evidenceUrls } from '../evidenceSql.js';
import { notify, nearbyVerifiers } from '../push.js';

export const agentRouter: Router = Router();

/**
 * The door programs come through.
 *
 * Everything here resolves to the same questions, the same board and the same
 * verifiers the app uses. A job posted by an agent is indistinguishable from
 * one posted by a person by the time it reaches a phone, which is the point:
 * the network does not need a second half to serve machines.
 */

/** Off means gone, not "present but refusing". */
agentRouter.use((req, res, next) => {
  if (!hasAgents()) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
});

// ── Keys ────────────────────────────────────────────────────────────────────
// Minted by a signed-in person for their own account, so a key can only ever
// be created by somebody who could already do everything it permits.

agentRouter.post('/keys', authenticate, async (req, res) => {
  const name = String((req.body as { name?: unknown }).name ?? '').trim() || 'Untitled key';
  const { token, hint, hash } = mintKey();

  const row = await one<{ id: string; createdAt: Date }>(
    `INSERT INTO api_keys (user_id, name, token_hash, hint)
     VALUES ($1, $2, $3, $4) RETURNING id, created_at AS "createdAt"`,
    [req.user!.id, name.slice(0, 80), hash, hint],
  );

  res.status(201).json({
    id: row!.id,
    name,
    createdAt: row!.createdAt,
    /** Shown once. Nothing stores it, so it cannot be shown again. */
    token,
    warning: 'Copy this now. It is not recoverable.',
  });
});

agentRouter.get('/keys', authenticate, async (req, res) => {
  const rows = await query(
    `SELECT id, name, hint, created_at AS "createdAt",
            last_used_at AS "lastUsedAt", revoked_at AS "revokedAt"
       FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user!.id],
  );
  res.json({ keys: rows });
});

agentRouter.delete('/keys/:id', authenticate, async (req, res) => {
  const row = await one<{ id: string }>(
    `UPDATE api_keys SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [req.params.id, req.user!.id],
  );
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});

// ── Asking ──────────────────────────────────────────────────────────────────

/**
 * Answer a question about a physical place.
 *
 * Two outcomes, and choosing between them is the decision the agent exists to
 * make. Either somebody has already been and what they brought back still
 * answers this — in which case it returns at once, for a fraction of the price
 * — or nobody has, and a job goes on the board for a person to walk to.
 *
 * The caller does not choose. Letting an agent insist on a fresh trip would
 * make the cheap path decorative; letting it insist on the cached one would
 * let it publish stale evidence as current.
 */
agentRouter.post('/ask', authenticateAgent, async (req, res) => {
  const body = req.body as {
    question?: unknown;
    place?: unknown;
    area?: unknown;
    lat?: unknown;
    lng?: unknown;
    bountyNgn?: unknown;
    deadlineMinutes?: unknown;
  };

  const question = String(body.question ?? '').trim();
  const place = String(body.place ?? '').trim();

  if (question.length < 5) {
    res.status(400).json({ error: 'question_too_short', detail: 'Say what you want checked.' });
    return;
  }
  if (place.length < 2) {
    res.status(400).json({ error: 'place_required', detail: 'Name the place to check.' });
    return;
  }

  const bounty = Number(body.bountyNgn ?? 500);
  const deadlineMinutes = Number(body.deadlineMinutes ?? 60);
  if (!Number.isFinite(bounty) || bounty <= 0) {
    res.status(400).json({ error: 'bad_bounty' });
    return;
  }

  const verdict = await triage(question, place);

  /**
   * Somebody already answered this.
   *
   * Returned with its age and its evidence rather than as a bare string: an
   * agent acting on this is entitled to see what it is trusting and how old it
   * is, and a caller wanting a stricter freshness rule than ours can only
   * apply one if we say.
   */
  if (verdict.decision === 'reuse') {
    const { prior } = verdict;
    res.json({
      status: 'answered',
      source: 'cached',
      answer: prior.answer,
      because: verdict.because,
      costNgn: config.agents.cachedFeeKobo / 100,
      ageMinutes: prior.minutesOld,
      capturedFor: prior.question,
      evidenceKind: prior.evidenceKind,
      evidence: prior.evidenceKeys.map((k) => storage.urlFor(k)),
      questionId: prior.questionId,
    });
    return;
  }

  /**
   * Nobody has been, so this becomes a job.
   *
   * Dispatched immediately against a ledger hold, rather than waiting on an
   * on-chain fund() the way the app does. That difference is not a shortcut,
   * it is a missing capability: funding pulls USDC with an EIP-3009
   * authorisation signed by the asker's wallet, and that signature is produced
   * inside Privy by an authenticated person. An API key cannot make one.
   *
   * Closing the gap means server-side signing through Privy's delegated
   * actions, after which this path funds on chain like any other. Until then
   * the hold is a real commitment against the key owner's ledger, and it is
   * the only one — worth knowing before pointing a stranger's agent at this.
   */
  const created = await transaction(async (client) => {
    const placeRow = await client.query<{ id: string }>(
      `INSERT INTO places (provider, name, area, state, lat, lng)
       VALUES ('agent', $1, $2, NULL, $3, $4) RETURNING id`,
      [
        place,
        typeof body.area === 'string' && body.area.trim() ? body.area.trim() : null,
        Number.isFinite(Number(body.lat)) ? Number(body.lat) : null,
        Number.isFinite(Number(body.lng)) ? Number(body.lng) : null,
      ],
    );

    const q = await client.query<{ id: string }>(
      `INSERT INTO questions
         (asker_id, body, place_id, bounty_kobo, visibility, deadline_minutes,
          verified_only, dispatched_at, asked_by_key)
       VALUES ($1, $2, $3, $4, 'public', $5, FALSE, now(), $6)
       RETURNING id`,
      [
        req.user!.id,
        question,
        placeRow.rows[0]!.id,
        Math.round(bounty * 100),
        Math.round(deadlineMinutes),
        req.apiKeyId!,
      ],
    );

    await client.query(
      `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, memo)
       VALUES ($1, 'hold', $2, $3, $4)`,
      [
        req.user!.id,
        Math.round(bounty * 100),
        q.rows[0]!.id,
        `Held for an agent: ${question.slice(0, 60)}`,
      ],
    );

    return q.rows[0]!.id;
  });

  res.status(201).json({
    status: 'dispatched',
    source: 'dispatched',
    because: verdict.because,
    id: created,
    costNgn: bounty,
    deadlineMinutes: Math.round(deadlineMinutes),
    poll: `/agent/ask/${created}`,
  });

  // The same alert the app's own questions raise, so an agent's job reaches
  // the same phones rather than sitting on a board nobody was told about.
  void (async () => {
    for (const userId of await nearbyVerifiers(created)) {
      await notify({
        userId,
        kind: 'job',
        title: 'A job near you',
        body: `${question.slice(0, 60)} · ₦${Math.round(bounty)}`,
        href: `/task/${created}`,
      });
    }
  })();
});

/**
 * What came back, if anything has.
 *
 * Polled rather than pushed: an agent is a program somewhere with no address
 * this server can reach, and a webhook would be a second delivery path to keep
 * working before either is used in anger.
 */
agentRouter.get('/ask/:id', authenticateAgent, async (req, res) => {
  const row = await one<{
    question: string;
    placeName: string | null;
    status: string | null;
    answer: string | null;
    evidenceKeys: string[] | null;
    evidenceKind: string | null;
    distanceMetres: number | null;
    capturedAt: Date | null;
    submittedAt: Date | null;
    verifier: string | null;
  }>(
    `SELECT q.body AS question, p.name AS "placeName",
            t.status::text AS status, a.body AS answer,
            e.keys AS "evidenceKeys", e.kind::text AS "evidenceKind",
            e.distance_metres AS "distanceMetres", e.captured_at AS "capturedAt",
            t.submitted_at AS "submittedAt", v.username AS verifier
       FROM questions q
       LEFT JOIN places p   ON p.id = q.place_id
       LEFT JOIN tasks t    ON t.question_id = q.id
       LEFT JOIN profiles v ON v.user_id = t.verifier_id
       LEFT JOIN LATERAL (
         SELECT body FROM answers WHERE task_id = t.id ORDER BY submitted_at DESC LIMIT 1
       ) a ON TRUE
       ${LATEST_EVIDENCE}
      WHERE q.id = $1 AND q.asker_id = $2`,
    [req.params.id, req.user!.id],
  );

  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const done = row.status === 'submitted' || row.status === 'confirmed';

  res.json({
    status: done ? 'answered' : row.status === 'accepted' ? 'in_progress' : 'waiting',
    question: row.question,
    place: row.placeName,
    answer: done ? row.answer : null,
    evidence: evidenceUrls(row.evidenceKeys),
    evidenceKind: row.evidenceKind,
    metresFromPlace: row.distanceMetres,
    capturedAt: row.capturedAt,
    answeredAt: row.submittedAt,
    verifier: row.verifier,
  });
});

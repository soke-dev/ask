import { Router } from 'express';
import { config, hasAgents } from '../config.js';
import { one, query, transaction } from '../db.js';
import { resolveKey } from '../agentAuth.js';
import { triage } from '../agentTriage.js';
import { storage } from '../storage.js';
import { LATEST_EVIDENCE, evidenceUrls } from '../evidenceSql.js';
import { notify, nearbyVerifiers } from '../push.js';
import { DEMO_PAGE } from '../demoPage.js';

export const demoRouter: Router = Router();

/**
 * The public demonstration.
 *
 * Everything else on this server is reached with a credential. This is the one
 * surface somebody can open with nothing — no account, no key, no app — and
 * watch the agent decide, and if it decides somebody must go, actually send
 * them.
 *
 * Which is the whole difficulty. A job posted from a page anybody can open is
 * a real job: real money leaves a real balance and a real person may walk
 * somewhere for it. So this spends from one account against a ceiling, allows
 * one job per visitor, and says plainly when it will not spend any more. The
 * alternative — a demo that only pretends to dispatch — would be the one lie
 * that makes the entire claim worthless.
 */

/** One job per visitor, so a single caller cannot drain the budget. */
const POSTED = new Map<string, number>();
const ONE_PER_MS = 30 * 60 * 1000;

/** Trimmed whenever it is read, so it cannot grow without bound. */
function alreadyPosted(ip: string): boolean {
  const now = Date.now();
  for (const [k, t] of POSTED) if (now - t > ONE_PER_MS) POSTED.delete(k);
  return POSTED.has(ip);
}

function callerIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.ip ?? 'unknown';
}

demoRouter.use((_req, res, next) => {
  if (!hasAgents()) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
});

/**
 * The page itself.
 *
 * Served before the JSON routes so a judge who opens the bare URL lands on
 * something rather than a 404 explaining nothing.
 */
demoRouter.get('/', (_req, res) => {
  res.type('html').send(DEMO_PAGE);
});

/** What is left to spend, so the page can say before somebody tries. */
async function budget(): Promise<{ spentKobo: number; leftKobo: number; jobsLeft: number }> {
  const row = await one<{ kobo: string }>(
    `SELECT COALESCE(SUM(q.bounty_kobo), 0)::bigint AS kobo
       FROM questions q
       JOIN api_keys k ON k.id = q.asked_by_key
      WHERE k.token_hash IS NOT NULL AND q.asked_by_key IS NOT NULL
        AND k.name = 'demo'`,
  );
  const spent = Number(row?.kobo ?? 0);
  const left = Math.max(0, config.agents.demoBudgetKobo - spent);
  return {
    spentKobo: spent,
    leftKobo: left,
    jobsLeft: Math.floor(left / config.agents.demoBountyKobo),
  };
}

demoRouter.get('/budget', async (_req, res) => {
  res.json({
    ...(await budget()),
    bountyKobo: config.agents.demoBountyKobo,
    configured: config.agents.demoKey.length > 0,
  });
});

/**
 * Ask the agent, from the page.
 *
 * The judgment runs for everybody — it costs nothing and is the thing worth
 * seeing. Only the dispatch half is rationed, because only that half spends.
 */
demoRouter.post('/ask', async (req, res) => {
  const body = req.body as { question?: unknown; place?: unknown; lat?: unknown; lng?: unknown };
  const question = String(body.question ?? '').trim().slice(0, 200);
  const place = String(body.place ?? '').trim().slice(0, 120);

  if (question.length < 5 || place.length < 2) {
    res.status(400).json({ error: 'need_question_and_place' });
    return;
  }

  const at =
    Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng))
      ? { lat: Number(body.lat), lng: Number(body.lng) }
      : null;

  const verdict = await triage(question, place, at);

  if (verdict.decision === 'reuse') {
    const { prior } = verdict;
    res.json({
      status: 'answered',
      source: 'cached',
      because: verdict.because,
      answer: prior.answer,
      askedAs: prior.question,
      ageMinutes: prior.minutesOld,
      verifier: prior.verifier,
      proof: prior.evidenceKind,
      evidence: prior.evidenceKeys.map((k) => storage.urlFor(k)),
      questionId: prior.questionId,
      costNgn: config.agents.cachedFeeKobo / 100,
    });
    return;
  }

  // ── From here it spends ───────────────────────────────────────────────────

  const key = config.agents.demoKey;
  if (!key) {
    res.json({ status: 'would_dispatch', because: verdict.because, reason: 'no_demo_key' });
    return;
  }

  const money = await budget();
  if (money.jobsLeft < 1) {
    res.json({ status: 'would_dispatch', because: verdict.because, reason: 'budget_spent' });
    return;
  }

  const ip = callerIp(req as never);
  if (alreadyPosted(ip)) {
    res.json({ status: 'would_dispatch', because: verdict.because, reason: 'already_posted' });
    return;
  }

  const owner = await resolveKey(key);
  if (!owner) {
    res.json({ status: 'would_dispatch', because: verdict.because, reason: 'bad_demo_key' });
    return;
  }

  const bountyKobo = config.agents.demoBountyKobo;

  const created = await transaction(async (client) => {
    const placeRow = await client.query<{ id: string }>(
      `INSERT INTO places (provider, name, area, state, lat, lng)
       VALUES ('demo', $1, NULL, NULL, $2, $3) RETURNING id`,
      [place, at?.lat ?? null, at?.lng ?? null],
    );

    const q = await client.query<{ id: string }>(
      `INSERT INTO questions
         (asker_id, body, place_id, bounty_kobo, visibility, deadline_minutes,
          verified_only, dispatched_at, asked_by_key)
       VALUES ($1, $2, $3, $4, 'public', 60, FALSE, now(), $5)
       RETURNING id`,
      [owner.userId, question, placeRow.rows[0]!.id, bountyKobo, owner.keyId],
    );

    await client.query(
      `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, memo)
       VALUES ($1, 'hold', $2, $3, $4)`,
      [owner.userId, bountyKobo, q.rows[0]!.id, `Demo: ${question.slice(0, 50)}`],
    );

    return q.rows[0]!.id;
  });

  POSTED.set(ip, Date.now());

  res.status(201).json({
    status: 'dispatched',
    source: 'dispatched',
    because: verdict.because,
    id: created,
    costNgn: bountyKobo / 100,
    jobsLeft: money.jobsLeft - 1,
    poll: `/demo/job/${created}`,
  });

  void (async () => {
    for (const userId of await nearbyVerifiers(created)) {
      await notify({
        userId,
        kind: 'job',
        title: 'A job near you',
        body: `${question.slice(0, 60)} · ₦${Math.round(bountyKobo / 100)}`,
        href: `/task/${created}`,
      });
    }
  })();
});

/**
 * Whether anybody has been yet.
 *
 * Unauthenticated, and only ever about jobs this page created — a visitor
 * should be able to watch their own job without an account, and should not be
 * able to read anybody else's by changing the id.
 */
demoRouter.get('/job/:id', async (req, res) => {
  const row = await one<{
    question: string;
    place: string | null;
    status: string | null;
    answer: string | null;
    evidenceKeys: string[] | null;
    evidenceKind: string | null;
    distanceMetres: number | null;
    capturedAt: Date | null;
    verifier: string | null;
  }>(
    `SELECT q.body AS question, p.name AS place, t.status::text AS status,
            a.body AS answer, e.keys AS "evidenceKeys", e.kind::text AS "evidenceKind",
            e.distance_metres AS "distanceMetres", e.captured_at AS "capturedAt",
            v.username AS verifier
       FROM questions q
       JOIN api_keys k      ON k.id = q.asked_by_key AND k.name = 'demo'
       LEFT JOIN places p   ON p.id = q.place_id
       LEFT JOIN tasks t    ON t.question_id = q.id
       LEFT JOIN profiles v ON v.user_id = t.verifier_id
       LEFT JOIN LATERAL (
         SELECT body FROM answers WHERE task_id = t.id ORDER BY submitted_at DESC LIMIT 1
       ) a ON TRUE
       ${LATEST_EVIDENCE}
      WHERE q.id = $1`,
    [req.params.id],
  );

  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const done = row.status === 'submitted' || row.status === 'confirmed';
  res.json({
    status: done ? 'answered' : row.status === 'accepted' ? 'in_progress' : 'waiting',
    question: row.question,
    place: row.place,
    answer: done ? row.answer : null,
    evidence: evidenceUrls(row.evidenceKeys),
    evidenceKind: row.evidenceKind,
    metresFromPlace: row.distanceMetres,
    capturedAt: row.capturedAt,
    verifier: row.verifier,
    proof: `/escrow/${req.params.id}/proof`,
  });
});

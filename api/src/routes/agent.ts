import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { verifyMessage } from 'viem';
import { authenticate } from '../auth.js';
import { authenticateAgent, mintKey } from '../agentAuth.js';
import { config, hasAgents } from '../config.js';
import { one, query, transaction } from '../db.js';
import { storage } from '../storage.js';
import { ago, knownFor, triage } from '../agentTriage.js';
import { LATEST_EVIDENCE, evidenceUrls } from '../evidenceSql.js';
import { notify, nearbyVerifiers } from '../push.js';
import { fundAsAgent } from '../agentWallet.js';

export const agentRouter: Router = Router();

/** Mirrors MIN_BOUNTY in constants/money.ts. What a job costs by default. */
const MIN_BOUNTY_NGN = 150;

/**
 * What the house will pay for, and how often.
 *
 * Anybody with a wallet can mint a key, so these jobs are strangers spending
 * our USDC. ₦300 is twice the floor — enough for a harder errand, nowhere near
 * enough to be worth farming — and five a day is enough to build against and
 * try properly.
 *
 * None of it applies to an agent funding its own job. That is their money, and
 * the only reason to limit somebody spending their own money would be to make
 * ours look generous by comparison.
 */
const MAX_HOUSE_BOUNTY_NGN = 300;
const HOUSE_JOBS_PER_DAY = 5;

/**
 * Counts one house-funded job and says whether it was allowed, in one
 * statement — two requests arriving together would otherwise both read the
 * same count and both be allowed, which is the cheapest way to make a limit
 * not a limit.
 */
async function claimHouseJob(userId: string): Promise<boolean> {
  const row = await one<{ allowed: boolean }>(
    `INSERT INTO ai_usage (user_id, day, kind, used)
     VALUES ($1, CURRENT_DATE, 'agent_job', 1)
     ON CONFLICT (user_id, day, kind)
       DO UPDATE SET used = ai_usage.used + 1
     RETURNING (used <= $2) AS allowed`,
    [userId, HOUSE_JOBS_PER_DAY],
  );
  return row?.allowed ?? false;
}

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

/**
 * A key for somebody who has a wallet and no account.
 *
 * The other way to mint one needs a Privy token, which needs the app, which
 * needs an install — so "agents can call this" was true only for people who
 * had already become users of a consumer app about walking to places. That is
 * the wrong bar for a developer pointing a program at an API.
 *
 * A wallet is the credential this audience already carries. Sign a sentence,
 * get a key. No email, no password, nothing to remember and nothing for us to
 * store on their behalf.
 *
 * It is also where funding has to end up. A key bound to an address is a key
 * that can one day pay for its own jobs from that address, rather than
 * spending its owner's balance.
 */

/** Issued nonces, so a signature cannot be replayed. */
const CHALLENGES = new Map<string, { nonce: string; expires: number }>();
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function challengeFor(address: string): string {
  const now = Date.now();
  for (const [k, v] of CHALLENGES) if (v.expires < now) CHALLENGES.delete(k);

  const nonce = randomBytes(16).toString('hex');
  CHALLENGES.set(address.toLowerCase(), { nonce, expires: now + CHALLENGE_TTL_MS });
  return nonce;
}

/**
 * What gets signed.
 *
 * Readable in a wallet prompt, and specific enough that a signature collected
 * for something else cannot be replayed here: it names this service, this
 * address and a nonce that is used once.
 */
function messageFor(address: string, nonce: string): string {
  return [
    'Confam — create an API key',
    '',
    'Sign this to create an API key for your agent.',
    'This does not move any funds and costs no gas.',
    '',
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
  ].join('\n');
}

agentRouter.post('/keys/challenge', (req, res) => {
  const address = String((req.body as { address?: unknown }).address ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: 'bad_address' });
    return;
  }
  const nonce = challengeFor(address);
  res.json({ address, nonce, message: messageFor(address, nonce) });
});

agentRouter.post('/keys/wallet', async (req, res) => {
  const body = req.body as { address?: unknown; signature?: unknown; name?: unknown };
  const address = String(body.address ?? '').trim();
  const signature = String(body.signature ?? '').trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !signature.startsWith('0x')) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  const issued = CHALLENGES.get(address.toLowerCase());
  if (!issued || issued.expires < Date.now()) {
    res.status(400).json({ error: 'no_challenge', detail: 'Ask for a challenge first.' });
    return;
  }

  const ok = await verifyMessage({
    address: address as `0x${string}`,
    message: messageFor(address, issued.nonce),
    signature: signature as `0x${string}`,
  }).catch(() => false);

  if (!ok) {
    res.status(401).json({ error: 'bad_signature' });
    return;
  }

  // Spent whether or not the rest succeeds, so one signature is one attempt.
  CHALLENGES.delete(address.toLowerCase());

  /**
   * The wallet is the account.
   *
   * Found rather than always created: somebody who already has a Confam
   * account with this address gets keys against it, so an agent and its owner
   * share one balance and one history rather than quietly becoming two people.
   *
   * Stored lower-cased, because the column requires it —
   * `wallet_address ~ '^0x[0-9a-f]{40}$'` — and every wallet hands back a
   * checksummed, mixed-case string. The reply keeps the caller's casing, which
   * is what they will compare against.
   */
  const stored = address.toLowerCase();
  const name = String(body.name ?? '').trim().slice(0, 80) || `Wallet ${address.slice(0, 8)}`;
  const { token, hint, hash } = mintKey();

  /**
   * Caught, because Express 4 does not await a handler.
   *
   * An unhandled rejection here does not fail the request — it ends the
   * process. A malformed address reaching the database took the whole API down
   * while this was being written, and a judge finding that edge at three in the
   * morning would take the demo down with it.
   */
  try {
    const existing = await one<{ id: string }>(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [stored],
    );

    const userId =
      existing?.id ??
      (
        await one<{ id: string }>(
          `INSERT INTO users (wallet_address) VALUES ($1) RETURNING id`,
          [stored],
        )
      )?.id;

    if (!userId) {
      res.status(500).json({ error: 'could_not_create' });
      return;
    }

    await query(
      `INSERT INTO api_keys (user_id, name, token_hash, hint) VALUES ($1, $2, $3, $4)`,
      [userId, name, hash, hint],
    );
  } catch (error) {
    console.warn('[agent] wallet key failed —', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'could_not_create' });
    return;
  }

  res.status(201).json({
    address,
    name,
    token,
    warning: 'Copy this now. It is not recoverable.',
    usage: {
      ask: 'POST /agent/ask',
      poll: 'GET /agent/ask/:id',
      header: 'Authorization: Bearer <token>',
    },
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

/**
 * Does the network already know this?
 *
 * The same judgment /ask makes, exposed to the app rather than to a program,
 * and answering the question a person is about to spend ₦500 on. Signed in
 * with Privy, because the caller here is somebody holding a phone.
 *
 * This is what the app's own cached-answer path was always meant to be. It
 * shipped as `findCachedAnswer`, searching a hardcoded empty array — so the
 * screen behind it, tipping and all, has never once been shown to anybody.
 *
 * Nothing is charged and nothing is committed. It reports what exists; the
 * decision to take it or send somebody anyway stays with the person.
 */
agentRouter.post('/check', authenticate, async (req, res) => {
  const body = req.body as {
    question?: unknown;
    place?: unknown;
    lat?: unknown;
    lng?: unknown;
  };
  const question = String(body.question ?? '').trim();
  const place = String(body.place ?? '').trim();
  /**
   * Where the place is, when the picker knew.
   *
   * Carried because names are not stable — the same junction comes back as
   * "Etete" or "Etete Road" depending on what was typed, and matching on the
   * name alone answered the same question two different ways minutes apart.
   */
  const at =
    Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng))
      ? { lat: Number(body.lat), lng: Number(body.lng) }
      : null;

  if (question.length < 3 || place.length < 2) {
    res.json({ known: false });
    return;
  }

  const verdict = await triage(question, place, at);
  if (verdict.decision !== 'reuse') {
    res.json({ known: false, because: verdict.because });
    return;
  }

  const { prior } = verdict;
  const name = prior.verifier ?? 'A verifier';

  res.json({
    known: true,
    because: verdict.because,
    answer: {
      id: prior.questionId,
      placeName: prior.placeName,
      area: prior.area ?? '',
      answer: prior.answer,
      // What it was originally asked for, so somebody can see whether the
      // match is as good as we think it is rather than taking our word.
      detail: `Asked as “${prior.question}”`,
      proof: prior.evidenceKind ?? 'photo',
      confirmed: prior.confirmed,
      ageHours: Math.max(0, Math.round(prior.minutesOld / 60)),
      ageMinutes: prior.minutesOld,
      // Said in words, because "0h ago" for something twenty minutes old is
      // both wrong and the case that matters most.
      ageLabel: ago(prior.minutesOld),
      verifierName: name,
      verifierInitials: name.slice(0, 2).toUpperCase(),
      visibility: 'public',
      evidence: prior.evidenceKeys.map((k) => storage.urlFor(k)),
    },
  });
});

/**
 * What the network already holds for a place.
 *
 * Answered before anybody commits to anything, so somebody can see whether
 * this place is covered at all before deciding it is worth ₦500. Coverage was
 * invisible until after you had asked, which made every question a guess about
 * whether the network had ever been there.
 *
 * No judgment and no model — there is no question yet to weigh anything
 * against. This is inventory, not a decision.
 */
agentRouter.get('/known', authenticate, async (req, res) => {
  const place = typeof req.query.place === 'string' ? req.query.place.trim() : '';
  if (place.length < 2) {
    res.json({ place: '', count: 0, answers: [] });
    return;
  }

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const at = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  const answers = await knownFor(place, at);

  res.json({
    place,
    count: answers.length,
    answers: answers.map((a) => ({
      id: a.questionId,
      question: a.question,
      answer: a.answer,
      ageLabel: ago(a.minutesOld),
      ageMinutes: a.minutesOld,
      verifier: a.verifier,
      confirmed: a.confirmed,
      proof: a.evidenceKind,
      evidence: a.evidenceKeys.map((k) => storage.urlFor(k)),
    })),
  });
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
    /** True when the caller will fund the escrow from their own wallet. */
    selfFund?: unknown;
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

  /**
   * ₦150 unless the caller asks for more.
   *
   * It defaulted to ₦500, which meant an agent that omitted the field spent
   * three times the floor without ever choosing to — and since anybody with a
   * wallet can now mint a key, that is somebody else's default spending this
   * wallet. The floor is what a job costs unless a caller decides otherwise.
   */
  const bounty = Number(body.bountyNgn ?? MIN_BOUNTY_NGN);
  const deadlineMinutes = Number(body.deadlineMinutes ?? 60);
  if (!Number.isFinite(bounty) || bounty < MIN_BOUNTY_NGN) {
    res.status(400).json({
      error: 'bad_bounty',
      detail: `A job pays at least ₦${MIN_BOUNTY_NGN}.`,
    });
    return;
  }

  /**
   * Who is paying for this one.
   *
   * `selfFund` means the caller signs the escrow authorisation from their own
   * wallet, so nothing here is spending ours and none of the house limits
   * apply. Otherwise we pay, and the limits do.
   */
  const selfFund = body.selfFund === true;

  if (!selfFund && bounty > MAX_HOUSE_BOUNTY_NGN) {
    res.status(400).json({
      error: 'over_house_limit',
      detail: `We fund up to ₦${MAX_HOUSE_BOUNTY_NGN} a job. Pass selfFund:true and sign the escrow yourself to pay more.`,
    });
    return;
  }

  const at =
    Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng))
      ? { lat: Number(body.lat), lng: Number(body.lng) }
      : null;

  const verdict = await triage(question, place, at);

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
   * Counted before the job exists, not after.
   *
   * Charging the allowance on success would let a failing dispatch be retried
   * without limit, which is the loop the limit exists to bound. Only
   * house-funded jobs count: an agent paying for its own is not spending an
   * allowance we granted.
   */
  if (!selfFund && !(await claimHouseJob(req.user!.id))) {
    res.status(429).json({
      error: 'daily_limit',
      detail: `We fund ${HOUSE_JOBS_PER_DAY} jobs a key a day. Pass selfFund:true and sign the escrow yourself for more.`,
      because: verdict.because,
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

  /**
   * Locked on Base by whoever is paying.
   *
   * House-funded goes straight through from the agent wallet, the same as the
   * demo — an agent's job and a person's job are the same job by the time a
   * verifier sees it, and they are the same on chain too.
   *
   * Self-funded stops here and hands back the standard escrow flow. Nothing
   * bespoke: the caller quotes, signs with their own wallet and submits,
   * exactly as the app does, using the same two endpoints with the same key
   * they already hold. We do not need their private key and will not have it.
   */
  const funded = selfFund
    ? null
    : await fundAsAgent(created, Math.round(bounty * 100));

  res.status(201).json({
    status: 'dispatched',
    source: 'dispatched',
    because: verdict.because,
    id: created,
    costNgn: bounty,
    deadlineMinutes: Math.round(deadlineMinutes),
    poll: `/agent/ask/${created}`,
    paidBy: selfFund ? 'you' : 'confam',
    chain: funded
      ? funded.ok
        ? { funded: true, txHash: funded.txHash, usdc: funded.usdc, chainId: config.chain.chainId }
        : { funded: false, why: funded.reason }
      : {
          funded: false,
          why: 'self_fund',
          /**
           * Said in the response, because a job on the board that nobody has
           * funded is the one state worth acting on quickly — a verifier can
           * see it and walk before the money is locked.
           */
          fund: {
            quote: `POST /escrow/${created}/fund/quote`,
            submit: `POST /escrow/${created}/fund`,
            note: 'Sign the returned typedData with the wallet your key is bound to, then submit the signature.',
          },
        },
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

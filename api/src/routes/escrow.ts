import { keccak256, toHex } from 'viem';
import { Router } from 'express';
import { authenticate } from '../auth.js';
import { one, query, transaction } from '../db.js';
import { notify, nearbyVerifiers } from '../push.js';
import { hasEscrow } from '../config.js';
import { ngnRate } from '../rates.js';
import {
  claimPayload,
  disputePayload,
  fundPayload,
  jobIdFor,
  randomSalt,
  readJob,
  relayClaim,
  relayDispute,
  relayFund,
  relayRefund,
  relayRelease,
  releasePayload,
} from '../escrow.js';

export const escrowRouter: Router = Router();

/** Long enough to read and approve, short enough that a stale one expires. */
const AUTH_TTL_SECONDS = 15 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the question id before it reaches a query or a job id.
 *
 * Express only guarantees the parameter is present, not that it is a UUID —
 * and `jobIdFor` parses it as hex, so a malformed one would produce a garbage
 * job id rather than an error anybody could act on.
 */
function questionIdOf(value: string | undefined): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/**
 * Each step is two calls: one that hands back what to sign, one that relays
 * the signature.
 *
 * The payload is always built here rather than in the app, so the amount, the
 * job and the recipient are fixed by the server. A client that assembled its
 * own could sign something other than what it displayed.
 */

escrowRouter.get('/status', authenticate, (_req, res) => {
  res.json({ available: hasEscrow() });
});

// ─── Funding ────────────────────────────────────────────────────────────────

escrowRouter.post('/:questionId/fund/quote', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const user = req.user!;
  if (!hasEscrow()) {
    res.status(503).json({ error: 'escrow_unconfigured' });
    return;
  }
  if (!user.walletAddress) {
    res.status(400).json({ error: 'no_wallet' });
    return;
  }

  const q = await one<{
    bountyKobo: number;
    deadlineMinutes: number;
    chainJobId: string | null;
    fundSalt: string | null;
    fundUsdc: string | null;
  }>(
    `SELECT bounty_kobo AS "bountyKobo", deadline_minutes AS "deadlineMinutes",
            chain_job_id AS "chainJobId", fund_salt AS "fundSalt",
            fund_usdc AS "fundUsdc"
       FROM questions WHERE id = $1 AND asker_id = $2`,
    [questionId, user.id],
  );

  if (!q) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (q.chainJobId) {
    res.status(409).json({ error: 'already_funded' });
    return;
  }

  const jobId = jobIdFor(questionId);
  // Reuse the salt if one was already issued, so a retry after a failed relay
  // produces the same nonce rather than orphaning the first signature.
  const salt = (q.fundSalt as `0x${string}` | null) ?? randomSalt();
  const validBefore = Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS;
  const deadline = Math.floor(Date.now() / 1000) + q.deadlineMinutes * 60;

  /**
   * Naira in, USDC out — converted once, here.
   *
   * A bounty is priced in naira and escrowed in USDC. Passing the naira figure
   * straight through meant ₦500 was funded as 500 USDC: a thousand times the
   * intended amount, which reverted as "transfer amount exceeds balance".
   *
   * Reused on a retry rather than recomputed, because the nonce is
   * keccak(jobId, amount, salt) — a rate that moved between two attempts would
   * change the amount, change the nonce, and invalidate the signature.
   */
  let usdc: number;
  let usedRate: number | null = null;

  if (q.fundUsdc !== null) {
    usdc = Number(q.fundUsdc);
  } else {
    const rate = await ngnRate();
    if (!rate) {
      res.status(503).json({
        error: 'no_rate',
        detail: 'The exchange rate is unavailable, so this cannot be priced yet.',
      });
      return;
    }
    usedRate = rate.ngnPerUsd;
    // Six decimals is all USDC can represent; rounding up by one unit avoids
    // escrowing a hair less than the bounty promised.
    usdc = Math.ceil((q.bountyKobo / 100 / rate.ngnPerUsd) * 1e6) / 1e6;
  }

  await query(
    `UPDATE questions
        SET fund_salt = $2,
            fund_usdc = COALESCE(fund_usdc, $3),
            fund_rate = COALESCE(fund_rate, $4)
      WHERE id = $1`,
    [questionId, salt, usdc, usedRate],
  );

  const { typedData } = fundPayload({
    jobId,
    asker: user.walletAddress,
    usdc,
    validBefore,
    salt,
  });

  res.json({ jobId, salt, deadline, validBefore, usdc, typedData });
});

escrowRouter.post('/:questionId/fund', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const user = req.user!;
  const { signature, deadline, validBefore } = req.body as Record<string, unknown>;

  if (typeof signature !== 'string') {
    res.status(400).json({ error: 'missing_signature' });
    return;
  }

  const q = await one<{
    bountyKobo: number;
    fundSalt: string | null;
    chainJobId: string | null;
    fundUsdc: string | null;
    body: string;
  }>(
    `SELECT bounty_kobo AS "bountyKobo", fund_salt AS "fundSalt",
            chain_job_id AS "chainJobId", fund_usdc AS "fundUsdc", body
       FROM questions WHERE id = $1 AND asker_id = $2`,
    [questionId, user.id],
  );

  if (!q?.fundSalt || q.fundUsdc === null) {
    res.status(409).json({ error: 'no_quote', detail: 'Ask for a quote first.' });
    return;
  }
  if (q.chainJobId) {
    res.status(409).json({ error: 'already_funded' });
    return;
  }

  const jobId = jobIdFor(questionId);

  try {
    const result = await relayFund({
      jobId,
      asker: user.walletAddress!,
      // The amount the quote fixed. Recomputing it here would break the nonce.
      usdc: Number(q.fundUsdc),
      deadline: Number(deadline),
      salt: q.fundSalt as `0x${string}`,
      validBefore: Number(validBefore),
      signature,
    });

    /**
     * Funded — so now it becomes a job, and now the ledger records the hold.
     *
     * Both in one transaction with the chain reference. A question marked
     * dispatched without its hold shows money still in the wallet that is
     * actually in escrow; a hold without dispatch takes the money and
     * advertises nothing.
     *
     * The deadline starts here rather than at creation: the clock a verifier
     * races is the one that began when the bounty became real.
     */
    await transaction(async (client) => {
      await client.query(
        `UPDATE questions
            SET chain_job_id = $2, fund_tx = $3, dispatched_at = COALESCE(dispatched_at, now())
          WHERE id = $1`,
        [questionId, jobId, result.txHash],
      );
      await client.query(
        `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, memo)
         VALUES ($1, 'hold', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        // Names the question. "Locked in escrow" alone told somebody scanning
        // a list of identical rows nothing about which one this was.
        [user.id, q.bountyKobo, questionId, `Held for: ${q.body.slice(0, 80)}`],
      );
    });

    res.json({ ok: true, jobId, txHash: result.txHash });

    /**
     * The job is only real once the money is locked, so this is where the
     * board is told — not when the question was typed.
     *
     * Everybody who asked for nearby alerts and is not the asker. Sent one at
     * a time rather than as one broadcast because each row is also written to
     * that person's own feed, and the two surfaces have to agree.
     */
    void (async () => {
      const audience = await nearbyVerifiers(questionId);
      for (const userId of audience) {
        await notify({
          userId,
          kind: 'job',
          title: 'A job near you',
          body: `${q.body.slice(0, 60)} · ₦${Math.round(q.bountyKobo / 100)}`,
          href: `/task/${questionId}`,
        });
      }
    })();
  } catch (error) {
    res.status(502).json({
      error: 'fund_failed',
      detail: error instanceof Error ? error.message : 'Could not fund the job.',
    });
  }
});

// ─── Claiming ───────────────────────────────────────────────────────────────

escrowRouter.post('/:questionId/claim/quote', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const user = req.user!;
  const evidence = String((req.body as { evidence?: unknown }).evidence ?? '');

  const q = await one<{ chainJobId: string | null }>(
    `SELECT chain_job_id AS "chainJobId" FROM questions WHERE id = $1`,
    [questionId],
  );
  if (!q?.chainJobId) {
    res.status(409).json({ error: 'not_funded', detail: 'This job is not on chain.' });
    return;
  }
  if (!user.walletAddress) {
    res.status(400).json({ error: 'no_wallet' });
    return;
  }

  // Hashing whatever identifies the evidence — the storage key, or the answer
  // text when there is no file. What matters is that it is fixed before a
  // dispute, not that it is reversible.
  const evidenceHash = keccak256(toHex(evidence || questionId));

  res.json({
    jobId: q.chainJobId,
    evidenceHash,
    typedData: claimPayload(q.chainJobId as `0x${string}`, user.walletAddress, evidenceHash),
  });
});

escrowRouter.post('/:questionId/claim', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const user = req.user!;
  const { signature, evidenceHash } = req.body as Record<string, unknown>;

  if (typeof signature !== 'string' || typeof evidenceHash !== 'string') {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const q = await one<{ chainJobId: string | null }>(
    `SELECT chain_job_id AS "chainJobId" FROM questions WHERE id = $1`,
    [questionId],
  );
  if (!q?.chainJobId) {
    res.status(409).json({ error: 'not_funded' });
    return;
  }

  try {
    const result = await relayClaim(
      q.chainJobId as `0x${string}`,
      user.walletAddress!,
      evidenceHash as `0x${string}`,
      signature,
    );

    await query(
      `UPDATE tasks SET claim_tx = $2, evidence_hash = $3
        WHERE question_id = $1 AND verifier_id = $4`,
      [questionId, result.txHash, evidenceHash, user.id],
    );

    res.json({ ok: true, txHash: result.txHash });
  } catch (error) {
    res.status(502).json({
      error: 'claim_failed',
      detail: error instanceof Error ? error.message : 'Could not record the claim.',
    });
  }
});

// ─── Releasing ──────────────────────────────────────────────────────────────

escrowRouter.post('/:questionId/release/quote', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const job = await one<{ chainJobId: string | null; verifierWallet: string | null }>(
    `SELECT q.chain_job_id AS "chainJobId", u.wallet_address AS "verifierWallet"
       FROM questions q
       LEFT JOIN tasks t ON t.question_id = q.id
       LEFT JOIN users u ON u.id = t.verifier_id
      WHERE q.id = $1 AND q.asker_id = $2`,
    [questionId, req.user!.id],
  );

  if (!job?.chainJobId) {
    res.status(409).json({ error: 'not_funded' });
    return;
  }
  if (!job.verifierWallet) {
    res.status(409).json({ error: 'no_verifier', detail: 'Nobody has claimed this yet.' });
    return;
  }

  res.json({
    jobId: job.chainJobId,
    typedData: releasePayload(job.chainJobId as `0x${string}`, job.verifierWallet),
  });
});

escrowRouter.post('/:questionId/release', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const signature = String((req.body as { signature?: unknown }).signature ?? '');
  if (!signature) {
    res.status(400).json({ error: 'missing_signature' });
    return;
  }

  const job = await one<{ chainJobId: string | null }>(
    `SELECT chain_job_id AS "chainJobId" FROM questions WHERE id = $1 AND asker_id = $2`,
    [questionId, req.user!.id],
  );
  if (!job?.chainJobId) {
    res.status(409).json({ error: 'not_funded' });
    return;
  }

  /**
   * The contract must know who to pay before it can pay them.
   *
   * A job whose verifier is still the zero address was never claimed on chain
   * — the verifier submitted their answer but their signature did not land.
   * release() reverts on it, and the revert message says nothing useful, so
   * the reason is checked here and stated plainly instead.
   */
  const chainJob = await readJob(job.chainJobId as `0x${string}`);
  if (chainJob && /^0x0+$/.test(chainJob.verifier)) {
    res.status(409).json({
      error: 'no_claim_on_chain',
      detail:
        'The verifier has not signed for this job yet, so the contract has nobody to pay. ' +
        'Ask them to open it and sign, or wait for the deadline and take a refund.',
    });
    return;
  }

  try {
    const result = await relayRelease(job.chainJobId as `0x${string}`, signature);
    await query(`UPDATE questions SET release_tx = $2 WHERE id = $1`, [
      questionId,
      result.txHash,
    ]);
    res.json({ ok: true, txHash: result.txHash });
  } catch (error) {
    res.status(502).json({
      error: 'release_failed',
      detail: error instanceof Error ? error.message : 'Could not release payment.',
    });
  }
});

// ─── Refund and dispute ─────────────────────────────────────────────────────

/**
 * Refunds an expired job. Needs no signature — the contract enforces the
 * deadline itself, and the money can only go back to the recorded asker.
 */
escrowRouter.post('/:questionId/refund', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const job = await one<{ chainJobId: string | null }>(
    `SELECT chain_job_id AS "chainJobId" FROM questions WHERE id = $1 AND asker_id = $2`,
    [questionId, req.user!.id],
  );
  if (!job?.chainJobId) {
    res.status(409).json({ error: 'not_funded' });
    return;
  }

  try {
    const result = await relayRefund(job.chainJobId as `0x${string}`);
    await query(`UPDATE questions SET refund_tx = $2 WHERE id = $1`, [
      questionId,
      result.txHash,
    ]);
    res.json({ ok: true, txHash: result.txHash });
  } catch (error) {
    res.status(502).json({
      error: 'refund_failed',
      detail: error instanceof Error ? error.message : 'Could not refund.',
    });
  }
});

escrowRouter.post('/:questionId/dispute/quote', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const job = await one<{ chainJobId: string | null }>(
    `SELECT chain_job_id AS "chainJobId" FROM questions WHERE id = $1`,
    [questionId],
  );
  if (!job?.chainJobId || !req.user!.walletAddress) {
    res.status(409).json({ error: 'not_funded' });
    return;
  }
  res.json({
    typedData: disputePayload(job.chainJobId as `0x${string}`, req.user!.walletAddress),
  });
});

escrowRouter.post('/:questionId/dispute', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const signature = String((req.body as { signature?: unknown }).signature ?? '');
  const job = await one<{ chainJobId: string | null }>(
    `SELECT chain_job_id AS "chainJobId" FROM questions WHERE id = $1`,
    [questionId],
  );
  if (!job?.chainJobId || !signature) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  try {
    const result = await relayDispute(
      job.chainJobId as `0x${string}`,
      req.user!.walletAddress!,
      signature,
    );
    res.json({ ok: true, txHash: result.txHash });
  } catch (error) {
    res.status(502).json({
      error: 'dispute_failed',
      detail: error instanceof Error ? error.message : 'Could not raise the dispute.',
    });
  }
});

/** The chain's view of a job, for reconciling against ours. */
escrowRouter.get('/:questionId/job', authenticate, async (req, res) => {
  const questionId = questionIdOf(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ error: 'bad_question_id' });
    return;
  }
  const job = await one<{ chainJobId: string | null }>(
    `SELECT chain_job_id AS "chainJobId" FROM questions WHERE id = $1`,
    [questionId],
  );
  if (!job?.chainJobId) {
    res.json({ job: null });
    return;
  }
  res.json({ job: await readJob(job.chainJobId as `0x${string}`) });
});

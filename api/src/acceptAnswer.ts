import { one, transaction } from './db.js';
import { releaseAsAgent } from './agentWallet.js';
import { notify } from './push.js';

/**
 * Paying the person who walked there.
 *
 * This was written twice before it was written here: once in the agent's
 * accept route and once in the settlement sweep, and a third copy was about to
 * go into the terminal's own accept. The route that has it right says why that
 * is a bad idea — "two ways of recording one payment would eventually
 * disagree, and the ledger is what decides who was actually paid" — so the
 * three callers now share one.
 *
 * The accounting is the app's own confirm, exactly: the whole bounty as an
 * earning, the platform's cut as a separate fee against the same person.
 *
 * The ledger is written before the chain. A release that fails leaves money in
 * escrow, which is recoverable and visible; a ledger that says nothing while
 * the chain has paid out is neither. Both halves are reported, because the
 * second can fail while the first stands, and a verifier owed money with
 * nothing released is a state somebody has to be able to see.
 */

export type AcceptResult =
  | { ok: true; already: true }
  | {
      ok: true;
      already: false;
      verifier: string | null;
      paidKobo: number;
      feeKobo: number;
      released: { ok: true; txHash: string } | { ok: false; why: string };
    }
  | { ok: false; error: 'not_found' | 'nothing_submitted'; detail: string };

type Job = {
  taskId: string;
  verifierId: string;
  bountyKobo: number;
  taskStatus: string;
  verifier: string | null;
};

/**
 * @param questionId the question whose answer is being accepted
 * @param memo       what the ledger entry should say it was
 * @param askerId    when given, the question must belong to them
 */
export async function acceptAnswer(
  questionId: string,
  memo: string,
  askerId?: string,
): Promise<AcceptResult> {
  const job = await one<Job>(
    `SELECT t.id AS "taskId", t.verifier_id AS "verifierId",
            q.bounty_kobo AS "bountyKobo", t.status::text AS "taskStatus",
            p.username AS verifier
       FROM questions q
       JOIN tasks t ON t.question_id = q.id
       LEFT JOIN profiles p ON p.user_id = t.verifier_id
      WHERE q.id = $1
        AND ($2::uuid IS NULL OR q.asker_id = $2)`,
    [questionId, askerId ?? null],
  );

  if (!job) {
    return { ok: false, error: 'not_found', detail: 'Not your job, or nobody took it.' };
  }
  if (job.taskStatus === 'confirmed') return { ok: true, already: true };
  if (job.taskStatus !== 'submitted') {
    return { ok: false, error: 'nothing_submitted', detail: 'No answer has come back yet.' };
  }

  const feeKobo = Math.round(job.bountyKobo * 0.1);
  const paidKobo = job.bountyKobo - feeKobo;

  await transaction(async (client) => {
    await client.query(
      `UPDATE tasks SET status = 'confirmed', completed_at = now() WHERE id = $1`,
      [job.taskId],
    );
    await client.query(`UPDATE questions SET closed_at = now() WHERE id = $1`, [questionId]);
    await client.query(
      `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, memo)
       VALUES ($1, 'earning', $2, $3, $4)`,
      [job.verifierId, job.bountyKobo, questionId, memo],
    );
    await client.query(
      `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, memo)
       VALUES ($1, 'fee', $2, $3, 'Platform fee')`,
      [job.verifierId, feeKobo, questionId],
    );
  });

  const released = await releaseAsAgent(questionId);
  if (!released.ok) {
    console.warn('[accept] paid on the ledger but not released —', questionId, released.reason);
  }

  void notify({
    userId: job.verifierId,
    kind: 'payment',
    title: 'You were paid',
    body: `Your answer was accepted. ${'₦'}${Math.round(paidKobo / 100)} is yours.`,
    href: '/(tabs)/you',
  });

  return {
    ok: true,
    already: false,
    verifier: job.verifier,
    paidKobo,
    feeKobo,
    released: released.ok
      ? { ok: true, txHash: released.txHash }
      : { ok: false, why: released.reason },
  };
}

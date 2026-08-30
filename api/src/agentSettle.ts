import { config } from './config.js';
import { query, transaction } from './db.js';
import { releaseAsAgent } from './agentWallet.js';
import { notify } from './push.js';

/**
 * Paying verifiers whose asker was a program that never came back.
 *
 * A person who asks a question opens the app, sees the answer and confirms it.
 * An agent has no such habit: it may poll once, get what it needed, and never
 * call accept — or, as happened here, be a throwaway key that no longer exists
 * at all. The evidence arrives, the money sits in escrow, and the verifier who
 * actually walked somewhere is left waiting for a decision nobody is going to
 * make.
 *
 * The app deliberately refuses to let an asker close a question after evidence
 * arrives, because that would be a free answer. That rule is right and it is
 * exactly what strands this: there is no path out for a job whose asker has
 * gone quiet.
 *
 * So agent-dispatched jobs settle themselves. After a grace period long enough
 * for a real agent to object, an unqueried answer is accepted and the verifier
 * is paid. The bias is deliberate: the person did the work and the evidence
 * passed the gate, so the default when nobody objects is that they are paid,
 * not that they wait indefinitely.
 *
 * Never touches a job asked from the app. A person is expected to answer for
 * themselves, and deciding on their behalf would be spending their money.
 */

/** How long an agent has to query an answer before it is accepted for them. */
const GRACE_MINUTES = 15;

/** Between sweeps. Nothing here is urgent; it only has to happen. */
const EVERY_MS = 5 * 60 * 1000;

type Pending = {
  id: string;
  taskId: string;
  verifierId: string;
  bountyKobo: number;
  body: string;
};

export async function settleAgentJobs(): Promise<number> {
  const due = await query<Pending>(
    `SELECT q.id, t.id AS "taskId", t.verifier_id AS "verifierId",
            q.bounty_kobo AS "bountyKobo", q.body
       FROM questions q
       JOIN tasks t     ON t.question_id = q.id
       JOIN api_keys k  ON k.id = q.asked_by_key
      WHERE t.status = 'submitted'
        AND t.submitted_at < now() - ($1 || ' minutes')::interval
        AND q.closed_at IS NULL
        /*
         * A queried answer is somebody else's decision to make. Settling one
         * would pay out the very thing under dispute.
         */
        AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.question_id = q.id)`,
    [GRACE_MINUTES],
  );

  let settled = 0;

  for (const job of due) {
    try {
      // The same accounting the app's confirm uses: the whole bounty as an
      // earning, the platform's cut as a separate fee against the same person.
      const feeKobo = Math.round(job.bountyKobo * 0.1);
      const payoutKobo = job.bountyKobo - feeKobo;

      await transaction(async (client) => {
        await client.query(
          `UPDATE tasks SET status = 'confirmed', completed_at = now() WHERE id = $1`,
          [job.taskId],
        );
        await client.query(`UPDATE questions SET closed_at = now() WHERE id = $1`, [job.id]);
        await client.query(
          `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, memo)
           VALUES ($1, 'earning', $2, $3, 'Answer accepted — the agent did not query it')`,
          [job.verifierId, job.bountyKobo, job.id],
        );
        await client.query(
          `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, memo)
           VALUES ($1, 'fee', $2, $3, 'Platform fee')`,
          [job.verifierId, feeKobo, job.id],
        );
      });

      /**
       * The ledger first, the chain after.
       *
       * A release that fails leaves money in escrow, which is recoverable and
       * visible. A ledger that says nothing while the chain has paid out is
       * neither.
       */
      const released = await releaseAsAgent(job.id);
      if (!released.ok) {
        console.warn('[settle] paid on the ledger but not released —', job.id, released.reason);
      }

      settled += 1;

      void notify({
        userId: job.verifierId,
        kind: 'payment',
        title: 'You were paid',
        body: `Nobody queried your answer, so it was accepted. ₦${Math.round(payoutKobo / 100)} is yours.`,
        href: '/(tabs)/you',
      });
    } catch (error) {
      console.warn('[settle] could not settle', job.id, '—', error instanceof Error ? error.message : error);
    }
  }

  if (settled > 0) console.log(`[settle] accepted ${settled} unqueried agent answer(s)`);
  return settled;
}

/** Starts the sweep. Returns a stop function, so a test can end it. */
export function startAgentSettlement(): () => void {
  if (!config.agents.enabled) return () => {};

  // Run once shortly after boot, so a restart clears anything that piled up
  // while the process was down, then settle into the interval.
  const first = setTimeout(() => void settleAgentJobs().catch(() => {}), 20_000);
  const timer = setInterval(() => void settleAgentJobs().catch(() => {}), EVERY_MS);

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

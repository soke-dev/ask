import { query } from './db.js';

/**
 * Questions that were written down but never paid for.
 *
 * With an escrow contract configured, a new question is deliberately held back:
 * `dispatched_at` stays null until fund() confirms, so nobody walks anywhere
 * for a bounty that was never committed. That rule is right, and it leaves a
 * hole. If the funding call never lands — the network drops between creating
 * the question and signing for it, the app is closed on the signature, the
 * relay fails — the row stays behind: undispatched, unfunded, and open.
 *
 * It is invisible on every screen, which is why it went unnoticed, and it is
 * not harmless. Creating a question counts what has been promised but not yet
 * locked against the asker's available USDC, precisely so two questions in
 * quick succession cannot both pass the check. An abandoned draft therefore
 * holds down that allowance permanently, and the person it happens to sees
 * their spending limit shrink for no reason they can see.
 *
 * Nothing has to be reversed to clear one. On the escrow path the ledger hold
 * is written when fund() confirms, so a draft that never funded owes nobody
 * anything: closing the row is the whole of it.
 */

/**
 * How long a question may sit unfunded before it is treated as abandoned.
 *
 * Funding is a signature and a relayed transaction, which is seconds when it
 * works. Half an hour is far longer than that and still short enough that
 * somebody who tries again the same day is not blocked by their own mistake.
 */
const ABANDONED_AFTER = '30 minutes';

/** Between sweeps. Nothing here is urgent; it only has to happen. */
const EVERY_MS = 10 * 60 * 1000;

export async function closeAbandonedDrafts(): Promise<number> {
  const closed = await query<{ id: string }>(
    `UPDATE questions
        SET closed_at = now()
      WHERE dispatched_at IS NULL
        AND chain_job_id IS NULL
        AND closed_at IS NULL
        AND created_at < now() - $1::interval
        /*
         * Belt and braces. Neither can exist without a chain job id on this
         * path, but closing a question somebody has actually worked on would
         * be far worse than leaving a stale row behind.
         */
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.question_id = questions.id)
        AND NOT EXISTS (SELECT 1 FROM wallet_entries w WHERE w.question_id = questions.id)
      RETURNING id`,
    [ABANDONED_AFTER],
  );

  if (closed.length > 0) {
    console.log(`[drafts] closed ${closed.length} question(s) that were never funded`);
  }
  return closed.length;
}

/** Starts the sweep. Returns a stop function, so a test can end it. */
export function startAbandonedSweep(): () => void {
  const first = setTimeout(() => void closeAbandonedDrafts().catch(() => {}), 30_000);
  const timer = setInterval(() => void closeAbandonedDrafts().catch(() => {}), EVERY_MS);

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

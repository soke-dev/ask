/**
 * Finds bounties stranded in the escrow contract and, on request, sends them
 * back to the asker.
 *
 * Closing a question refunded the ledger and never called the on-chain refund
 * — nothing in the app called it — so every question ever closed left its USDC
 * in the contract while the app told the asker they had their money back. This
 * recovers those. The app no longer creates them.
 *
 * Reports by default. Pass --apply to actually move anything.
 *
 *   npx tsx sweep-refunds.mts
 *   npx tsx sweep-refunds.mts --apply
 */
import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { readJob, relayRefund } from './src/escrow.js';
import { query } from './src/db.js';
import { config } from './src/config.js';

const apply = process.argv.includes('--apply');
const pc = createPublicClient({ chain: base, transport: http(config.chain.rpcUrl) });

/** Funded, never claimed, never refunded — money the contract is still holding. */
const rows = await query<{
  id: string;
  body: string;
  chainJobId: string | null;
  fundUsdc: string | null;
  asker: string | null;
}>(
  `SELECT q.id, left(q.body, 30) AS body, q.chain_job_id AS "chainJobId",
          q.fund_usdc AS "fundUsdc", a.username AS asker
     FROM questions q
     LEFT JOIN profiles a ON a.user_id = q.asker_id
     LEFT JOIN tasks t ON t.question_id = q.id
    WHERE q.fund_tx IS NOT NULL
      AND q.refund_tx IS NULL
      AND t.claim_tx IS NULL
    ORDER BY q.created_at`,
);

console.log(`${rows.length} question(s) with money still in the contract\n`);
const block = await pc.getBlock();
const chainNow = Number(block.timestamp);

let recoverable = 0;
let held = 0;

for (const row of rows) {
  const label = `  ${String(row.asker ?? '?').padEnd(10)} ${row.body}`;

  if (!row.chainJobId) {
    console.log(`${label}\n     no chain job id — funded off-chain or never linked`);
    continue;
  }

  const job = await readJob(row.chainJobId as `0x${string}`);
  if (!job) {
    console.log(`${label}\n     not found on chain`);
    continue;
  }

  held += Number(job.amountUsdc);
  const left = job.deadline - chainNow;

  if (left > 0) {
    console.log(`${label}\n     ${job.amountUsdc} USDC · status ${job.status} · refundable in ${left}s`);
    continue;
  }

  recoverable += Number(job.amountUsdc);
  console.log(`${label}\n     ${job.amountUsdc} USDC · status ${job.status} · REFUNDABLE NOW`);

  if (!apply) continue;

  try {
    const result = await relayRefund(row.chainJobId as `0x${string}`);
    await query(`UPDATE questions SET refund_tx = $2 WHERE id = $1`, [row.id, result.txHash]);
    console.log(`     refunded — ${result.txHash}`);
  } catch (error) {
    console.log(`     FAILED — ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n  held in contract : ${held.toFixed(6)} USDC`);
console.log(`  refundable now   : ${recoverable.toFixed(6)} USDC`);
if (!apply && recoverable > 0) console.log('\n  re-run with --apply to send it back.');
process.exit(0);

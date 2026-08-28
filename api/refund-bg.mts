import 'dotenv/config';
import { readJob, relayRefund } from './src/escrow.js';
import { query } from './src/db.js';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { config } from './src/config.js';

const jobId = '0xbd2056da7a3c562d293378c7c16fe3a2ddb52bd4be456f69915ab550e8ae8737' as `0x${string}`;
const pc = createPublicClient({ chain: base, transport: http(config.chain.rpcUrl) });

const job = await readJob(jobId);
if (!job) { console.log('job not found'); process.exit(1); }
if (job.status !== 'funded') { console.log('already settled:', job.status); process.exit(0); }

for (;;) {
  const block = await pc.getBlock();
  const left = job.deadline - Number(block.timestamp);
  if (left <= 0) break;
  console.log(`waiting ${left}s for the deadline`);
  await new Promise((r) => setTimeout(r, Math.min(left + 5, 90) * 1000));
}

const result = await relayRefund(jobId);
console.log('REFUNDED tx', result.txHash, 'gas', result.gasEth, 'ETH');
console.log('chain now:', (await readJob(jobId))?.status);

await query(`UPDATE questions SET refund_tx = $2 WHERE chain_job_id = $1`, [jobId, result.txHash]);
const q = await query<{ id: string; asker_id: string; bounty_kobo: number }>(
  `SELECT id, asker_id, bounty_kobo FROM questions WHERE chain_job_id = $1`, [jobId]);
if (q[0]) {
  await query(
    `INSERT INTO wallet_entries (user_id, kind, amount_kobo, question_id, tx_hash, log_index, memo)
     VALUES ($1,'refund',$2,$3,$4,0,'Refunded — the job was never claimed on chain')
     ON CONFLICT (tx_hash, log_index) WHERE tx_hash IS NOT NULL DO NOTHING`,
    [q[0].asker_id, q[0].bounty_kobo, q[0].id, result.txHash],
  );
  console.log('ledger recorded');
}
process.exit(0);

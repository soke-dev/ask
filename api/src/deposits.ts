import { config } from './config.js';
import { incomingUsdc, latestBlock, type IncomingTransfer } from './chain.js';
import { one, query, transaction } from './db.js';
import { ngnRate } from './rates.js';

/**
 * Finds USDC that arrived on Base and writes it into the ledger.
 *
 * Nothing in this app initiates a top-up — somebody sends from a wallet or an
 * exchange we know nothing about — so a deposit only exists once the chain has
 * been read and the result written down. The chain stays the authority for the
 * *balance*; this exists so the balance has a history to explain it.
 */
export type SyncResult = {
  scannedTo: number;
  found: number;
  inserted: number;
  /** True when more blocks remain than one sync would read. */
  moreToScan: boolean;
};

export async function syncDeposits(userId: string, address: string): Promise<SyncResult> {
  const head = await latestBlock();

  const user = await one<{ scanBlock: string | null }>(
    `SELECT deposit_scan_block AS "scanBlock" FROM users WHERE id = $1`,
    [userId],
  );

  /**
   * Where to start.
   *
   * A first scan looks back a bounded window rather than to the genesis block:
   * these wallets are created by us, minutes before their first use, so older
   * deposits cannot exist — and proving it would be thousands of requests
   * against a free RPC.
   *
   * Later scans resume one block *before* the last one finished. Overlapping
   * by a block costs nothing because inserts are idempotent, and it removes
   * the off-by-one where a transfer in the boundary block is never seen.
   */
  const resumeFrom = user?.scanBlock
    ? Math.max(0, Number(user.scanBlock) - 1)
    : Math.max(0, head - config.chain.firstScanBlocks);

  const chunk = config.chain.logChunk;
  const maxBlocks = chunk * config.chain.maxChunksPerSync;
  const ceiling = Math.min(head, resumeFrom + maxBlocks);

  const transfers: IncomingTransfer[] = [];
  for (let from = resumeFrom; from <= ceiling; from += chunk) {
    const to = Math.min(from + chunk - 1, ceiling);
    transfers.push(...(await incomingUsdc(address, from, to)));
  }

  let inserted = 0;

  if (transfers.length > 0) {
    const rate = await ngnRate();

    await transaction(async (client) => {
      for (const t of transfers) {
        /**
         * Written in naira as well as USDC because `amount_kobo` is the column
         * every other flow sums. The rate used is stored alongside, so the
         * conversion can be checked later rather than being an unexplainable
         * number — and if no rate was available the row still lands, with the
         * naira value left at zero rather than invented.
         */
        const ngnPerUsd = rate?.ngnPerUsd ?? null;
        const kobo = ngnPerUsd ? Math.round(t.usdc * ngnPerUsd * 100) : 0;

        const result = await client.query(
          `INSERT INTO wallet_entries
             (user_id, kind, amount_kobo, amount_usdc, fx_rate, tx_hash, log_index,
              from_address, pending, memo, created_at)
           VALUES ($1, 'deposit', $2, $3, $4, $5, $6, $7, FALSE, $8, now())
           ON CONFLICT (tx_hash, log_index) WHERE tx_hash IS NOT NULL DO NOTHING`,
          [
            userId,
            // The CHECK requires a positive amount, and a sub-cent deposit
            // rounds to zero naira. One kobo is the smallest honest placeholder.
            Math.max(kobo, 1),
            t.usdc,
            ngnPerUsd,
            t.txHash,
            t.logIndex,
            t.from,
            `Top up · ${t.usdc} USDC`,
          ],
        );
        inserted += result.rowCount ?? 0;
      }
    });
  }

  await query(`UPDATE users SET deposit_scan_block = $2 WHERE id = $1`, [userId, ceiling]);

  return {
    scannedTo: ceiling,
    found: transfers.length,
    inserted,
    moreToScan: ceiling < head,
  };
}

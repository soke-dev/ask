import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { authenticate } from '../auth.js';
import { one, query } from '../db.js';
import { usdcBalanceOf } from '../chain.js';
import { ngnRate } from '../rates.js';
import { authorizationPayload, relayWithdrawal } from '../relayer.js';
import { config, hasGasWallet } from '../config.js';

export const withdrawRouter: Router = Router();

/** Long enough for a person to read and approve, short enough to expire. */
const AUTHORIZATION_TTL_SECONDS = 15 * 60;

const isAddress = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

/**
 * Step one: hand back the message to sign.
 *
 * The payload is built here rather than in the app so the recipient, the
 * amount and the expiry are all fixed by the server. A client that assembled
 * its own could sign something other than what it displayed.
 */
withdrawRouter.post('/quote', authenticate, async (req, res) => {
  const user = req.user!;
  const { to, usdc } = req.body as { to?: unknown; usdc?: unknown };

  if (!user.walletAddress) {
    res.status(400).json({ error: 'no_wallet' });
    return;
  }
  if (!hasGasWallet()) {
    res.status(503).json({
      error: 'relayer_unconfigured',
      detail: 'Withdrawals are not available yet.',
    });
    return;
  }
  if (!isAddress(to)) {
    res.status(400).json({ error: 'bad_address', detail: 'That is not a valid wallet address.' });
    return;
  }
  if (to.toLowerCase() === user.walletAddress.toLowerCase()) {
    res.status(400).json({ error: 'same_address', detail: 'That is this wallet.' });
    return;
  }

  const amount = Number(usdc);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'bad_amount' });
    return;
  }
  // USDC has six decimals; anything finer cannot be represented and would be
  // silently truncated into a different amount than the one displayed.
  if (Math.round(amount * 1e6) !== amount * 1e6) {
    res.status(400).json({ error: 'too_precise', detail: 'Up to six decimal places.' });
    return;
  }

  // Checked against the chain, not the ledger: the chain is what the transfer
  // will actually draw on.
  const balance = await usdcBalanceOf(user.walletAddress);
  if (amount > balance.usdc) {
    res.status(400).json({
      error: 'insufficient',
      detail: `You have $${balance.usdc.toFixed(2)} available.`,
    });
    return;
  }

  const nonce = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
  const validBefore = Math.floor(Date.now() / 1000) + AUTHORIZATION_TTL_SECONDS;

  await query(
    `INSERT INTO withdrawal_authorizations (nonce, user_id, to_address, amount_usdc, valid_before)
     VALUES ($1, $2, $3, $4, to_timestamp($5))`,
    [nonce, user.id, to.toLowerCase(), amount, validBefore],
  );

  res.json({
    nonce,
    validBefore,
    typedData: authorizationPayload({
      from: user.walletAddress,
      to: to.toLowerCase(),
      usdc: amount,
      nonce,
      validBefore,
    }),
  });
});

/**
 * Step two: relay the signed authorisation.
 *
 * Everything about the transfer comes from the stored quote, never from this
 * request — the client sends only the signature. A caller cannot ask to send a
 * different amount, or to a different address, than the one they were shown
 * and signed for.
 */
withdrawRouter.post('/submit', authenticate, async (req, res) => {
  const user = req.user!;
  const { nonce, signature } = req.body as { nonce?: unknown; signature?: unknown };

  if (typeof nonce !== 'string' || typeof signature !== 'string') {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const auth = await one<{
    toAddress: string;
    amountUsdc: string;
    validBefore: Date;
    status: string;
  }>(
    `SELECT to_address AS "toAddress", amount_usdc AS "amountUsdc",
            valid_before AS "validBefore", status
       FROM withdrawal_authorizations
      WHERE nonce = $1 AND user_id = $2`,
    [nonce, user.id],
  );

  if (!auth) {
    res.status(404).json({ error: 'unknown_authorization' });
    return;
  }
  if (auth.status !== 'issued') {
    res.status(409).json({ error: 'already_used', detail: 'That withdrawal was already sent.' });
    return;
  }
  if (auth.validBefore.getTime() < Date.now()) {
    res.status(410).json({ error: 'expired', detail: 'That took too long. Start again.' });
    return;
  }

  // Claimed before broadcasting, so two requests arriving together cannot both
  // reach the relayer. The row is the lock.
  const claimed = await one<{ nonce: string }>(
    `UPDATE withdrawal_authorizations SET status = 'submitted'
      WHERE nonce = $1 AND status = 'issued' RETURNING nonce`,
    [nonce],
  );
  if (!claimed) {
    res.status(409).json({ error: 'already_used' });
    return;
  }

  const amount = Number(auth.amountUsdc);

  try {
    const result = await relayWithdrawal({
      from: user.walletAddress!,
      to: auth.toAddress,
      usdc: amount,
      validBefore: Math.floor(auth.validBefore.getTime() / 1000),
      nonce: nonce as `0x${string}`,
      signature: signature as `0x${string}`,
    });

    const rate = await ngnRate();
    const kobo = rate ? Math.round(amount * rate.ngnPerUsd * 100) : 0;

    await query(
      `INSERT INTO wallet_entries
         (user_id, kind, amount_kobo, amount_usdc, fx_rate, tx_hash, log_index,
          to_address, gas_eth, pending, memo)
       VALUES ($1,'withdrawal',$2,$3,$4,$5,0,$6,$7,FALSE,$8)
       ON CONFLICT (tx_hash, log_index) WHERE tx_hash IS NOT NULL DO NOTHING`,
      [
        user.id,
        Math.max(kobo, 1),
        amount,
        rate?.ngnPerUsd ?? null,
        result.txHash,
        auth.toAddress,
        result.gasEth,
        `Withdrawn ${amount} USDC`,
      ],
    );

    await query(
      `UPDATE withdrawal_authorizations
          SET status = 'confirmed', tx_hash = $2, settled_at = now() WHERE nonce = $1`,
      [nonce, result.txHash],
    );

    res.json({ ok: true, txHash: result.txHash, usdc: amount, to: auth.toAddress });
  } catch (error) {
    // Released, not left claimed: a relay that never made it on chain must be
    // retryable, otherwise a transient RPC failure burns the authorisation.
    await query(`UPDATE withdrawal_authorizations SET status = 'issued' WHERE nonce = $1`, [
      nonce,
    ]);
    res.status(502).json({
      error: 'relay_failed',
      detail: error instanceof Error ? error.message : 'The transfer could not be sent.',
    });
  }
});

/** Whether withdrawals can run at all, for the app to check before offering. */
withdrawRouter.get('/status', authenticate, (_req, res) => {
  res.json({
    available: hasGasWallet(),
    chainId: config.chain.chainId,
  });
});

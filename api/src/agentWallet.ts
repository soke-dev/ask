import { privateKeyToAccount } from 'viem/accounts';
import { config, hasEscrow } from './config.js';
import { one, query } from './db.js';
import { ngnRate } from './rates.js';
import { fundPayload, jobIdFor, randomSalt, relayFund } from './escrow.js';

/**
 * The agent's own wallet, and the money that leaves it.
 *
 * A job dispatched by an agent used to be a row in the ledger and nothing
 * more. The app's jobs funded a real escrow on Base and an agent's did not,
 * which meant the sentence everybody wanted to say — the agent pays a human in
 * USDC — was true of the half nobody was looking at and false of the half on
 * the demonstration page.
 *
 * The reason was never the chain. Funding pulls USDC with an EIP-3009
 * authorisation signed by the asker, and the asker was a Privy wallet that
 * only a signed-in person could operate. An agent has no person. So it gets a
 * wallet of its own and signs with it here, which is the same thing the gas
 * relayer has always done — sign server-side and submit — pointed at a
 * different key.
 *
 * Nothing else changes. Same contract, same jobId derivation, same salt, same
 * relay. An escrow funded this way is indistinguishable on-chain from one a
 * person funded, which is the point: there is no agent-flavoured money.
 */

/** The address the agent pays from. Null when no key is configured. */
export function agentAddress(): `0x${string}` | null {
  const key = config.chain.agentWalletKey;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as `0x${string}`).address;
}

export const hasAgentWallet = () => agentAddress() !== null;

/** How long a signed authorisation stays valid. Mirrors the app's own. */
const AUTH_TTL_SECONDS = 30 * 60;

export type FundResult =
  | { ok: true; txHash: string; jobId: string; usdc: number }
  | { ok: false; reason: string };

/**
 * Locks the bounty for a question in the escrow, paying from the agent wallet.
 *
 * Deliberately returns rather than throws. A job that reached the board and
 * failed to fund is a real problem, but it is not a reason to fail the request
 * that created it — somebody may already be walking, and the honest thing is
 * to record that the money is not locked rather than to pretend the job never
 * happened.
 */
export async function fundAsAgent(questionId: string, bountyKobo: number): Promise<FundResult> {
  if (!hasEscrow()) return { ok: false, reason: 'no_escrow_configured' };

  const key = config.chain.agentWalletKey;
  const asker = agentAddress();
  if (!asker) return { ok: false, reason: 'no_agent_wallet' };

  const q = await one<{ deadlineMinutes: number; fundSalt: string | null }>(
    `SELECT deadline_minutes AS "deadlineMinutes", fund_salt AS "fundSalt"
       FROM questions WHERE id = $1`,
    [questionId],
  );
  if (!q) return { ok: false, reason: 'no_question' };

  const rate = await ngnRate();
  if (!rate) return { ok: false, reason: 'no_rate' };

  const jobId = jobIdFor(questionId);
  // Reused if one was already issued, so a retry after a failed relay signs
  // the same authorisation rather than a second one against the same job.
  const salt = (q.fundSalt as `0x${string}` | null) ?? randomSalt();
  const validBefore = Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS;
  const deadline = Math.floor(Date.now() / 1000) + q.deadlineMinutes * 60;

  // Rounded up at six decimals, the same way the app prices a bounty, so an
  // agent and a person asking the same question lock the same amount.
  const usdc = Math.ceil((bountyKobo / 100 / rate.ngnPerUsd) * 1e6) / 1e6;

  const { typedData } = fundPayload({ jobId, asker, usdc, validBefore, salt });

  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    const signature = await account.signTypedData(typedData as never);

    const result = await relayFund({
      jobId,
      asker,
      usdc,
      deadline,
      salt,
      validBefore,
      signature,
    });

    await query(
      `UPDATE questions
          SET chain_job_id = $2, fund_salt = $3,
              fund_usdc = COALESCE(fund_usdc, $4),
              fund_rate = COALESCE(fund_rate, $5)
        WHERE id = $1`,
      [questionId, jobId, salt, usdc, rate.ngnPerUsd],
    );

    return { ok: true, txHash: result.txHash, jobId, usdc };
  } catch (error) {
    /**
     * Logged loudly and reported, never swallowed.
     *
     * The commonest cause by far is the wallet having no USDC, and a demo that
     * silently stopped putting money on chain would look exactly like one that
     * never did.
     */
    const detail = error instanceof Error ? error.message : String(error);
    console.warn('[agent] could not fund on chain —', detail);
    return { ok: false, reason: detail.slice(0, 200) };
  }
}

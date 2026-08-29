import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { hasAgents } from './config.js';
import { one, query } from './db.js';
import { authenticate, type AuthedUser } from './auth.js';

/**
 * Who the caller is when the caller is a program.
 *
 * Privy issues short-lived tokens to phones, which is right for a person and
 * useless for an agent: there is no browser to redirect, no inbox to receive a
 * code, and nothing to refresh a token at three in the morning. So agents get
 * a long-lived key instead.
 *
 * What a key is *not* is a second kind of account. It resolves to a real user
 * and populates `req.user` exactly as Privy auth does, so every route beyond
 * this point is unchanged and an agent's job is funded from its owner's
 * wallet. The alternative — agents as their own principals — would need a
 * parallel identity, a parallel balance and a parallel escrow path, three
 * things to keep in step for no gain.
 */

/** Marks a key as ours on sight, in logs and in support conversations. */
const PREFIX = 'sk_confam_';

/**
 * Hashed, never stored raw.
 *
 * SHA-256 without a salt on purpose: the input is 32 bytes of CSPRNG output,
 * so there is no dictionary to attack and no user-chosen weakness to stretch
 * against. Bcrypt here would buy nothing and cost a slow hash on every
 * request an agent makes.
 */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type MintedKey = { token: string; hint: string; hash: string };

/** Makes a key. The plaintext is returned once and cannot be recovered after. */
export function mintKey(): MintedKey {
  const token = PREFIX + randomBytes(32).toString('base64url');
  return { token, hint: token.slice(0, PREFIX.length + 6), hash: hash(token) };
}

/**
 * Resolves a raw key to the user it acts for, without a request.
 *
 * For the demo, which holds a key in configuration rather than receiving one
 * in a header. Same lookup as the middleware so the two cannot disagree about
 * what a valid key is.
 */
export async function resolveKey(
  token: string,
): Promise<{ keyId: string; userId: string } | null> {
  if (!token.startsWith(PREFIX)) return null;
  const row = await one<{ id: string; userId: string; revokedAt: Date | null }>(
    `SELECT id, user_id AS "userId", revoked_at AS "revokedAt"
       FROM api_keys WHERE token_hash = $1`,
    [hash(token)],
  );
  if (!row || row.revokedAt) return null;
  return { keyId: row.id, userId: row.userId };
}

function bearer(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.startsWith(PREFIX) ? token : null;
}

/**
 * Resolves an API key to the user it acts for.
 *
 * Refuses outright when the agent surface is switched off, rather than
 * checking the flag in each route: a key that still worked while the feature
 * was disabled would make the switch a lie.
 */
export async function authenticateAgent(req: Request, res: Response, next: NextFunction) {
  if (!hasAgents()) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const token = bearer(req);
  if (!token) {
    res.status(401).json({
      error: 'no_key',
      detail: `Send an API key as "Authorization: Bearer ${PREFIX}…".`,
    });
    return;
  }

  const row = await one<{ id: string; userId: string; revokedAt: Date | null }>(
    `SELECT id, user_id AS "userId", revoked_at AS "revokedAt"
       FROM api_keys WHERE token_hash = $1`,
    [hash(token)],
  );

  /**
   * A revoked key is refused with the same status as an unknown one, but the
   * distinction is worth keeping in the reply: somebody whose key stopped
   * working needs to know whether they mistyped it or somebody withdrew it.
   */
  if (!row || row.revokedAt) {
    res.status(401).json({
      error: row ? 'key_revoked' : 'bad_key',
      detail: row ? 'That key was revoked.' : 'That key is not valid.',
    });
    return;
  }

  const user = await one<AuthedUser>(
    `SELECT u.id, u.privy_did AS "privyDid", u.email, u.wallet_address AS "walletAddress"
       FROM users u WHERE u.id = $1`,
    [row.userId],
  );
  if (!user) {
    res.status(401).json({ error: 'bad_key', detail: 'That key is not valid.' });
    return;
  }

  req.user = user;
  req.apiKeyId = row.id;

  /**
   * Recorded after the request is answered, not before.
   *
   * It is bookkeeping, and making an agent wait on a write it does not read
   * would put a round trip in front of every call for no benefit to anybody.
   */
  void query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {});

  next();
}

/**
 * A person or a program, whichever turned up.
 *
 * For the routes both need to reach. Funding an escrow is the clearest case:
 * the flow is identical whether a phone or an agent signs the authorisation —
 * same contract, same payload, same wallet-holder consenting — and the only
 * difference is which credential proved who is asking.
 *
 * Tries the API key first, because it is recognisable on sight from its
 * prefix. Anything else falls through to Privy, so an app request behaves
 * exactly as it did before this existed.
 */
export async function authenticateEither(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  if (header.toLowerCase().startsWith('bearer ') && header.slice(7).trim().startsWith(PREFIX)) {
    await authenticateAgent(req, res, next);
    return;
  }
  await authenticate(req, res, next);
}

/** Constant-time compare, for anywhere a key is checked outside the lookup. */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(hash(a));
  const y = Buffer.from(hash(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set when the caller is a program rather than a person. */
      apiKeyId?: string;
    }
  }
}

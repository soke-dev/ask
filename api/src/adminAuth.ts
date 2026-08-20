import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

/**
 * One shared password for the review desk.
 *
 * This is deliberately the weakest part of the system and worth being honest
 * about: one secret, no per-person accounts, so there is no way to tell who
 * refunded a job or deleted an account, and revoking access for one person
 * means changing it for everyone. It guards real user data and real money.
 * Before more than one person needs it, this should become per-admin logins.
 *
 * Given that, the parts that can be done properly are:
 *
 *   - the password is stored only as a scrypt hash, never in plaintext
 *   - comparison is constant-time, so timing cannot leak the value
 *   - failed attempts are rate-limited per IP, so it cannot be brute-forced
 *   - a successful login returns a short-lived signed token, so the password
 *     itself is sent once rather than on every request
 */

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // one working day
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

type Attempts = { count: number; firstAt: number };
const attempts = new Map<string, Attempts>();

/** scrypt hash, stored as `scrypt$<salt-hex>$<hash-hex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Signed token: `<expiry>.<hmac>`.
 *
 * Stateless on purpose — nothing to store, and a restart does not sign
 * everyone out mid-review. The HMAC key is the password hash itself, so
 * changing the password invalidates every existing token.
 */
function sign(expiry: number): string {
  const mac = createHmac('sha256', config.admin.passwordHash)
    .update(String(expiry))
    .digest('hex');
  return `${expiry}.${mac}`;
}

export function issueToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  return { token: sign(expiresAt), expiresAt };
}

function tokenValid(token: string): boolean {
  const [expiryRaw, mac] = token.split('.');
  if (!expiryRaw || !mac) return false;

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expected = sign(expiry);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Per-IP throttle. Returns the seconds left, or 0 when not locked out. */
export function lockoutRemaining(ip: string): number {
  const record = attempts.get(ip);
  if (!record) return 0;

  const elapsed = Date.now() - record.firstAt;
  if (elapsed > LOCKOUT_MS) {
    attempts.delete(ip);
    return 0;
  }
  if (record.count < MAX_ATTEMPTS) return 0;
  return Math.ceil((LOCKOUT_MS - elapsed) / 1000);
}

function recordFailure(ip: string): void {
  const record = attempts.get(ip);
  if (!record || Date.now() - record.firstAt > LOCKOUT_MS) {
    attempts.set(ip, { count: 1, firstAt: Date.now() });
    return;
  }
  record.count += 1;
}

export function attemptLogin(password: string, ip: string): { ok: boolean; detail?: string } {
  const locked = lockoutRemaining(ip);
  if (locked > 0) {
    return { ok: false, detail: `Too many attempts. Try again in ${Math.ceil(locked / 60)} min.` };
  }
  if (!config.admin.passwordHash) {
    return { ok: false, detail: 'No admin password is configured on this server.' };
  }
  if (!verifyPassword(password, config.admin.passwordHash)) {
    recordFailure(ip);
    return { ok: false, detail: 'Wrong password.' };
  }
  attempts.delete(ip);
  return { ok: true };
}

/** Guards every admin route. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-admin-token'];
  const token = typeof header === 'string' ? header : null;

  if (!token || !tokenValid(token)) {
    res.status(401).json({ error: 'admin_unauthorised' });
    return;
  }
  next();
}

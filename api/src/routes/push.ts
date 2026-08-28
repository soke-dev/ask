import { Router } from 'express';
import { authenticate } from '../auth.js';
import { query } from '../db.js';

export const pushRouter = Router();

/**
 * Records where to reach this account.
 *
 * Upserted on the token, not the user. The same device handed to a second
 * account must re-point rather than leave the first account being notified
 * about somebody else's jobs, and one account on two devices should ring on
 * both. `failed_at` is cleared on the way in, because a token we had written
 * off is alive again by definition if the app is registering it.
 */
pushRouter.post('/register', authenticate, async (req, res) => {
  const { token, platform } = req.body as { token?: unknown; platform?: unknown };

  if (typeof token !== 'string' || !token.startsWith('ExponentPushToken')) {
    res.status(400).json({ error: 'bad_token' });
    return;
  }

  await query(
    `INSERT INTO push_tokens (token, user_id, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, failed_at = NULL`,
    [token, req.user!.id, typeof platform === 'string' ? platform : null],
  );

  res.json({ ok: true });
});

/** Signing out on a device should stop it ringing for that account. */
pushRouter.post('/unregister', authenticate, async (req, res) => {
  const { token } = req.body as { token?: unknown };
  if (typeof token === 'string') {
    await query(`DELETE FROM push_tokens WHERE token = $1 AND user_id = $2`, [token, req.user!.id]);
  }
  res.json({ ok: true });
});

import { Router } from 'express';
import { authenticate } from '../auth.js';
import { one } from '../db.js';

export const identityRouter: Router = Router();

/**
 * Submits a NIN for review.
 *
 * Nothing is decided here. The row lands in a queue as `pending` and a person
 * approves or rejects it — there is no automatic path to `verified`, which is
 * the whole point: this replaces a client-side timer that granted verified
 * status to anyone who typed eleven digits.
 */
identityRouter.post('/submit', authenticate, async (req, res) => {
  const user = req.user!;
  const body = req.body as { nin?: unknown; fullName?: unknown };

  const nin = String(body.nin ?? '').replace(/\D/g, '');
  const fullName = String(body.fullName ?? '').trim();

  if (nin.length !== 11) {
    res.status(400).json({ error: 'nin_invalid', detail: 'A NIN is 11 digits.' });
    return;
  }
  if (fullName.length < 3) {
    res.status(400).json({ error: 'name_required', detail: 'Enter your name as it appears on your NIN.' });
    return;
  }

  const current = await one<{ status: string }>(
    `SELECT status FROM identity_checks
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [user.id],
  );

  if (current?.status === 'verified') {
    res.status(409).json({ error: 'already_verified' });
    return;
  }
  if (current?.status === 'pending') {
    res.status(409).json({ error: 'already_pending', detail: 'Your check is already in the queue.' });
    return;
  }

  const created = await one<{ id: string }>(
    `INSERT INTO identity_checks (user_id, status, method, nin, submitted_name)
     VALUES ($1, 'pending', 'nin', $2, $3)
     RETURNING id`,
    [user.id, nin, fullName.slice(0, 120)],
  );

  res.status(201).json({ ok: true, id: created?.id, status: 'pending' });
});

/** Where the app polls for the outcome. */
identityRouter.get('/status', authenticate, async (req, res) => {
  const row = await one<{
    status: string;
    verifiedName: string | null;
    rejectionReason: string | null;
  }>(
    `SELECT status, verified_name AS "verifiedName", rejection_reason AS "rejectionReason"
       FROM identity_checks
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [req.user!.id],
  );

  res.json({
    status: row?.status ?? 'unverified',
    name: row?.status === 'verified' ? row.verifiedName : null,
    reason: row?.status === 'rejected' ? row.rejectionReason : null,
  });
});

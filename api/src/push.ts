import { query } from './db.js';

/**
 * Notifying somebody, in both places at once.
 *
 * The app has two notification surfaces and they were drifting apart: an
 * in-app feed assembled by a UNION over questions, tasks, disputes and wallet
 * entries, and — from here — the phone's own notification centre. Anything
 * that writes to one and not the other produces a bell badge nobody sees, or a
 * push about something the app cannot show.
 *
 * So this module is the single place an event becomes a notification: it
 * writes the row *and* sends the push. Callers say what happened; they do not
 * decide which surfaces get told.
 */

/** Expo's push service. No key needed — the token is the credential. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo rejects batches larger than this. */
const BATCH = 100;

export type PushKind = 'job' | 'answer' | 'payment' | 'dispute';

type Notification = {
  userId: string;
  kind: PushKind;
  title: string;
  body: string;
  /** In-app route to open, e.g. `/tracking/<id>`. */
  href: string | null;
};

type ExpoTicket = {
  status: 'ok' | 'error';
  details?: { error?: string };
};

/**
 * Writes the notification and pushes it.
 *
 * Deliberately not awaited by callers on the request path — a person
 * confirming an answer should not wait on Expo's servers to find out whether
 * their own action worked. Failures are logged, never thrown: a push that does
 * not arrive must not roll back the thing it was announcing.
 */
export async function notify(n: Notification): Promise<void> {
  try {
    await query(
      `INSERT INTO notifications (user_id, kind, title, body, href)
       VALUES ($1, $2, $3, $4, $5)`,
      [n.userId, n.kind, n.title, n.body, n.href],
    );
  } catch (error) {
    console.warn('[push] could not record the notification —', message(error));
  }

  await send(n);
}

async function send(n: Notification): Promise<void> {
  const tokens = await query<{ token: string }>(
    `SELECT token FROM push_tokens WHERE user_id = $1 AND failed_at IS NULL`,
    [n.userId],
  );
  if (tokens.length === 0) return;

  for (let i = 0; i < tokens.length; i += BATCH) {
    const slice = tokens.slice(i, i + BATCH);

    const messages = slice.map((t) => ({
      to: t.token,
      title: n.title,
      body: n.body,
      sound: 'default',
      // Read by the app when the notification is tapped, to open the right
      // screen. Kept to the route because anything larger is a payload the
      // client would have to re-fetch anyway.
      data: { href: n.href, kind: n.kind },
    }));

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        console.warn('[push] expo returned', response.status);
        continue;
      }

      const body = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = body.data ?? [];

      /**
       * A dead token is retired, not retried.
       *
       * `DeviceNotRegistered` means the app was uninstalled or the token was
       * rotated. Left in the table it would be sent to on every future
       * notification forever, and Expo counts those against you.
       */
      const dead = slice
        .filter((_, index) => tickets[index]?.details?.error === 'DeviceNotRegistered')
        .map((t) => t.token);

      if (dead.length > 0) {
        await query(`UPDATE push_tokens SET failed_at = now() WHERE token = ANY($1)`, [dead]);
      }
    } catch (error) {
      console.warn('[push] could not send —', message(error));
    }
  }
}

/**
 * Everybody who asked for job alerts near a place, minus the asker.
 *
 * Paying somebody to check their own question is meaningless, and the board
 * already excludes it — so the alert must too, or the one person guaranteed
 * not to be able to take the job is the one most reliably told about it.
 */
export async function nearbyVerifiers(questionId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT p.user_id AS id
       FROM questions q
       JOIN places pl   ON pl.id = q.place_id
       JOIN profiles p  ON p.alert_jobs_nearby
       WHERE q.id = $1
         AND p.user_id <> q.asker_id
         AND (
           p.home_area IS NULL
           OR lower(concat_ws(' ', pl.name, pl.area, pl.state)) LIKE '%' || lower(p.home_area) || '%'
         )`,
    [questionId],
  );
  return rows.map((r) => r.id);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

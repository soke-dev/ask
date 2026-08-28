import OpenAI from 'openai';
import { config, hasVision } from './config.js';
import { one, query } from './db.js';

/**
 * Deciding whether a human has to walk.
 *
 * This is the whole of the agent. Everything else — keys, routes, escrow — is
 * plumbing around one judgment: somebody already went to this place and
 * photographed it, and the question now being asked may or may not be answered
 * by what they brought back.
 *
 * A string match cannot make that call. `/questions/cached` matched on place
 * name alone, so a verified answer about a road was offered to somebody asking
 * about a market, and the only safe thing to do with it was ignore it and send
 * a person. That is the state this replaces: every question costing a trip,
 * including the ones the network had already answered ten minutes earlier.
 *
 * Freshness is the interesting half, and it is genuinely a judgment rather
 * than a threshold. A flood from twenty minutes ago still holds. A fuel queue
 * from four hours ago does not. "Has the shop reopened" from yesterday is
 * worthless. No single `hoursOld` cutoff is right for all three, which is why
 * a model reads the pair rather than a constant comparing them.
 */

/**
 * How long ago, said the way a person would say it.
 *
 * The reason string is shown to somebody deciding whether to spend ₦500, and
 * "2018 minutes ago" makes them do arithmetic to find out it means yesterday.
 * Minutes are right up to about an hour and useless after that.
 */
export function ago(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * How far apart two picks can be and still count as the same place.
 *
 * Place names come from a geocoder and are not stable: the same junction comes
 * back as "Etete", "Etete Road" and "Etete Junction" depending on what was
 * typed, and matching on the name alone made those three different places. The
 * same question, minutes apart, then answered differently — which is worse
 * than not having the feature.
 *
 * 500m is a street and its junctions, not a district. Generous rather than
 * strict on purpose: whatever this lets through, the model still reads the old
 * question and can say it was about somewhere else. A radius that is slightly
 * too wide loses nothing; one that is too narrow silently hides evidence.
 */
const SAME_PLACE_METRES = 500;

/**
 * Matches on name, or on being near enough to be the same place.
 *
 * Haversine inline rather than PostGIS, which is not installed and would be a
 * large dependency for one comparison over a small table.
 */
const NEAR_PLACE = `(
    p.name ILIKE $1
    OR (
      $2::float8 IS NOT NULL AND p.lat IS NOT NULL AND p.lng IS NOT NULL
      AND 6371000 * acos(LEAST(1, GREATEST(-1,
            sin(radians($2::float8)) * sin(radians(p.lat))
          + cos(radians($2::float8)) * cos(radians(p.lat))
          * cos(radians(p.lng) - radians($3::float8))
      ))) <= ${SAME_PLACE_METRES}
    )
  )`;

export type At = { lat: number; lng: number } | null;

let client: OpenAI | null = null;
function vision(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: config.visionKey });
  return client;
}

export type PriorAnswer = {
  questionId: string;
  question: string;
  answer: string;
  placeName: string;
  area: string | null;
  minutesOld: number;
  evidenceKeys: string[];
  evidenceKind: 'photo' | 'video' | null;
  verifier: string | null;
  /** The asker who paid for it accepted it, rather than merely receiving it. */
  confirmed: boolean;
};

export type Triage =
  | { decision: 'reuse'; prior: PriorAnswer; because: string }
  | { decision: 'dispatch'; because: string };

const SYSTEM = `You decide whether an existing verified answer still answers a new question.

You are given a NEW question about a place, and an OLD question answered
nearby, with what somebody brought back and how long ago.

The two places are within a few hundred metres of each other, but they may not
be the same thing — "Etete Road" and "Etete Junction" usually are, while two
shops on one street are not.

Answer "reuse" only if ALL of these hold:
- the two places are the same thing, or close enough that the answer applies to
  both — a power cut covers a neighbourhood, a queue belongs to one shop
- the old answer actually addresses what the new question asks, not merely the
  same area
- it is still likely to be true right now, given how fast that kind of thing
  changes

Things change at very different speeds. Flooding, a power cut or a crowd holds
for tens of minutes. A queue, a price or whether somewhere is busy goes stale
within the hour. Opening hours, whether a shop still exists, or building work
hold for days.

When it is close, choose dispatch. Sending somebody costs money; giving back a
stale answer as though it were checked costs trust, and somebody may act on it.

Reply with JSON only:
{"decision":"reuse"|"dispatch","because":"<one short sentence, plain English>"}`;

/**
 * The most recent verified answer for a place, whatever it was about.
 *
 * Deliberately not filtered by question text: judging whether it is relevant is
 * the model's job, and a SQL LIKE that pre-filtered would throw away exactly
 * the cases worth reasoning about.
 */
export async function priorAnswerFor(placeName: string, at: At = null): Promise<PriorAnswer | null> {
  const row = await one<{
    questionId: string;
    question: string;
    answer: string;
    placeName: string;
    area: string | null;
    minutesOld: number;
    keys: string[] | null;
    kind: 'photo' | 'video' | null;
    verifier: string | null;
    confirmed: boolean;
  }>(
    `SELECT q.id AS "questionId", q.body AS question, a.body AS answer,
            p.name AS "placeName", p.area,
            EXTRACT(EPOCH FROM (now() - t.submitted_at)) / 60 AS "minutesOld",
            e.keys, e.kind,
            v.username AS verifier,
            (t.status = 'confirmed') AS confirmed
       FROM questions q
       JOIN tasks t   ON t.question_id = q.id
       JOIN answers a ON a.task_id = t.id
       LEFT JOIN places p   ON p.id = q.place_id
       LEFT JOIN profiles v ON v.user_id = t.verifier_id
       LEFT JOIN LATERAL (
         SELECT array_agg(storage_key ORDER BY created_at) AS keys,
                (array_agg(kind::text ORDER BY created_at))[1] AS kind
           FROM evidence
          WHERE task_id = t.id
            AND attempt IS NOT DISTINCT FROM
                (SELECT max(attempt) FROM evidence WHERE task_id = t.id)
       ) e ON TRUE
      WHERE ${NEAR_PLACE}
        AND t.status IN ('submitted', 'confirmed')
        AND t.submitted_at IS NOT NULL
        /*
         * Public answers only.
         *
         * Somebody who paid for an answer and kept it private did so on the
         * understanding that it stays unseen. Handing it to the next person
         * asking about that place — or to an agent — would break that quietly
         * and at scale, which is worse than breaking it loudly once.
         */
        AND q.visibility = 'public'
      ORDER BY t.submitted_at DESC
      LIMIT 1`,
    [placeName, at?.lat ?? null, at?.lng ?? null],
  );

  if (!row) return null;
  return {
    questionId: row.questionId,
    question: row.question,
    answer: row.answer,
    placeName: row.placeName,
    area: row.area,
    minutesOld: Math.round(Number(row.minutesOld)),
    evidenceKeys: Array.isArray(row.keys) ? row.keys : [],
    evidenceKind: row.kind,
    verifier: row.verifier,
    confirmed: Boolean(row.confirmed),
  };
}

/**
 * Everything the network holds for a place, newest first.
 *
 * No model, because there is no question yet to judge anything against. This
 * answers "has anybody been here lately", which is what somebody wants to know
 * before deciding whether asking is worth ₦500 — and which the app could not
 * tell them at all: coverage was invisible until after you committed.
 */
export async function knownFor(placeName: string, at: At = null, limit = 3): Promise<PriorAnswer[]> {
  const rows = await query<{
    questionId: string;
    question: string;
    answer: string;
    placeName: string;
    area: string | null;
    minutesOld: number;
    keys: string[] | null;
    kind: 'photo' | 'video' | null;
    verifier: string | null;
    confirmed: boolean;
  }>(
    `SELECT q.id AS "questionId", q.body AS question, a.body AS answer,
            p.name AS "placeName", p.area,
            EXTRACT(EPOCH FROM (now() - t.submitted_at)) / 60 AS "minutesOld",
            e.keys, e.kind, v.username AS verifier,
            (t.status = 'confirmed') AS confirmed
       FROM questions q
       JOIN tasks t   ON t.question_id = q.id
       JOIN answers a ON a.task_id = t.id
       LEFT JOIN places p   ON p.id = q.place_id
       LEFT JOIN profiles v ON v.user_id = t.verifier_id
       LEFT JOIN LATERAL (
         SELECT array_agg(storage_key ORDER BY created_at) AS keys,
                (array_agg(kind::text ORDER BY created_at))[1] AS kind
           FROM evidence
          WHERE task_id = t.id
            AND attempt IS NOT DISTINCT FROM
                (SELECT max(attempt) FROM evidence WHERE task_id = t.id)
       ) e ON TRUE
      WHERE ${NEAR_PLACE}
        AND t.status IN ('submitted', 'confirmed')
        AND t.submitted_at IS NOT NULL
        AND q.visibility = 'public'
      ORDER BY t.submitted_at DESC
      LIMIT $4`,
    [placeName, at?.lat ?? null, at?.lng ?? null, limit],
  );

  return rows.map((row) => ({
    questionId: row.questionId,
    question: row.question,
    answer: row.answer,
    placeName: row.placeName,
    area: row.area,
    minutesOld: Math.round(Number(row.minutesOld)),
    evidenceKeys: Array.isArray(row.keys) ? row.keys : [],
    evidenceKind: row.kind,
    verifier: row.verifier,
    confirmed: Boolean(row.confirmed),
  }));
}

/** Judges a prior answer against a new question. */
export async function triage(question: string, placeName: string, at: At = null): Promise<Triage> {
  const prior = await priorAnswerFor(placeName, at);

  if (!prior) {
    return { decision: 'dispatch', because: 'Nobody has checked this place recently.' };
  }

  /**
   * Past the window, nothing is reused and the model is not asked.
   *
   * A hard ceiling above the judgment, not instead of it: whatever the model
   * would say about a two-day-old photograph, presenting it as the current
   * state of a street is not something this should ever do, and a bound the
   * operator sets is cheaper to reason about than a prompt that must always
   * hold.
   */
  if (prior.minutesOld > config.agents.maxAgeMinutes) {
    return {
      decision: 'dispatch',
      because: `The last check here was ${ago(prior.minutesOld)}, which is too old to stand in.`,
    };
  }

  /**
   * Without a model, nothing is reused.
   *
   * The safe default is spending money, not handing back an answer to a
   * question nobody established it answers.
   */
  if (!hasVision()) {
    return { decision: 'dispatch', because: 'No judgment available, so somebody goes.' };
  }

  try {
    const response = await vision().chat.completions.create({
      model: config.visionModel,
      max_completion_tokens: 400,
      // Same reasoning as the other checks here: this is a short judgment
      // against a rubric, and the default effort spends the whole budget
      // thinking and returns an empty string.
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            `NEW PLACE: ${placeName}`,
            `OLD PLACE: ${prior.placeName}`,
            `NEW QUESTION: ${question}`,
            `OLD QUESTION: ${prior.question}`,
            `ANSWER BROUGHT BACK: ${prior.answer}`,
            `CHECKED: ${ago(prior.minutesOld)}`,
          ].join('\n'),
        },
      ],
    });

    const raw = (response.choices[0]?.message?.content ?? '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { decision: 'dispatch', because: 'Could not judge it, so somebody goes.' };

    const parsed = JSON.parse(match[0]) as { decision?: unknown; because?: unknown };
    const because =
      typeof parsed.because === 'string' && parsed.because.trim()
        ? parsed.because.trim()
        : 'Judged against the last check here.';

    if (parsed.decision === 'reuse') return { decision: 'reuse', prior, because };
    return { decision: 'dispatch', because };
  } catch (error) {
    // A failure here must cost money rather than trust: dispatch, and say so.
    console.warn('[agent] triage failed —', error instanceof Error ? error.message : error);
    return { decision: 'dispatch', because: 'The check could not run, so somebody goes.' };
  }
}

import { Router } from 'express';
import OpenAI from 'openai';
import { authenticate } from '../auth.js';
import { config, hasVision } from '../config.js';
import { one } from '../db.js';

export const tidyRouter = Router();

let client: OpenAI | null = null;
function vision(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: config.visionKey });
  return client;
}

/**
 * Fixes the writing without touching the meaning.
 *
 * The app already has a local pass — edit-distance spelling against a word
 * list — and it cannot help with "flaad". Nothing in a fixed list resolves a
 * misspelling that far from its target, and no list will ever carry every
 * Nigerian place name a question might mention.
 *
 * The rule the prompt exists to enforce is restraint. A model asked to
 * "improve" a question will rewrite it, and a rewritten question is a
 * different errand: somebody is paid to walk somewhere on the strength of
 * these words, and turning "is there flaad in edo" into "Could you please
 * check whether flooding has occurred in Edo State?" changes what was asked
 * and how much it sounds like it is worth.
 */
const SYSTEM = `You correct the writing in a short question. You never change what it asks.

Fix only:
- misspelt words, including place names ("edo" to "Edo", "lekki" to "Lekki")
- capitalisation, including the first letter and proper nouns
- punctuation, including a missing question mark
- doubled words

Do not:
- rephrase, expand, shorten, or make the question more polite
- add detail that is not there, or guess at a place that is not named
- answer the question or comment on it
- change informal wording that is already correct ("go slow", "buka", "NEPA")

Reply with JSON only, no other text:
{"text":"<the corrected question>"}

If nothing needs correcting, return the question exactly as given.`;

/**
 * Bounded so a paste cannot turn into an expensive request. Questions in this
 * app are one line; anything longer is not a question and is returned as-is.
 */
const MAX_LENGTH = 300;

/**
 * Taps per person per day that reach the model.
 *
 * One: you write a question and tidy it. That is the whole errand, and the
 * local pass is unmetered and still runs on every tap afterwards — so the cap
 * removes the model's contribution, not the button.
 */
const DAILY_TIDIES = 1;

/**
 * Counts one use and says whether it was allowed, in a single statement.
 *
 * The insert and the check have to be one round trip: two taps arriving
 * together would both read the same count and both be allowed, which is the
 * cheapest possible way to make a limit not a limit. `used <= $2` is
 * evaluated on the row after the increment, so the first call returns 1.
 */
async function claimTidy(userId: string): Promise<boolean> {
  const row = await one<{ allowed: boolean }>(
    `INSERT INTO ai_usage (user_id, day, kind, used)
     VALUES ($1, CURRENT_DATE, 'tidy', 1)
     ON CONFLICT (user_id, day, kind)
       DO UPDATE SET used = ai_usage.used + 1
     RETURNING (used <= $2) AS allowed`,
    [userId, DAILY_TIDIES],
  );
  return row?.allowed ?? false;
}

tidyRouter.post('/', authenticate, async (req, res) => {
  const text = String((req.body as { text?: unknown }).text ?? '').trim();

  if (!text) {
    res.status(400).json({ error: 'empty', detail: 'Nothing to correct.' });
    return;
  }

  /**
   * Unavailable is not an error here.
   *
   * The client keeps its local pass and uses it whenever this returns the
   * text unchanged, so a missing key degrades to what the app did before
   * rather than showing somebody a failure they cannot act on.
   */
  if (!hasVision() || text.length > MAX_LENGTH) {
    res.json({ text, changed: false });
    return;
  }

  /**
   * Claimed before the model is called, not after.
   *
   * Counting on success would let a failing request be retried without limit,
   * which is exactly the loop this is here to bound. The cost is that a rare
   * server-side failure still spends one of the two — acceptable, because the
   * local pass has already corrected what it can either way.
   */
  if (!(await claimTidy(req.user!.id))) {
    res.json({ text, changed: false, limited: true });
    return;
  }

  try {
    const response = await vision().chat.completions.create({
      model: config.visionModel,
      max_completion_tokens: 600,
      // Same reasoning as the relevance check: this is a copy-edit against a
      // short rubric, and the default effort spends the whole budget thinking
      // and returns an empty string.
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
    });

    const raw = (response.choices[0]?.message?.content ?? '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      res.json({ text, changed: false });
      return;
    }

    const parsed = JSON.parse(match[0]) as { text?: unknown };
    const fixed = typeof parsed.text === 'string' ? parsed.text.trim() : '';

    /**
     * A correction that changes the length this much is a rewrite.
     *
     * The instructions say not to rephrase; this is what enforces it when the
     * model does anyway. Falling back to the original is always safe — the
     * worst case is a question with a typo in it, which is what the person
     * typed and what they can still edit.
     */
    const rewritten = fixed.length > text.length * 1.6 + 20 || fixed.length < text.length * 0.5;

    if (!fixed || rewritten) {
      res.json({ text, changed: false });
      return;
    }

    res.json({ text: fixed, changed: fixed !== text });
  } catch (error) {
    console.warn('[tidy] could not correct —', error instanceof Error ? error.message : error);
    res.json({ text, changed: false });
  }
});

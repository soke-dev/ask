import OpenAI from 'openai';
import sharp from 'sharp';
import { config, hasVision } from '../config.js';
import type { CheckResult } from './types.js';

let client: OpenAI | null = null;
function vision(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: config.visionKey });
  return client;
}

const SYSTEM = `You check whether a photo could plausibly be an answer to a question about a place.

You are NOT judging whether the answer is correct, whether the place is the right branch, or whether the person is telling the truth. A human decides all of that. You are catching one thing only: evidence that is obviously about something else entirely — a selfie, a wall, a living room, a screenshot — sent in response to a question about a real location.

Reply with JSON only, no other text:
{"shows":"yes"|"unclear"|"no","reason":"<one short sentence>"}

"yes"     the photo could plausibly relate to the question
"unclear" you cannot tell — the honest answer whenever there is any doubt
"no"      the photo is clearly about something unrelated

Choose "no" only when you are confident. A wrong "no" costs an honest person their payment for a trip they actually made. When it is a close call, "unclear" is correct.`;

/**
 * Asks a vision model whether the evidence is plausibly about the question.
 *
 * This check can only ever return `pass`, `warn` or `skipped` — never `fail`.
 * That ceiling is enforced here rather than left to the caller, because it is
 * the point of the design: a model's opinion is allowed to raise a flag for
 * the verifier to consider, and is never allowed to block someone's payment
 * on its own. Blocking is reserved for the arithmetic in tier 1, which
 * measures the file rather than interpreting the world.
 */
export async function checkRelevance(
  frame: Buffer,
  question: string,
  placeName: string | null,
): Promise<CheckResult> {
  if (!hasVision()) {
    return {
      name: 'relevance',
      tier: 2,
      verdict: 'skipped',
      detail: 'Not checked against the question — no vision model is configured.',
    };
  }

  try {
    /**
     * 512px, measured rather than guessed.
     *
     * The image is most of what this request costs — about 640 of 855 input
     * tokens at 800px — and the check is "is this the right kind of scene",
     * which does not need detail. Run against real evidence at three widths:
     *
     *   800px  855 tokens   no, unclear
     *   512px  575 tokens   no, unclear   <- same verdicts, a third cheaper
     *   384px  435 tokens   no, no        <- a photo flipped to a false "no"
     *
     * 512 is where the saving stops being free. Below it the model starts
     * calling things it cannot actually see, and a wrong "no" costs an honest
     * verifier the payment for a trip they made.
     */
    const small = await sharp(frame)
      .rotate()
      .resize({ width: 512, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();

    const asked = placeName
      ? `Question: "${question}"\nPlace: ${placeName}`
      : `Question: "${question}"`;

    const response = await vision().chat.completions.create({
      model: config.visionModel,
      /**
       * Headroom, not a target.
       *
       * 200 was enough for most verdicts and not for all of them — a slightly
       * longer reason hit the ceiling and the whole request failed with
       * "max_tokens or model output limit was reached", turning a working
       * check into a skip. Output is billed on what is used, not what is
       * allowed, so the spare capacity is free; a verdict runs about 18 tokens.
       */
      max_completion_tokens: 600,
      /**
       * Without this the check returns an empty string.
       *
       * GPT-5 spends `max_completion_tokens` on internal reasoning *before*
       * writing anything, so the default effort consumed the whole 200-token
       * budget and left nothing for the answer — a successful, billed request
       * with `content: ""`, which parseVerdict then discarded as unusable.
       *
       * 'low' is also the right setting on its merits: this is a three-way
       * classification against a short rubric, not a problem that repays
       * deliberation. Measured at 0 reasoning tokens and 18 completion tokens.
       */
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              // A data URI rather than a hosted link: the evidence is private
              // and must not be given a public URL to be looked at.
              image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}` },
            },
            { type: 'text', text: asked },
          ],
        },
      ],
    });

    const text = (response.choices[0]?.message?.content ?? '').trim();

    const parsed = parseVerdict(text);
    if (!parsed) {
      return {
        name: 'relevance',
        tier: 2,
        verdict: 'skipped',
        detail: 'Not checked against the question — the check did not return a usable answer.',
      };
    }

    if (parsed.shows === 'no') {
      return {
        name: 'relevance',
        tier: 2,
        verdict: 'warn',
        detail: `This may not show what was asked: ${parsed.reason} Send it anyway if you know it is right.`,
      };
    }

    return {
      name: 'relevance',
      tier: 2,
      verdict: 'pass',
      detail:
        parsed.shows === 'yes'
          ? 'Looks like it relates to the question.'
          : 'Could not tell either way, which is not a problem.',
    };
  } catch (error) {
    /**
     * Failing open, but not silently.
     *
     * A model outage must not stop an honest verifier being paid, so this
     * stays a `skipped` rather than a `fail`. What it used to do as well was
     * flatten every cause into one sentence — an expired key, an empty credit
     * balance and a genuine outage all read identically, and finding out which
     * meant calling the API by hand. The operator gets the real reason; the
     * verifier still gets the benefit of the doubt.
     */
    console.warn(
      '[relevance] vision check failed —',
      error instanceof Error ? error.message : String(error),
    );

    return {
      name: 'relevance',
      tier: 2,
      verdict: 'skipped',
      detail: 'Not checked against the question — that check was unavailable.',
    };
  }
}

function parseVerdict(text: string): { shows: 'yes' | 'unclear' | 'no'; reason: string } | null {
  // Models sometimes wrap JSON in prose or a fence despite instructions.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { shows?: unknown; reason?: unknown };
    const shows = parsed.shows;
    if (shows !== 'yes' && shows !== 'unclear' && shows !== 'no') return null;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    return { shows, reason: reason.length > 0 ? reason : 'no reason given.' };
  } catch {
    return null;
  }
}

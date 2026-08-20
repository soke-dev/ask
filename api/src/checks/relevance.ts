import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { config, hasVision } from '../config.js';
import type { CheckResult } from './types.js';

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey });
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
    // Downscaled before sending: the check is "is this the right kind of
    // scene", which survives 800px fine, and full-resolution frames would
    // multiply both latency and cost for no gain in accuracy.
    const small = await sharp(frame)
      .rotate()
      .resize({ width: 800, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();

    const asked = placeName
      ? `Question: "${question}"\nPlace: ${placeName}`
      : `Question: "${question}"`;

    const response = await anthropic().messages.create({
      model: config.visionModel,
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') },
            },
            { type: 'text', text: asked },
          ],
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

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
    // A model outage must not stop an honest verifier being paid. The gap is
    // recorded rather than papered over.
    return {
      name: 'relevance',
      tier: 2,
      verdict: 'skipped',
      detail: 'Not checked against the question — that check was unavailable.',
      ...(error instanceof Error ? {} : {}),
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

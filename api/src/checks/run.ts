import { checkDistance, type Coords } from './geo.js';
import { judgeImage, measureImage } from './image.js';
import { checkRelevance } from './relevance.js';
import { analyseVideo } from './video.js';
import { config } from '../config.js';
import { summarise, type CheckReport, type CheckResult } from './types.js';

export type GateInput = {
  kind: 'photo' | 'video';
  files: Buffer[];
  question: string;
  placeName: string | null;
  captured: Coords | null;
  target: Coords | null;
};

export type GateOutput = CheckReport & {
  /** Measured facts worth storing alongside the evidence. */
  facts: {
    distanceMetres: number | null;
    durationSeconds: number | null;
    width: number | null;
    height: number | null;
  };
};

/**
 * Runs the whole gate over one submission.
 *
 * The tiers run in order and the order is the cost control: tier 1 is
 * arithmetic on bytes already in memory and is free, tier 2 is a model call
 * that costs real money on every submission. At a ₦500 bounty the platform
 * fee is around ₦50, so a check costing a few naira is a meaningful slice of
 * the margin on every single job.
 *
 * So tier 2 does not run when tier 1 has already failed. There is no point
 * asking a model what a photo depicts when the verifier is being sent back to
 * retake it anyway — the answer would be discarded, and most junk submissions
 * are exactly the ones tier 1 catches. Junk dies for free.
 */
export async function runGate(input: GateInput): Promise<GateOutput> {
  const checks: CheckResult[] = [];
  let bestFrame: Buffer | null = null;
  let bestSharpness = -Infinity;

  let durationSeconds: number | null = null;
  let width: number | null = null;
  let height: number | null = null;

  if (input.files.length === 0) {
    return {
      verdict: 'fail',
      checks: [
        { name: 'present', tier: 1, verdict: 'fail', detail: 'No evidence was attached.' },
      ],
      facts: { distanceMetres: null, durationSeconds: null, width: null, height: null },
    };
  }

  // ── Tier 1 ────────────────────────────────────────────────────────────────
  if (input.kind === 'video') {
    const analysis = await analyseVideo(input.files[0]!);
    checks.push(...analysis.checks);
    bestFrame = analysis.bestFrame;
    durationSeconds = analysis.probe.durationSeconds;
    width = analysis.probe.width;
    height = analysis.probe.height;
  } else {
    if (input.files.length > config.media.maxPhotos) {
      checks.push({
        name: 'count',
        tier: 1,
        verdict: 'fail',
        score: input.files.length,
        threshold: config.media.maxPhotos,
        detail: `That is ${input.files.length} photos. The limit is ${config.media.maxPhotos}.`,
      });
    }

    // Every photo is measured, but the verdicts are collapsed to one per kind:
    // telling someone "photo 3 of 5 is soft" five times over is noise, and the
    // submission stands or falls as a whole.
    const perPhoto: { sharpness: CheckResult; exposure: CheckResult }[] = [];
    for (const file of input.files) {
      const stats = await measureImage(file);
      if (stats.sharpness > bestSharpness) {
        bestSharpness = stats.sharpness;
        bestFrame = file;
        width = stats.width;
        height = stats.height;
      }
      const [sharpness, exposure] = judgeImage(stats);
      perPhoto.push({ sharpness: sharpness!, exposure: exposure! });
    }

    checks.push(worst(perPhoto.map((p) => p.sharpness), input.files.length));
    checks.push(worst(perPhoto.map((p) => p.exposure), input.files.length));
  }

  checks.push(checkDistance(input.captured, input.target));

  const tier1 = summarise(checks);

  // ── Tier 2 ────────────────────────────────────────────────────────────────
  if (tier1 === 'fail') {
    checks.push({
      name: 'relevance',
      tier: 2,
      verdict: 'skipped',
      detail: 'Not checked against the question yet — fix the above and it runs on the retake.',
    });
  } else if (bestFrame) {
    checks.push(await checkRelevance(bestFrame, input.question, input.placeName));
  } else {
    checks.push({
      name: 'relevance',
      tier: 2,
      verdict: 'skipped',
      detail: 'Not checked against the question — no frame could be read.',
    });
  }

  const distance = checks.find((c) => c.name === 'distance');

  return {
    verdict: summarise(checks),
    checks,
    facts: {
      distanceMetres: distance?.score ?? null,
      durationSeconds,
      width,
      height,
    },
  };
}

/**
 * Picks the verdict the submission should be judged by: the worst one.
 *
 * One unusable photo out of five still means the asker may be missing the
 * thing they paid for, so the set is only as good as its weakest member.
 */
function worst(results: CheckResult[], total: number): CheckResult {
  const rank = { fail: 3, warn: 2, skipped: 1, pass: 0 } as const;
  const chosen = results.reduce((a, b) => (rank[b.verdict] > rank[a.verdict] ? b : a));
  if (total <= 1 || chosen.verdict === 'pass') return chosen;

  const affected = results.filter((r) => r.verdict === chosen.verdict).length;
  return {
    ...chosen,
    detail:
      affected === total
        ? chosen.detail
        : `${affected} of ${total} photos: ${lowerFirst(chosen.detail)}`,
  };
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s;
}

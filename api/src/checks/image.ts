import sharp from 'sharp';
import { config } from '../config.js';
import type { CheckResult } from './types.js';

/** Width every frame is normalised to before measuring. */
const SAMPLE_WIDTH = 640;

export type ImageStats = {
  width: number;
  height: number;
  /** Variance of the Laplacian. Higher is sharper. */
  sharpness: number;
  /** Mean luma, 0–255. */
  brightness: number;
  /** Fraction of pixels pinned at pure black or pure white. */
  clipped: number;
};

/**
 * Reduces a frame to the three numbers the gate cares about.
 *
 * Everything is measured on a 640px-wide greyscale copy. Without that
 * normalisation the sharpness figure would depend on the camera's resolution —
 * the same scene shot at 12MP and at 2MP would score differently — and a
 * threshold that means one thing on one phone and something else on another
 * is not a threshold.
 */
export async function measureImage(input: Buffer): Promise<ImageStats> {
  const meta = await sharp(input).metadata();

  const { data, info } = await sharp(input)
    .rotate() // honour EXIF orientation before measuring
    .greyscale()
    .resize({ width: SAMPLE_WIDTH, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;
  let sum = 0;
  let clippedCount = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i] ?? 0;
    sum += v;
    if (v <= 2 || v >= 253) clippedCount += 1;
  }
  const brightness = data.length > 0 ? sum / data.length : 0;

  return {
    width: meta.width ?? w,
    height: meta.height ?? h,
    sharpness: laplacianVariance(data, w, h),
    brightness,
    clipped: data.length > 0 ? clippedCount / data.length : 0,
  };
}

/**
 * Variance of the image convolved with a 3×3 Laplacian.
 *
 * The Laplacian is a second-derivative operator: it responds to edges and
 * ignores flat regions. A sharp photo is full of edges, so the response varies
 * wildly and the variance is high. Blur is a low-pass filter — it removes
 * exactly the high frequencies the Laplacian detects — so a smeared photo
 * produces a response close to uniform, and the variance collapses.
 *
 * Done in plain JS rather than through sharp's convolve() because that clamps
 * its output to unsigned 8-bit, discarding every negative value. Half the
 * kernel's response is negative, so clamping would throw away half the signal
 * the measurement depends on.
 */
function laplacianVariance(data: Buffer, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      // 4-neighbour Laplacian: centre × 4 minus the cross around it.
      const response =
        4 * (data[i] ?? 0) -
        (data[i - 1] ?? 0) -
        (data[i + 1] ?? 0) -
        (data[i - width] ?? 0) -
        (data[i + width] ?? 0);
      sum += response;
      sumSquares += response * response;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Turns the measurements into verdicts a verifier can act on. */
export function judgeImage(stats: ImageStats, label = 'photo'): CheckResult[] {
  const results: CheckResult[] = [];
  const { sharpness, exposure } = config;

  if (stats.sharpness < sharpness.retakeBelow) {
    results.push({
      name: 'sharpness',
      tier: 1,
      verdict: 'fail',
      score: round(stats.sharpness),
      threshold: sharpness.retakeBelow,
      detail: `This ${label} is too blurry to read. Hold still and take it again.`,
    });
  } else if (stats.sharpness < sharpness.warnBelow) {
    results.push({
      name: 'sharpness',
      tier: 1,
      verdict: 'warn',
      score: round(stats.sharpness),
      threshold: sharpness.warnBelow,
      detail: `This ${label} is soft. It may still be fine, but a sharper one is safer.`,
    });
  } else {
    results.push({
      name: 'sharpness',
      tier: 1,
      verdict: 'pass',
      score: round(stats.sharpness),
      detail: 'Clear enough to read.',
    });
  }

  if (stats.brightness < exposure.darkRetakeBelow) {
    results.push({
      name: 'exposure',
      tier: 1,
      verdict: 'fail',
      score: round(stats.brightness),
      threshold: exposure.darkRetakeBelow,
      detail: `This ${label} is too dark to show anything. Use more light or the flash.`,
    });
  } else if (stats.brightness < exposure.darkWarnBelow) {
    results.push({
      name: 'exposure',
      tier: 1,
      verdict: 'warn',
      score: round(stats.brightness),
      threshold: exposure.darkWarnBelow,
      detail: 'Quite dark. Check the asker can actually see what they asked about.',
    });
  } else if (stats.brightness > exposure.brightWarnAbove) {
    results.push({
      name: 'exposure',
      tier: 1,
      verdict: 'warn',
      score: round(stats.brightness),
      threshold: exposure.brightWarnAbove,
      detail: 'Washed out by light. Try angling away from the sun.',
    });
  } else if (stats.clipped > exposure.clippedWarnAbove) {
    results.push({
      name: 'exposure',
      tier: 1,
      verdict: 'warn',
      score: round(stats.clipped, 3),
      threshold: exposure.clippedWarnAbove,
      detail: 'Much of this is pure black or pure white, so detail is lost.',
    });
  } else {
    results.push({
      name: 'exposure',
      tier: 1,
      verdict: 'pass',
      score: round(stats.brightness),
      detail: 'Well lit.',
    });
  }

  return results;
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

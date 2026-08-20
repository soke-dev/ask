import sharp from 'sharp';
import { measureImage, judgeImage } from './image.js';
import { checkDistance, distanceMetres } from './geo.js';

/**
 * Exercises the gate against images with known properties.
 *
 * Thresholds picked by reasoning about a metric are worth exactly nothing
 * until something has been measured through them. This builds a sharp frame,
 * a blurred copy of it, and an underexposed copy, then prints what the gate
 * says about each — so the numbers in config.ts can be checked against
 * behaviour rather than trusted.
 *
 *   npm run checks:try
 */

/** A detailed synthetic scene: text-like bars, edges, and fine texture. */
async function scene(): Promise<Buffer> {
  const w = 1200;
  const h = 900;
  const px = Buffer.alloc(w * h * 3);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      // Hard-edged blocks plus a fine grid — the kind of high-frequency
      // content a price board or a queue of cars produces.
      const block = (Math.floor(x / 40) + Math.floor(y / 40)) % 2 === 0 ? 210 : 40;
      const grid = x % 7 === 0 || y % 7 === 0 ? 60 : 0;
      const v = Math.max(0, Math.min(255, block + grid));
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
    }
  }

  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function report(label: string, buffer: Buffer) {
  const stats = await measureImage(buffer);
  const checks = judgeImage(stats);
  const verdicts = checks.map((c) => `${c.name}=${c.verdict}`).join(' ');
  console.log(
    `${label.padEnd(22)} sharpness=${stats.sharpness.toFixed(0).padStart(6)}  ` +
      `brightness=${stats.brightness.toFixed(0).padStart(3)}  ${verdicts}`,
  );
  for (const check of checks) {
    if (check.verdict !== 'pass') console.log(`${' '.repeat(24)}→ ${check.detail}`);
  }
  return { stats, checks };
}

async function main() {
  const base = await scene();

  console.log('\n── Image gate ─────────────────────────────────────────────────\n');
  const sharpOne = await report('sharp original', base);
  const blurred = await report('blurred (sigma 6)', await sharp(base).blur(6).jpeg().toBuffer());
  const soft = await report('slightly soft (2)', await sharp(base).blur(2).jpeg().toBuffer());
  const dark = await report(
    'underexposed',
    await sharp(base).linear(0.12, 0).jpeg().toBuffer(),
  );

  console.log('\n── Does it actually separate? ─────────────────────────────────\n');
  const assertions: [string, boolean][] = [
    ['sharp original passes', sharpOne.checks.every((c) => c.verdict === 'pass')],
    ['heavy blur is failed', blurred.checks.some((c) => c.name === 'sharpness' && c.verdict === 'fail')],
    ['blur scores below sharp', blurred.stats.sharpness < sharpOne.stats.sharpness],
    ['soft ranks between the two',
      soft.stats.sharpness > blurred.stats.sharpness && soft.stats.sharpness < sharpOne.stats.sharpness],
    ['dark frame is caught', dark.checks.some((c) => c.name === 'exposure' && c.verdict !== 'pass')],
  ];

  for (const [name, passed] of assertions) {
    console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}`);
  }

  console.log('\n── Distance ───────────────────────────────────────────────────\n');
  // Ikeja City Mall to Computer Village: about 2.5km on the ground.
  const mall = { lat: 6.6018, lng: 3.3515 };
  const village = { lat: 6.5951, lng: 3.3378 };
  console.log(`  mall → computer village   ${distanceMetres(mall, village)}m`);
  console.log(`  same spot                 ${distanceMetres(mall, mall)}m`);
  for (const [label, coords] of [
    ['at the place', mall],
    ['80m away', { lat: mall.lat + 0.0007, lng: mall.lng }],
    ['1.2km away', { lat: mall.lat + 0.0108, lng: mall.lng }],
  ] as const) {
    const check = checkDistance(coords, mall);
    console.log(`  ${label.padEnd(24)} ${check.verdict.padEnd(8)} ${check.detail}`);
  }

  const failed = assertions.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.log(`\n${failed.length} assertion(s) failed — the thresholds need moving.\n`);
    process.exitCode = 1;
  } else {
    console.log('\nAll assertions held.\n');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

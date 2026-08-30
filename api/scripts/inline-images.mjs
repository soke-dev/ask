import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

/**
 * Bakes the landing page's pictures into TypeScript modules.
 *
 * The page cannot fetch them: tsc copies no assets, so a file next to the
 * source works locally and 404s in production. The same reason the logo is
 * inlined, and it matters more here, because this is the page somebody is
 * judging and a picture that arrives late is nearly as bad as one that never
 * arrives at all.
 *
 * So the pictures become strings. WebP, at whichever of lossy and lossless
 * comes out smaller: a screenshot of flat dark UI and a flat vector badge do
 * not want the same encoder, and guessing which is which by eye is how you
 * end up shipping a 10 kB gradient of a solid colour.
 *
 * Run it again when any of them changes:
 *
 *   npm run images
 *
 * Not part of the build. A build that fails because somebody moved a
 * screenshot would be a worse trade than a screenshot that is a month old.
 */

const ASSETS = '../assets/images/';

/** Encodes both ways and keeps the smaller. */
async function bake(pipeline) {
  const [lossy, lossless] = await Promise.all([
    pipeline.clone().webp({ quality: 88, effort: 6 }).toBuffer(),
    pipeline.clone().webp({ lossless: true, effort: 6 }).toBuffer(),
  ]);
  const buffer = lossless.length < lossy.length ? lossless : lossy;
  const { width, height } = await sharp(buffer).metadata();
  return { buffer, width, height, how: buffer === lossless ? 'lossless' : 'lossy' };
}

const uri = (buffer) => `data:image/webp;base64,${buffer.toString('base64')}`;
const kb = (buffer) => `${(buffer.length / 1024).toFixed(1)} kB`;

/* ─────────────────────────────── the screenshot ─────────────────────────── */

const shotSource = process.argv[2] ?? `${ASSETS}Screenshot 2026-08-30 170146.png`;
const png = await readFile(shotSource);
const meta = await sharp(png).metadata();

/*
 * Screenshots arrive wearing the frame of whatever took them. This one had a
 * grey hairline around all four sides, and inside a drawn phone that reads as
 * a phone inside a phone, so the chrome is measured off and cut.
 *
 * Measured rather than assumed: walk in from the middle of each edge until
 * the colour stops changing, and that is where the app starts. A screenshot
 * taken some other way, with a thicker border or none, still lands right.
 */
const { data: rawIn, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
const at = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  return [rawIn[i], rawIn[i + 1], rawIn[i + 2]];
};
const far = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) > 12;

/** How many pixels of frame sit on one edge, looking along the middle of it. */
function chrome(step, limit) {
  const seen = [];
  for (let i = 0; i < limit; i += 1) seen.push(step(i));
  // The app's own colour is whatever the run settles into.
  const settled = seen[limit - 1];
  let i = 0;
  while (i < limit - 1 && far(seen[i], settled)) i += 1;
  return i;
}

const midX = Math.floor(info.width / 2);
const midY = Math.floor(info.height / 2);
const cut = {
  left: chrome((i) => at(i, midY), 10),
  right: chrome((i) => at(info.width - 1 - i, midY), 10),
  top: chrome((i) => at(midX, i), 10),
  bottom: chrome((i) => at(midX, info.height - 1 - i), 10),
};
const box = {
  left: cut.left,
  top: cut.top,
  width: info.width - cut.left - cut.right,
  height: info.height - cut.top - cut.bottom,
};

/*
 * Not resized. It is already close to the size the page shows it at, and
 * upscaling a screenshot to claim a retina density only makes it blurrier.
 */
const shot = await bake(sharp(png).extract(box));

/*
 * The screen's background, read off the picture rather than guessed, and read
 * after the crop so it is the app's colour and not the frame's. The page
 * paints it behind the image so the strip above the screenshot is the same
 * colour as the app instead of a seam.
 *
 * Sampled across a row rather than at a corner. The frame is rounded, so the
 * corner pixel is still frame after the straight edges have gone, and asking
 * it gives you the border colour and a visible seam.
 */
const { data, info: cropped } = await sharp(shot.buffer)
  .raw()
  .toBuffer({ resolveWithObject: true });
const pick = (x, y) => {
  const i = (y * cropped.width + x) * cropped.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const votes = new Map();
for (let i = 1; i < 10; i += 1) {
  const key = pick(Math.round((cropped.width * i) / 10), 3).join(',');
  votes.set(key, (votes.get(key) ?? 0) + 1);
}
const winner = [...votes].sort((a, b) => b[1] - a[1])[0][0].split(',');
const hex = '#' + winner.map((c) => Number(c).toString(16).padStart(2, '0')).join('');

await writeFile(
  'src/appShot.ts',
  `/**
 * The app's home screen, inlined.
 *
 * A real screenshot, not a drawing of one: somebody deciding whether to
 * install this is entitled to see what they would be installing.
 *
 * Generated. Do not edit by hand: run "npm run images" after retaking it.
 *
 * Source: ${shotSource}
 * ${box.width} by ${box.height} after trimming ${cut.top}/${cut.right}/${cut.bottom}/${cut.left}
 * pixels of window frame, ${kb(shot.buffer)} of ${shot.how} WebP.
 */

/** The screenshot itself, ready for the src of an img. */
export const APP_SHOT_DATA_URI =
  '${uri(shot.buffer)}';

/** What the app paints behind it, so the frame around it has no seam. */
export const APP_SHOT_BG = '${hex}';

/** So the page can reserve the right space before the picture decodes. */
export const APP_SHOT_SIZE = { width: ${box.width}, height: ${box.height} };
`,
);

/* ───────────────────────────────── the badges ───────────────────────────── */

/*
 * Rendered at twice the height the page shows them, so they stay sharp on a
 * dense screen, and by height rather than width so two badges drawn to
 * different proportions still line up on the same baseline.
 */
const BADGE_HEIGHT = 104;

const badges = [
  { name: 'ANDROID_BADGE', file: 'Download_Android-APK.png', alt: 'Download the APK for Android' },
  { name: 'TESTFLIGHT_BADGE', file: 'testflight-badge.png', alt: 'Get the beta on TestFlight' },
];

const baked = [];
for (const badge of badges) {
  const image = sharp(await readFile(ASSETS + badge.file)).resize({ height: BADGE_HEIGHT });
  baked.push({ ...badge, ...(await bake(image)) });
}

await writeFile(
  'src/storeBadges.ts',
  `/**
 * The two store badges, inlined.
 *
 * Both are transparent outside their pill, so each sits on whatever the page
 * is rather than carrying a background of its own.
 *
 * Generated. Do not edit by hand: run "npm run images".
 */

export type StoreBadge = { src: string; width: number; height: number; alt: string };

${baked
  .map(
    (b) => `/** ${b.file}, ${b.width} by ${b.height}, ${kb(b.buffer)} of ${b.how} WebP. */
export const ${b.name}: StoreBadge = {
  width: ${b.width},
  height: ${b.height},
  alt: '${b.alt}',
  src: '${uri(b.buffer)}',
};`,
  )
  .join('\n\n')}
`,
);

console.log(
  `inline-images: shot ${meta.width}x${meta.height} -> ${box.width}x${box.height} ` +
    `(trimmed ${cut.top}/${cut.right}/${cut.bottom}/${cut.left}), ` +
    `${kb(shot.buffer)} ${shot.how}, background ${hex}`,
);
for (const b of baked) console.log(`               ${b.file} -> ${b.width}x${b.height}, ${kb(b.buffer)} ${b.how}`);

import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

/**
 * Bakes the app screenshot into a TypeScript module.
 *
 * The landing page shows a real screen rather than a drawing of one, and the
 * page cannot fetch it: tsc copies no assets, so a file next to the source
 * works locally and 404s in production. The same reason the logo is inlined.
 *
 * So the picture becomes a string. WebP because it is a third of the PNG for
 * a screenshot of flat dark UI, and the browsers that cannot read it stopped
 * shipping years before this was written.
 *
 * Run it again when the home screen changes:
 *
 *   npm run shot -- "../assets/images/whatever.png"
 *
 * It is not part of the build. A build that fails because somebody moved a
 * screenshot would be a worse trade than a screenshot that is a month old.
 */

const source = process.argv[2] ?? '../assets/images/Screenshot 2026-08-30 170146.png';
const out = 'src/appShot.ts';

const png = await readFile(source);
const image = sharp(png);
const meta = await image.metadata();

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
const webp = await image.extract(box).webp({ quality: 82, effort: 6 }).toBuffer();

/*
 * The screen's background, read off the picture rather than guessed, and read
 * after the crop so it is the app's colour and not the frame's. The page
 * paints it behind the image so the strip above the screenshot is the same
 * colour as the app instead of a seam.
 */
const { data, info: cropped } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
const pick = (x, y) => {
  const i = (y * cropped.width + x) * cropped.channels;
  return [data[i], data[i + 1], data[i + 2]];
};

/*
 * Sampled across a row rather than at a corner. The frame is rounded, so the
 * corner pixel is still frame after the straight edges have gone, and asking
 * it gives you the border colour and a visible seam.
 */
const votes = new Map();
for (let i = 1; i < 10; i += 1) {
  const key = pick(Math.round((cropped.width * i) / 10), 3).join(',');
  votes.set(key, (votes.get(key) ?? 0) + 1);
}
const winner = [...votes].sort((a, b) => b[1] - a[1])[0][0].split(',');
const hex = '#' + winner.map((c) => Number(c).toString(16).padStart(2, '0')).join('');

const body = `/**
 * The app's home screen, inlined.
 *
 * A real screenshot, not a drawing of one: somebody deciding whether to
 * install this is entitled to see what they would be installing. Embedded
 * rather than served as a file because tsc copies no assets, so a file would
 * work locally and 404 in production, and because it cannot then arrive late
 * on the one page somebody is judging.
 *
 * Generated. Do not edit by hand: run "npm run shot" after retaking it.
 *
 * Source: ${source}
 * ${box.width} by ${box.height} after trimming ${cut.top}/${cut.right}/${cut.bottom}/${cut.left}
 * pixels of window frame, ${(webp.length / 1024).toFixed(1)} kB of WebP.
 */

/** The screenshot itself, ready for the src of an img. */
export const APP_SHOT_DATA_URI =
  'data:image/webp;base64,${webp.toString('base64')}';

/** What the app paints behind it, so the frame around it has no seam. */
export const APP_SHOT_BG = '${hex}';

/** So the page can reserve the right space before the picture decodes. */
export const APP_SHOT_SIZE = { width: ${box.width}, height: ${box.height} };
`;

await writeFile(out, body);
console.log(
  `inline-shot: ${meta.width}x${meta.height} -> ${box.width}x${box.height} ` +
    `(trimmed ${cut.top}/${cut.right}/${cut.bottom}/${cut.left}), ` +
    `${(png.length / 1024).toFixed(1)} kB png -> ${(webp.length / 1024).toFixed(1)} kB webp, ` +
    `background ${hex}`,
);

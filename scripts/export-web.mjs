import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * Builds the browser copy of the app, for the admin desk.
 *
 * The desk resolves disputes and decides identity checks, and doing that on a
 * phone is miserable. The screen already exists — app/admin.tsx — and the app
 * already has a real web split, so the browser gets the same desk rather than
 * a second one written to drift away from it.
 *
 * Two things this exists to stop.
 *
 * The environment. Expo inlines EXPO_PUBLIC_* at export time from whatever
 * .env happens to be lying around, and a developer's .env points at their own
 * machine. Exported plainly, this produced a bundle that talks to
 * 192.168.1.250 — a laptop on a home network — which would have been a desk
 * that worked on the machine that built it and nowhere else. The values are
 * read from eas.json instead, which is already where production says what it
 * points at, so the browser build and the store builds cannot disagree.
 *
 * The routing. The export is a single-page app: one index.html and a router
 * that runs in the browser. A static host asked for /admin looks for a file
 * of that name, finds none, and returns 404 — the desk would work only if you
 * landed on / first and navigated. The rewrite it writes into the output
 * fixes that, and the noindex header keeps an unadvertised admin surface out
 * of search results.
 */

const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
const env = eas.build?.production?.env;

if (!env || !env.EXPO_PUBLIC_API_URL) {
  throw new Error(
    'export-web: no production env in eas.json. That is where the API address ' +
      'lives; without it this would bake in whatever .env says.',
  );
}

console.log('export-web: building against', env.EXPO_PUBLIC_API_URL);

const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--clear'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    ...env,
    // Belt and braces: a stale .env must not win over eas.json.
    EXPO_NO_DOTENV: '1',
  },
});

if (result.status !== 0) process.exit(result.status ?? 1);

writeFileSync(
  'dist/vercel.json',
  JSON.stringify(
    {
      rewrites: [{ source: '/(.*)', destination: '/index.html' }],
      headers: [
        {
          source: '/(.*)',
          headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
        },
      ],
    },
    null,
    2,
  ) + '\n',
);

console.log('export-web: wrote dist/vercel.json (SPA rewrite + noindex)');
console.log('export-web: deploy with  npx vercel deploy dist --prod');

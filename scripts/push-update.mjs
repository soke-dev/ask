import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * Publishes an over-the-air update against production.
 *
 * `eas build` reads EXPO_PUBLIC_* from the build profile's `env` block in
 * eas.json, and says so in its output. `eas update` has no build profile: it
 * runs an export, and an export takes those values from whatever .env is
 * lying around. A developer's .env points at their own machine.
 *
 * So a plain `eas update --channel production` publishes a bundle whose
 * API_BASE is a laptop on a home network, and every installed copy of the app
 * picks it up on next launch and stops being able to reach anything. That is
 * not a hypothetical: it happened, and it broke the store builds.
 *
 * This reads the same env the production build profile uses, so an update and
 * a build cannot disagree about where the server is.
 *
 *   npm run push -- "what changed"
 */

const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
const env = eas.build?.production?.env;

if (!env?.EXPO_PUBLIC_API_URL) {
  throw new Error(
    'push-update: no production env in eas.json. That is where the API address ' +
      'lives; without it this would publish whatever .env says.',
  );
}

const message = process.argv.slice(2).join(' ').trim();
if (!message) {
  throw new Error('push-update: say what changed. npm run push -- "the message"');
}

console.log('push-update: publishing against', env.EXPO_PUBLIC_API_URL);

const result = spawnSync(
  'npx',
  /*
   * The message is quoted because shell:true joins these with spaces, so an
   * unquoted sentence arrives as one argument per word and eas rejects it.
   */
  ['eas', 'update', '--channel', 'production', '--message', JSON.stringify(message), '--non-interactive'],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      ...env,
      // A stale .env must not win over eas.json. Without this, dotenv fills in
      // anything eas.json happens not to name.
      EXPO_NO_DOTENV: '1',
    },
  },
);

process.exit(result.status ?? 1);

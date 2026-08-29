/**
 * Parses the script inside the demo page, and fails the build if it does not.
 *
 * The page is a string inside a TypeScript template literal containing HTML
 * containing JavaScript, so a backslash has to survive three levels of
 * escaping and twice it did not. Nothing complained: tsc sees a valid string,
 * the server serves it happily, the browser hits a SyntaxError on load and
 * every button on the page silently stops working — which looks exactly like
 * a page that was never wired up.
 *
 * A parse is all this needs to be. It costs milliseconds and catches the whole
 * class.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { DEMO_PAGE } = await import('../dist/demoPage.js');

const match = DEMO_PAGE.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
  console.error('check-demo: no <script> block found in the demo page');
  process.exit(1);
}

const file = join(tmpdir(), `confam-demo-check-${process.pid}.js`);
writeFileSync(file, match[1]);

try {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  console.log(`check-demo: page script parses (${match[1].length} chars)`);
} catch (error) {
  console.error('check-demo: the demo page script does not parse\n');
  console.error(String(error.stderr ?? error.message));
  process.exit(1);
} finally {
  try { unlinkSync(file); } catch {}
}

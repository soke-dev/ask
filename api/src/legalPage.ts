import { LOGO_DATA_URI } from './logo.js';
import { LEGAL } from './legalText.generated.js';
import { config } from './config.js';

/**
 * A legal document as a web page.
 *
 * Exists because the app stores require a privacy policy at a public URL, and
 * an in-app screen is not one. The text is generated from the app's copy at
 * build time, so this cannot drift away from what somebody agreed to on their
 * phone.
 */
function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/** Matched loosely so /terms and /privacy both land without exact titles. */
export function findDoc(slug: string) {
  const want = slug.toLowerCase();
  return LEGAL.find((d) => d.title.toLowerCase().startsWith(want)) ?? null;
}

export function legalPage(
  doc: { title: string; body: string[] },
  origin: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} — Confam</title>
<link rel="icon" href="${LOGO_DATA_URI}">
<style>
  :root {
    --bg:#0A0A0A; --line:#232323; --fg:#FAFAFA; --muted:#9C9C9C;
    --faint:#5F5F5F; --accent:#FF6B00;
  }
  * { box-sizing:border-box; }
  * { scrollbar-width: thin; scrollbar-color: #2A2A2A transparent; }
  ::-webkit-scrollbar { width:10px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#242424; border:2px solid var(--bg); }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  a { color:var(--accent); }
  header {
    display:flex; align-items:center; gap:10px;
    max-width:720px; margin:0 auto; padding:20px 22px;
    border-bottom:1px solid var(--line);
  }
  header img { width:24px; height:24px; border-radius:6px; display:block; }
  .word { font-weight:800; letter-spacing:1.6px; font-size:16px; }
  .word em { font-style:normal; color:var(--accent); }
  main { max-width:720px; margin:0 auto; padding:0 22px 80px; }
  h1 { font-size:clamp(28px,6vw,40px); margin:38px 0 6px; font-weight:800; letter-spacing:-1px; }
  .note { color:var(--faint); font-size:14px; margin:0 0 30px; }
  p { color:var(--muted); margin:0 0 16px; }
  nav { margin-top:44px; padding-top:22px; border-top:1px solid var(--line); font-size:14px; }
  nav a { margin-right:20px; text-decoration:none; color:var(--muted); }
  nav a:hover { color:var(--accent); }
</style>
</head>
<body>
<header>
  <a href="${esc(origin)}/"><img src="${LOGO_DATA_URI}" alt="Confam"></a>
  <span class="word">CONFAM<em>AI</em></span>
</header>
<main>
  <h1>${esc(doc.title)}</h1>
  <p class="note">
    Written in plain language so it can be read. It has not yet been reviewed by a lawyer, and
    some limits may be narrower in practice than they are written, because consumer law overrides
    an agreement in places.
  </p>
  ${doc.body.map((para) => `<p>${esc(para)}</p>`).join('\n  ')}
  <nav>
    <a href="${esc(origin)}/">Home</a>
    <a href="${esc(origin)}/terms">Terms</a>
    <a href="${esc(origin)}/privacy">Privacy</a>
    <a href="${esc(origin)}/licences">Licences</a>
    <a href="mailto:${esc(config.links.support)}">${esc(config.links.support)}</a>
  </nav>
</main>
</body>
</html>`;
}

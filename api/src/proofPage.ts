import { LOGO_DATA_URI } from './logo.js';

/**
 * The proof, for a person.
 *
 * The endpoint was built for agents and returned JSON, which is right for
 * them and useless for the human who clicked a link labelled "proof" and
 * landed on a wall of hex. Same URL, same facts, two shapes: a browser asking
 * for HTML gets this, anything else gets the JSON it was already getting.
 *
 * The point of the page is that it can be checked without trusting us, so the
 * instructions are on it rather than in documentation somewhere. Every hash is
 * selectable and every transaction is a link out to a block explorer.
 */

export type ProofView = {
  question: string;
  place: string | null;
  chain: {
    jobId: string | null;
    escrow: string | null;
    chainId: number;
    evidenceHash: string | null;
    transactions: Record<string, { hash: string; url: string } | null>;
  };
  evidence: {
    url: string;
    keccak256: string | null;
    bytes: number | null;
    capturedAt: string | Date | null;
    lat: number | null;
    lng: number | null;
    metresFromPlace: number | null;
  }[];
  verify: string[];
  unverifiable: string | null;
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function proofPage(p: ProofView, origin: string): string {
  const txRows = Object.entries(p.chain.transactions)
    .map(([name, tx]) =>
      `<tr><td>${esc(name)}</td><td>` +
      (tx
        ? `<a href="${esc(tx.url)}" target="_blank" rel="noopener">${esc(tx.hash)}</a>`
        : '<span class="dim">not yet</span>') +
      '</td></tr>',
    )
    .join('');

  const files = p.evidence
    .map(
      (e) => `
      <div class="file">
        <a href="${esc(origin)}${esc(e.url)}" target="_blank" rel="noopener">
          <img src="${esc(origin)}${esc(e.url)}" alt="evidence">
        </a>
        <table>
          <tr><td>keccak256</td><td class="hash">${e.keccak256 ? esc(e.keccak256) : '<span class="dim">not recorded</span>'}</td></tr>
          <tr><td>bytes</td><td>${e.bytes ?? '<span class="dim">unknown</span>'}</td></tr>
          <tr><td>captured</td><td>${e.capturedAt ? esc(new Date(e.capturedAt).toUTCString()) : '<span class="dim">unknown</span>'}</td></tr>
          <tr><td>where</td><td>${
            e.lat != null && e.lng != null
              ? esc(e.lat.toFixed(6)) + ', ' + esc(e.lng.toFixed(6)) +
                (e.metresFromPlace != null ? ' &middot; ' + e.metresFromPlace + 'm from the pin' : '')
              : '<span class="dim">not recorded</span>'
          }</td></tr>
        </table>
      </div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proof — ${esc(p.question)}</title>
<link rel="icon" href="${LOGO_DATA_URI}">
<style>
  :root {
    --bg:#080808; --line:#1F1F1F; --fg:#D4D4D4; --dim:#6B6B6B; --faint:#454545;
    --accent:#FF6B00; --ok:#3DD68C; --warn:#FFB020;
  }
  * { box-sizing:border-box; }
  * { scrollbar-width: thin; scrollbar-color: #2A2A2A transparent; }
  ::-webkit-scrollbar { width:9px; height:9px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#242424; border:2px solid var(--bg); }
  body {
    margin:0; background:var(--bg); color:var(--fg); padding:0 14px 70px;
    font:13.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  }
  main { max-width:760px; margin:0 auto; }
  .bar {
    display:flex; align-items:center; gap:9px; padding:13px 0;
    border-bottom:1px solid var(--line); color:var(--dim); font-size:12px;
  }
  .bar img { width:20px; height:20px; border-radius:5px; display:block; }
  .bar b { color:var(--accent); letter-spacing:.5px; }
  h1 { font-size:19px; line-height:1.35; margin:26px 0 4px; color:#fff; font-weight:700; }
  .place { color:var(--dim); margin:0 0 22px; }
  h2 {
    font-size:10.5px; letter-spacing:1.4px; text-transform:uppercase; color:var(--faint);
    font-weight:700; margin:30px 0 10px;
  }
  table { width:100%; border-collapse:collapse; }
  td { padding:7px 0; vertical-align:top; border-bottom:1px solid var(--line); }
  td:first-child { color:var(--dim); width:110px; padding-right:14px; }
  .hash, a { overflow-wrap:anywhere; }
  a { color:var(--accent); }
  .dim { color:var(--faint); }
  .file { margin-bottom:26px; }
  .file img {
    display:block; width:100%; max-width:360px; border:1px solid var(--line); margin-bottom:10px;
  }
  ol { padding-left:20px; margin:0; color:var(--dim); }
  ol li { margin-bottom:6px; }
  .note {
    border:1px solid var(--warn); color:var(--warn); padding:11px 13px; margin:20px 0;
  }
  .foot { color:var(--faint); font-size:12px; margin-top:34px; }
</style>
</head>
<body>
<main>
  <div class="bar">
    <a href="${esc(origin)}/confamagent"><img src="${LOGO_DATA_URI}" alt="Confam"></a>
    <b>confamai</b>
    <span>proof of a physical fact</span>
  </div>

  <h1>${esc(p.question)}</h1>
  <p class="place">${esc(p.place ?? 'somewhere')}</p>

  ${p.unverifiable ? `<div class="note">${esc(p.unverifiable)}</div>` : ''}

  <h2>On Base</h2>
  <table>
    <tr><td>chain</td><td>Base mainnet (${p.chain.chainId})</td></tr>
    <tr><td>escrow</td><td class="hash">${esc(p.chain.escrow ?? 'not configured')}</td></tr>
    <tr><td>job</td><td class="hash">${esc(p.chain.jobId ?? 'not funded on chain')}</td></tr>
    <tr><td>evidence</td><td class="hash">${
      p.chain.evidenceHash
        ? esc(p.chain.evidenceHash)
        : '<span class="dim">no hash recorded</span>'
    }</td></tr>
    ${txRows}
  </table>

  <h2>The evidence</h2>
  ${files || '<p class="dim">Nothing has been submitted for this yet.</p>'}

  <h2>Check it yourself</h2>
  <ol>${p.verify.map((v) => `<li>${esc(v)}</li>`).join('')}</ol>
  <p class="foot">
    Nothing here asks you to trust this server. Fetch the files, hash them with any
    Ethereum library, read the job from the contract, and compare.
  </p>

  <p class="foot">Add ?format=json for the machine-readable version.</p>
</main>
</body>
</html>`;
}

import { LOGO_DATA_URI } from './logo.js';
import { config } from './config.js';

/**
 * The front door.
 *
 * Serves three jobs at once, which is why it lives on the API rather than
 * waiting for a separate site: somewhere to send people who hear about this,
 * somewhere the app stores can find a privacy policy, and somewhere the two
 * builds can be downloaded from.
 *
 * The design follows the app rather than inventing a second identity: square
 * corners, 2px edges, uppercase tracked labels, one orange. Somebody who sees
 * this and then opens the app should not have to work out that they are the
 * same product.
 *
 * No framework, no CDN, no backslashes. The same rules as the terminal, for
 * the same reasons.
 */

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/** A download that may not exist yet says so rather than linking nowhere. */
function download(href: string, label: string, sub: string, primary: boolean): string {
  if (!href) {
    return `<span class="btn disabled"><b>${esc(label)}</b><em>coming soon</em></span>`;
  }
  return `<a class="btn${primary ? ' primary' : ''}" href="${esc(href)}">
    <b>${esc(label)}</b><em>${esc(sub)}</em>
  </a>`;
}

export function landingPage(origin: string): string {
  const support = config.links.support;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confam — the physical world, on demand</title>
<meta name="description" content="Ask about any place in Nigeria. Confam answers from evidence somebody already verified, or pays a person nearby to walk there and photograph it.">
<link rel="icon" href="${LOGO_DATA_URI}">
<style>
  :root {
    --bg:#0A0A0A; --surface:#141414; --sunken:#0E0E0E;
    --line:#232323; --line-strong:#333;
    --fg:#FAFAFA; --muted:#9C9C9C; --faint:#5F5F5F;
    --accent:#FF6B00; --accent-soft:#1B0F06; --ok:#3DD68C;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing:border-box; }
  * { scrollbar-width: thin; scrollbar-color: #2A2A2A transparent; }
  ::-webkit-scrollbar { width:10px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#242424; border:2px solid var(--bg); }
  html { -webkit-text-size-adjust:100%; scroll-behavior:smooth; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  a { color:var(--accent); }
  main { max-width:1040px; margin:0 auto; padding:0 22px; }

  /* ── Masthead ─────────────────────────────────────────────────────── */
  header {
    display:flex; align-items:center; gap:10px;
    max-width:1040px; margin:0 auto; padding:20px 22px;
  }
  header img { width:26px; height:26px; border-radius:6px; display:block; }
  .word { font-weight:800; letter-spacing:1.6px; font-size:17px; }
  .word em { font-style:normal; color:var(--accent); }
  header nav { margin-left:auto; display:flex; gap:20px; font-size:14px; }
  header nav a { color:var(--muted); text-decoration:none; }
  header nav a:hover { color:var(--fg); }
  @media (max-width:620px) { header nav { display:none; } }

  /* ── Hero ─────────────────────────────────────────────────────────── */
  .hero { padding:52px 0 8px; }
  h1 {
    font-size:clamp(38px, 8vw, 68px); line-height:1.02; margin:0 0 18px;
    font-weight:800; letter-spacing:-2px;
  }
  h1 span { color:var(--accent); display:block; }
  .lede { font-size:clamp(17px,2.4vw,20px); color:var(--muted); max-width:600px; margin:0 0 12px; }
  .asks { font-family:var(--mono); font-size:15px; color:var(--fg); margin:22px 0 30px; }
  .asks span { color:var(--faint); }

  .btns { display:flex; flex-wrap:wrap; gap:11px; }
  .btn {
    display:flex; flex-direction:column; gap:1px; text-decoration:none;
    border:2px solid var(--line-strong); border-radius:2px;
    padding:12px 20px; color:var(--fg); background:var(--surface); min-width:190px;
  }
  .btn b { font-size:15px; font-weight:700; }
  .btn em { font-style:normal; font-size:12.5px; color:var(--faint); }
  .btn:hover { border-color:var(--accent); }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#0A0A0A; }
  .btn.primary em { color:#0A0A0A; opacity:.7; }
  .btn.primary:hover { filter:brightness(1.08); }
  .btn.disabled { background:var(--sunken); border-color:var(--line); color:var(--faint); cursor:default; }

  /* ── Sections ─────────────────────────────────────────────────────── */
  section { padding:60px 0; border-top:1px solid var(--line); margin-top:52px; }
  h2 {
    font-size:11px; letter-spacing:1.6px; text-transform:uppercase; color:var(--faint);
    font-weight:700; margin:0 0 20px;
  }
  h3 { font-size:26px; line-height:1.2; margin:0 0 14px; font-weight:800; letter-spacing:-.7px; }
  p.body { color:var(--muted); max-width:620px; margin:0 0 14px; }

  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:14px; }
  .card { border:2px solid var(--line); border-radius:2px; padding:18px; background:var(--surface); }
  .card .n { font-family:var(--mono); font-size:12px; color:var(--accent); }
  .card b { display:block; margin:8px 0 5px; font-size:16px; }
  .card p { margin:0; color:var(--muted); font-size:14.5px; line-height:1.55; }

  .split { display:grid; grid-template-columns:1fr 1fr; gap:34px; align-items:start; }
  @media (max-width:760px) { .split { grid-template-columns:1fr; gap:24px; } }

  .term {
    border:2px solid var(--line-strong); border-radius:2px; background:#080808;
    font-family:var(--mono); font-size:12.5px; line-height:1.75; padding:15px; overflow-x:auto;
  }
  .term .p { color:var(--accent); }
  .term .g { color:var(--ok); }
  .term .d { color:var(--faint); }

  /* ── Footer ───────────────────────────────────────────────────────── */
  footer {
    border-top:1px solid var(--line); margin-top:52px; padding:30px 0 60px;
    color:var(--faint); font-size:14px;
  }
  footer .row { display:flex; flex-wrap:wrap; gap:20px; align-items:center; }
  footer a { color:var(--muted); text-decoration:none; }
  footer a:hover { color:var(--accent); }
  footer .small { margin-top:18px; font-size:13px; line-height:1.6; max-width:620px; }
</style>
</head>
<body>

<header>
  <img src="${LOGO_DATA_URI}" alt="Confam">
  <span class="word">CONFAM<em>AI</em></span>
  <nav>
    <a href="#how">How it works</a>
    <a href="#ai">Confam AI</a>
    <a href="${esc(origin)}/confamagent">Agent</a>
    <a href="#get">Get the app</a>
  </nav>
</header>

<main>
  <div class="hero">
    <h1>The physical world,<span>on demand.</span></h1>
    <p class="lede">
      Some things cannot be looked up. Confam pays somebody already standing there to go and
      look, and sends back the photograph.
    </p>
    <p class="asks">
      Is the road flooded? <span>&middot;</span> Is the queue long? <span>&middot;</span>
      Is the shop open? <span>&middot;</span> Did the delivery arrive?
    </p>

    <div class="btns" id="get">
      ${download(config.links.apk, 'Download for Android', 'APK, installs directly', true)}
      ${download(config.links.testflight, 'Get it on iPhone', 'TestFlight beta', false)}
      <a class="btn" href="${esc(origin)}/confamagent">
        <b>Try Confam Agent</b><em>in your browser, no install</em>
      </a>
    </div>
  </div>

  <section id="how">
    <h2>How it works</h2>
    <div class="grid">
      <div class="card">
        <span class="n">01</span>
        <b>You ask about a place</b>
        <p>A question and the spot it is about. Asking costs nothing.</p>
      </div>
      <div class="card">
        <span class="n">02</span>
        <b>Confam AI checks what is known</b>
        <p>If somebody verified that place recently and it still holds, you get it straight away
           with their photograph, and you can tip them for it.</p>
      </div>
      <div class="card">
        <span class="n">03</span>
        <b>Otherwise somebody goes</b>
        <p>You set what you will pay and how long they have. Whoever takes it first walks there
           in person.</p>
      </div>
      <div class="card">
        <span class="n">04</span>
        <b>You decide</b>
        <p>Photo or video comes back with the time and how far from the place it was taken.
           Confirm it and they are paid.</p>
      </div>
    </div>
  </section>

  <section id="ai">
    <h2>Confam AI</h2>
    <div class="split">
      <div>
        <h3>An agent that knows when to send a human.</h3>
        <p class="body">
          Every question goes to it first. It reads what somebody already verified about that
          place and how long ago, and decides one thing: does anybody have to go.
        </p>
        <p class="body">
          It never answers from its own knowledge. Everything it gives you came from a person who
          stood there, so a wrong answer is a wrong photograph rather than a confident guess.
        </p>
        <p class="body">
          Programs can use it too. An agent gets a key, asks questions, and pays the person who
          walks there, in USDC on Base.
        </p>
        <p style="margin-top:22px">
          <a href="${esc(origin)}/confamagent">Open the agent terminal &rarr;</a>
        </p>
      </div>
      <div class="term">
<span class="p">&gt;</span> is the road flooded right now?
<span class="p">where?</span> Oredo
  <span class="d">nobody has been. sending somebody. &#8358;150</span>
  <span class="d">0.09 USDC locked in escrow on Base</span>
  <span class="d">musa took it and is walking there...</span>
  <span class="g">answered by musa</span>

<b>Yes, the whole stretch past the market.</b>
  <span class="d">34m from the pin &middot; 2 minutes ago</span>
  <span class="d">verify on Base &rarr;</span>
      </div>
    </div>
  </section>

  <section>
    <h2>Proof, not promises</h2>
    <div class="grid">
      <div class="card">
        <b>The money is in a contract</b>
        <p>A bounty is locked in escrow on Base and released when you accept the answer. Nobody
           can move it in between, including us.</p>
      </div>
      <div class="card">
        <b>The evidence is committed</b>
        <p>A hash of every photograph is written to Base and signed by the verifier, so it can be
           proved the file was not swapped afterwards.</p>
      </div>
      <div class="card">
        <b>Check it yourself</b>
        <p>Every answer has a proof page: the hashes, the escrow, and every transaction. Hash the
           photo yourself and compare. Our servers are not in the path.</p>
      </div>
    </div>
  </section>
</main>

<footer>
  <main>
    <div class="row">
      <a href="${esc(origin)}/terms">Terms of service</a>
      <a href="${esc(origin)}/privacy">Privacy policy</a>
      <a href="${esc(origin)}/confamagent">Confam Agent</a>
      <a href="mailto:${esc(support)}">${esc(support)}</a>
    </div>
    <p class="small">
      Confam connects people who want something checked with people already nearby who will go and
      check it. Verifiers are independent. Answers describe one moment at one place, so do not lean
      on one for a decision that matters without checking it again.
    </p>
  </main>
</footer>

</body>
</html>`;
}

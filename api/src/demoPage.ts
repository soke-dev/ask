/**
 * The page a judge opens: a terminal.
 *
 * It was a marketing page with a form, which was the wrong shape twice over.
 * The audience is people who read logs, and more to the point the agent's work
 * is a sequence — it reads what the network knows, weighs it, decides, spends,
 * dispatches — and a card that appears fully formed hides every part of that.
 * A transcript shows the thinking, and several questions in a row build a
 * session rather than replacing one another.
 *
 * Served as a string rather than a file because tsc copies neither, and a demo
 * that works locally and 404s in production over a missing asset is the worst
 * available way to lose a submission.
 *
 * No framework, no CDN, and no backslashes. Anything escaped in here has to
 * survive a TypeScript template literal and then a JavaScript string literal,
 * and twice it did not — silently, because tsc sees a valid string while the
 * browser sees a SyntaxError that kills every handler on the page. The build
 * parses this script and fails if it cannot.
 */
import { LOGO_DATA_URI } from './logo.js';

export const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>confam — ask the physical world</title>
<link rel="icon" href="${LOGO_DATA_URI}">
<style>
  :root {
    --bg:#080808; --line:#1F1F1F;
    --fg:#D4D4D4; --dim:#6B6B6B; --faint:#454545;
    --accent:#FF6B00; --ok:#3DD68C; --warn:#FFB020;
  }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:13.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
    display:flex; justify-content:center; padding:0 12px;
  }
  .wrap { display:flex; width:100%; max-width:1120px; height:100dvh; }
  .term {
    flex:1; min-width:0; height:100dvh;
    display:flex; flex-direction:column;
    border-left:1px solid var(--line); border-right:1px solid var(--line);
  }

  /*
   * What the network answered lately, anywhere.
   *
   * A terminal shows one conversation, so a page open for ten seconds looks
   * like a network with nothing in it. This is the evidence that people who
   * are not you are using it.
   *
   * Hidden below 900px rather than stacked: on a phone it would push the
   * prompt off the screen, and the prompt is the whole point of the page.
   */
  .feed {
    width:300px; flex:none; height:100dvh; overflow-y:auto;
    border-right:1px solid var(--line); scrollbar-width:thin;
  }
  .feed::-webkit-scrollbar { width:8px; }
  .feed::-webkit-scrollbar-thumb { background:#1C1C1C; }
  .feed h2 {
    font-size:10.5px; letter-spacing:1.4px; text-transform:uppercase; color:var(--faint);
    font-weight:700; margin:0; padding:13px 14px 10px; border-bottom:1px solid var(--line);
    position:sticky; top:0; background:var(--bg);
  }
  .feed .item { padding:12px 14px; border-bottom:1px solid var(--line); }
  .feed .q { color:var(--fg); margin:0 0 5px; line-height:1.5; }
  .feed .m { color:var(--faint); font-size:11.5px; }
  .feed .ok { color:var(--ok); }
  .feed .no { color:var(--warn); }
  @media (max-width: 900px) { .feed { display:none; } }

  .bar {
    display:flex; align-items:center; gap:9px;
    padding:11px 14px; border-bottom:1px solid var(--line);
    color:var(--dim); font-size:12px; flex:none;
  }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--ok); flex:none; }
  /* The real mark, from the file the app icon is cut from. Inlined, so it
     cannot arrive late or not at all on a slow connection. */
  .plate { display:block; flex:none; line-height:0; }
  .plate img { width:20px; height:20px; border-radius:5px; display:block; }
  .plate:hover img { outline:2px solid var(--accent); outline-offset:1px; }
  .bar b { color:var(--accent); font-weight:700; letter-spacing:.5px; }
  /* The "ai" reads as part of the name without shouting over it. */
  .bar b em { font-style:normal; color:var(--ok); }
  .bar .right { margin-left:auto; color:var(--accent); font-weight:700; letter-spacing:.4px; }

  .log { flex:1; overflow-y:auto; padding:16px 14px 10px; scrollbar-width:thin; }
  .log::-webkit-scrollbar { width:8px; }
  .log::-webkit-scrollbar-thumb { background:#1C1C1C; }

  .ln { white-space:pre-wrap; overflow-wrap:anywhere; margin:0 0 2px; }
  .ln.you   { color:var(--fg); margin-top:15px; }
  .ln.you i { color:var(--accent); font-style:normal; }
  .ln.sys   { color:var(--dim); }
  .ln.ok    { color:var(--ok); }
  .ln.go    { color:var(--accent); }
  .ln.warn  { color:var(--warn); }
  .ln.big   { color:#fff; font-size:17px; font-weight:700; margin:7px 0 5px; }
  .ln.dim   { color:var(--faint); }
  .ln a     { color:var(--accent); }
  .ln img   { display:block; max-width:340px; width:100%; margin:9px 0 5px; border:1px solid var(--line); }
  .gutter   { color:var(--faint); }

  .copy {
    background:transparent; border:1px solid var(--line); color:var(--dim);
    font:inherit; font-size:11px; padding:1px 7px; margin-left:8px;
    cursor:pointer; border-radius:2px; vertical-align:2px;
  }
  .copy:hover { border-color:var(--accent); color:var(--accent); }
  .copy.done { border-color:var(--ok); color:var(--ok); }

  /* Suggestions, sitting directly above the prompt they fill. */
  .sug { border-top:1px solid var(--line); flex:none; }
  .sug div {
    padding:7px 14px; color:var(--dim); cursor:pointer;
    display:flex; gap:9px; align-items:baseline;
  }
  .sug div:hover, .sug div.on { background:#101010; color:var(--fg); }
  .sug div i { color:var(--faint); font-style:normal; flex:none; width:44px; }
  .sug div .area { color:var(--faint); margin-left:8px; font-size:12px; }
  .sug div:hover i, .sug div.on i { color:var(--accent); }

  .hints { padding:0 14px 12px; display:flex; flex-wrap:wrap; gap:6px; flex:none; }
  .hints button {
    background:transparent; border:1px solid var(--line); color:var(--dim);
    font:inherit; font-size:11.5px; padding:4px 9px; cursor:pointer; border-radius:2px;
  }
  .hints button:hover { border-color:var(--accent); color:var(--fg); }

  .row {
    display:flex; align-items:center; gap:9px;
    padding:12px 14px; border-top:1px solid var(--line); flex:none;
  }
  .ps1 { color:var(--accent); font-weight:700; flex:none; }
  input {
    flex:1; background:transparent; border:0; outline:none; color:var(--fg);
    font:inherit; padding:0; caret-color:var(--accent); min-width:0;
  }
  input::placeholder { color:#333; }
</style>
</head>
<body>
<div class="wrap">
<aside class="feed"><h2>Answered recently</h2><div id="feed"></div></aside>
<div class="term">
  <div class="bar">
    <a class="plate" href="https://confam.xyz" title="confam.xyz"><img src="${LOGO_DATA_URI}" alt="Confam"></a>
    <b>confam<em>ai</em></b>
    <span class="dot"></span>
    <span>the physical world, on demand</span>
    <span class="right" id="budget"></span>
  </div>

  <div class="log" id="log"></div>

  <div class="hints">
    <button data-c="/docs">/docs</button>
    <button data-c="/key">/key</button>
    <button data-c="/jobs">/jobs</button>
    <button data-c="/watch 1">/watch 1</button>
    <button data-c="/help">/help</button>
    <button data-c="/clear">/clear</button>
  </div>

  <div class="sug" id="sug" hidden></div>

  <div class="row">
    <span class="ps1" id="ps1">&gt;</span>
    <input id="in" autocomplete="off" autofocus placeholder="ask about any place, right now">
  </div>
</div>
</div>

<script>
const log = document.getElementById('log');
const box = document.getElementById('in');
const ps1 = document.getElementById('ps1');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

/** Appends a line and keeps the view pinned to the bottom, as a terminal does. */
function say(html, cls) {
  const p = document.createElement('p');
  p.className = 'ln ' + (cls || 'sys');
  p.innerHTML = html;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
  return p;
}

/**
 * Puts a copy control on a line, with a fallback that actually works.
 *
 * navigator.clipboard needs a secure context, and this page is opened over
 * plain http on a LAN address as often as not — where it is simply absent. The
 * textarea route is ugly and works everywhere, which is the right trade for a
 * key somebody is about to paste into a terminal.
 */
function withCopy(line, text) {
  const btn = line.querySelector('.copy');
  if (!btn) return line;
  btn.onclick = async () => {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {}
    if (!ok) {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      try { ok = document.execCommand('copy'); } catch {}
      t.remove();
    }
    btn.textContent = ok ? 'copied' : 'select it';
    btn.className = ok ? 'copy done' : 'copy';
    setTimeout(() => { btn.textContent = 'copy'; btn.className = 'copy'; }, 1600);
  };
  return line;
}

/** Indents continuation lines under the one that introduced them. */
const G = '<span class="gutter">  </span>';

function banner() {
  say('confam — ground truth, on demand.', 'ok');
  say('Places, events and situations: whether a road is passable, whether a queue');
  say('has formed, whether a shop still exists, what is actually happening at an');
  say('address right now. An agent decides whether anybody has to go and look,');
  say('and pays them in USDC on Base when they do.');
  say('');
  say('Type a question about a place, then where.', 'dim');
  say('e.g. is the road flooded right now?  ·  /docs to connect your own agent', 'dim');
}
banner();

/*
 * Two steps, because a job needs a place and asking for both on one line makes
 * people guess at a syntax. The prompt itself says which half it wants.
 */
let step = 'question';
let pending = '';

function prompt(mode) {
  step = mode;
  ps1.textContent = mode === 'place' ? 'where?' : mode === 'confirm' ? 'send? [y/n]' : '>';
  box.placeholder =
    mode === 'place' ? 'oredo' :
    mode === 'confirm' ? 'y' :
    'ask about any place, right now';
  box.focus();
  showSuggestions();
}

/*
 * Suggestions, shown the moment the prompt is touched.
 *
 * An empty terminal with a blinking cursor tells somebody nothing about what
 * it will accept, and a judge with thirty seconds will type nothing rather
 * than guess. Questions for the first step; for the second, places the network
 * has actually been — so a stranger is steered towards the answer that already
 * exists rather than paying to send somebody to a town nobody has visited.
 */
const ASKS = [
  'is there traffic right now?',
  'is the road flooded right now?',
  'is there light in this area?',
  'how long is the fuel queue?',
  'is the market open?',
  'is the shop still there?',
];

let PLACES = ['Etete Road', 'Oredo', 'Ikeja', 'Surulere'];
fetch('/demo/places')
  .then(r => r.json())
  .then(d => { if (d.places && d.places.length) PLACES = d.places; })
  .catch(() => {});

const sug = document.getElementById('sug');
let picked = -1;

/** Coordinates for the place last picked, so proximity matching can use them. */
let placeCoords = null;
/** Its area, so the answered feed in the app can find the question later. */
let placeArea = null;

function suggestions() {
  const typed = box.value.trim().toLowerCase();
  const pool = step === 'place' ? PLACES.map(p => ({ name: p })) :
               step === 'question' ? ASKS.map(a => ({ name: a })) : [];
  if (!pool.length) return [];
  return pool.filter(x => !typed || x.name.toLowerCase().includes(typed)).slice(0, 5);
}

/**
 * Anywhere real, once somebody starts typing a place.
 *
 * The fixed list only covers where the network has been, which is right for
 * steering towards a free answer and useless for asking about anywhere else.
 * Searching hands back coordinates too, so a place typed here matches by
 * proximity rather than by an exact string — the difference between "Etete"
 * and "Etete Road" finding each other, and not.
 */
let searchTimer = null;

async function searchPlaces() {
  const q = box.value.trim();
  if (step !== 'place' || q.length < 2) return;
  try {
    const r = await (await fetch('/demo/search?q=' + encodeURIComponent(q))).json();
    if (step !== 'place' || box.value.trim() !== q) return;   // moved on since
    if (!r.places || !r.places.length) return;
    renderSuggestions(r.places.slice(0, 6));
  } catch {}
}

function showSuggestions() {
  renderSuggestions(suggestions());
  if (step === 'place') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchPlaces, 220);
  }
}

function renderSuggestions(list) {
  if (!list || !list.length) { sug.hidden = true; return; }
  picked = -1;
  sug.innerHTML = list
    .map((x, i) => '<div data-i="' + i + '"><i>' +
      (step === 'place' ? (x.covered ? 'known' : 'where') : 'ask') + '</i>' +
      esc(x.name) +
      (x.area ? '<span class="area">' + esc(x.area) + '</span>' : '') + '</div>')
    .join('');
  sug.hidden = false;
  // mousedown, not click: blur would hide the list before a click landed.
  sug.querySelectorAll('div').forEach((el, i) => {
    el.onmousedown = (e) => {
      e.preventDefault();
      box.value = list[i].name;
      placeCoords = (list[i].lat != null && list[i].lng != null)
        ? { lat: list[i].lat, lng: list[i].lng } : null;
      // The geocoder already told us where this sits; the answered feed needs
      // it, and nothing else on the page was carrying it.
      placeArea = list[i].area || null;
      hideSuggestions();
      submit();
    };
  });
}

function hideSuggestions() { sug.hidden = true; picked = -1; }

box.addEventListener('focus', showSuggestions);
box.addEventListener('input', showSuggestions);
box.addEventListener('blur', () => setTimeout(hideSuggestions, 120));

document.querySelectorAll('.hints button').forEach(b => {
  b.onclick = () => { box.value = b.dataset.c; submit(); };
});

box.addEventListener('keydown', (e) => {
  const items = sug.hidden ? [] : Array.from(sug.querySelectorAll('div'));

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    picked = e.key === 'ArrowDown'
      ? (picked + 1) % items.length
      : (picked <= 0 ? items.length - 1 : picked - 1);
    items.forEach((el, i) => el.className = i === picked ? 'on' : '');
    return;
  }

  if (e.key === 'Escape') { hideSuggestions(); return; }

  if (e.key === 'Enter') {
    if (picked >= 0 && items[picked]) box.value = items[picked].textContent.replace(/^(ask|where)/, '');
    hideSuggestions();
    submit();
  }
});

async function submit() {
  const text = box.value.trim();
  if (!text) return;
  box.value = '';

  /*
   * A command is a command wherever it is typed.
   *
   * They were only intercepted at the question prompt, so answering "where?"
   * with /jobs created a job whose place was literally "/jobs" — and spent
   * money doing it. Anything starting with a slash is never a place.
   */
  if (text[0] === '/') {
    say('<i>' + esc(ps1.textContent) + '</i> ' + esc(text), 'you');
    if (step !== 'question') prompt('question');
    return command(text);
  }

  if (step === 'question') {
    pending = text;
    placeCoords = null;
    placeArea = null;
    say('<i>&gt;</i> ' + esc(text), 'you');
    prompt('place');
    return;
  }

  if (step === 'confirm') {
    say('<i>send? [y/n]</i> ' + esc(text), 'you');
    const yes = /^(y|yes)$/i.test(text);
    prompt('question');
    if (!yes) { say(G + 'nothing sent. no money moved.', 'dim'); return; }
    await ask(offer.question, offer.place, true, offer.at, lastArea);
    return;
  }

  say('<i>where?</i> ' + esc(text), 'you');
  const place = text;
  const at = placeCoords;
  const area = placeArea;
  prompt('question');
  await ask(pending, place, false, at, area);
}

/** What the agent proposed to spend on, held while the y/n is answered. */
let offer = { question: '', place: '', at: null };
/** The coordinates the last ask used, so a confirmation reuses them. */
let lastAt = null;
let lastArea = null;

function command(c) {
  const name = c.slice(1).split(' ')[0];
  if (name === 'help') {
    say(G + 'a question, then a place   ask the agent');
    say(G + '/docs                      how to point your own agent at this');
    say(G + '/key                       an API key for your own agent');
    say(G + '/jobs                      jobs posted from this browser');
    say(G + '/watch &lt;n&gt;                 follow job n for live updates');
    say(G + '/clear                     clear the screen');
    return;
  }
  if (name === 'clear') { log.innerHTML = ''; banner(); return; }
  if (name === 'jobs') return jobs();
  if (name === 'docs' || name === 'api') return docs();
  if (name === 'watch') {
    const n = parseInt(c.slice(1).split(' ')[1], 10);
    const list = saved();
    const j = list[n - 1];
    if (!j) { say(G + 'no job ' + (n || '') + '. /jobs to see them.', 'warn'); return; }
    const line = say(G + esc(j.question) + ' @ ' + esc(j.place) + ' — following...', 'dim');
    watch(j.id, line);
    return;
  }
  if (name === 'key') return getKey();
  say(G + 'unknown command. /help', 'warn');
}

async function ask(question, place, confirm, at, area) {
  lastAt = at || lastAt;
  lastArea = area || lastArea;
  const thinking = say(G + (confirm ? 'locking the bounty on Base...' : 'checking what the network already knows...'), 'dim');
  try {
    const r = await fetch('/demo/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question, place, confirm: confirm === true,
        lat: at ? at.lat : null, lng: at ? at.lng : null,
        area: area || lastArea || null,
      }),
    });
    const d = await r.json();
    thinking.remove();
    render(d, question, place);
  } catch (e) {
    thinking.remove();
    say(G + 'could not reach the agent — ' + esc(e.message || e), 'warn');
  }
  budget();
}

function render(d, question, place) {
  if (d.status === 'answered') {
    say(G + 'somebody has already been here.', 'ok');
    say(G + esc(d.because), 'dim');
    say(esc(d.answer), 'big');
    say(G + 'asked as "' + esc(d.askedAs) + '" · ' + d.ageMinutes + ' min ago' +
        (d.verifier ? ' · checked by ' + esc(d.verifier) : ''), 'dim');
    (d.evidence || []).forEach(u => say('<img src="' + esc(u) + '" alt="evidence">', 'dim'));
    say(G + '<a href="/escrow/' + esc(d.questionId) + '/proof" target="_blank" rel="noopener">' +
        'verify on Base →</a> · cost ₦' + d.costNgn, 'dim');
    return;
  }

  if (d.status === 'needs_confirm') {
    say(G + esc(d.because), 'dim');
    say(G + 'nobody has been. sending somebody costs ₦' + d.costNgn +
        ' and locks that in USDC on Base.', 'go');
    offer = { question: d.question, place: d.place, at: lastAt };
    prompt('confirm');
    return;
  }

  if (d.status === 'dispatched') {
    say(G + esc(d.because), 'dim');
    say(G + 'nobody has been. sending somebody. ₦' + d.costNgn, 'go');
    if (d.chain && d.chain.funded) {
      say(G + d.chain.usdc + ' USDC locked in escrow on Base · ' +
          '<a href="https://basescan.org/tx/' + esc(d.chain.txHash) + '" target="_blank" rel="noopener">' +
          esc(String(d.chain.txHash).slice(0, 22)) + '...</a>', 'dim');
    } else if (d.chain) {
      say(G + 'not funded on chain — ' + esc(d.chain.why || 'unknown'), 'warn');
    }
    const live = say(G + 'waiting for a verifier to take it...', 'dim');
    remember(d.id, question, place);
    watch(d.id, live);
    return;
  }

  const why = {
    no_demo_key: 'dispatch is not funded on this server.',
    budget_spent: 'the budget is used up, so no more jobs can be posted.',
    already_posted: 'you have already posted a job. one per visitor.',
    bad_demo_key: 'the demo key is not valid.',
  }[d.reason] || '';
  say(G + esc(d.because), 'dim');
  say(G + 'somebody would have to go' + (why ? ' — ' + esc(why) : ''), 'warn');
}

/** Jobs already being polled, so following one twice does not double up. */
const watching = new Set();

function watch(id, line) {
  if (watching.has(id)) return;
  watching.add(id);
  const timer = setInterval(async () => {
    try {
      const j = await (await fetch('/demo/job/' + id)).json();
      if (j.status === 'in_progress') {
        line.className = 'ln go';
        line.innerHTML = G + esc(j.verifier || 'somebody') + ' took it and is walking there...';
      }
      if (j.status === 'answered') {
        clearInterval(timer);
        watching.delete(id);
        line.className = 'ln ok';
        line.innerHTML = G + 'answered by ' + esc(j.verifier || 'a verifier');
        say(esc(j.answer), 'big');
        say(G + (j.metresFromPlace != null ? j.metresFromPlace + 'm from the pin · ' : '') +
            (j.capturedAt ? new Date(j.capturedAt).toUTCString() : ''), 'dim');
        (j.evidence || []).forEach(u => say('<img src="' + esc(u) + '" alt="evidence">', 'dim'));
        say(G + '<a href="' + esc(j.proof) + '" target="_blank" rel="noopener">verify on Base →</a>', 'dim');
        feed();
      }
    } catch {}
  }, 5000);
}

/*
 * Jobs this browser has posted.
 *
 * A job takes as long as somebody takes to walk somewhere, which is longer
 * than anybody keeps a tab open. localStorage rather than the server: the page
 * has no account to hang it on, and asking for one in order to watch a demo
 * would defeat the point of a page anybody can open.
 */
const STORE = 'confam.demo.jobs';

function saved() {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; }
}

function remember(id, question, place) {
  try {
    const list = saved().filter(j => j.id !== id);
    list.unshift({ id, question, place, at: Date.now() });
    localStorage.setItem(STORE, JSON.stringify(list.slice(0, 8)));
  } catch {}
}

async function jobs() {
  const list = saved();
  if (!list.length) { say(G + 'no jobs from this browser yet.', 'dim'); return; }
  say(G + 'follow one to get updates as they happen, or /watch <n>', 'dim');
  for (let n = 0; n < list.length; n += 1) {
    const j = list[n];
    const head = '[' + (n + 1) + '] ' + esc(j.question) + ' @ ' + esc(j.place) + ' — ';
    const line = say(G + head + 'checking...', 'dim');
    try {
      const r = await (await fetch('/demo/job/' + j.id)).json();
      if (r.status === 'answered') {
        line.className = 'ln ok';
        line.innerHTML = G + head + esc(r.answer) +
          ' · <a href="' + esc(r.proof) + '" target="_blank" rel="noopener">proof</a>';
      } else if (r.status === 'in_progress') {
        line.className = 'ln go';
        line.innerHTML = G + head + esc(r.verifier || 'somebody') + ' is walking there';
      } else if (r.refundable) {
        /*
         * Nobody took it and the clock ran out, so the USDC is still sitting
         * in the contract. Offered rather than swept quietly: it is the
         * visitor's job, and watching the money come back is the clearest
         * demonstration that it was ever really there.
         */
        line.className = 'ln warn';
        line.innerHTML = G + head + 'expired, nobody took it' +
          '<button class="copy" data-refund="' + esc(j.id) + '">refund</button>';
        const btn = line.querySelector('[data-refund]');
        btn.onclick = () => refund(j.id, line, head);
      } else if (r.refundTx) {
        line.className = 'ln dim';
        line.innerHTML = G + head + 'expired and refunded · ' +
          '<a href="https://basescan.org/tx/' + esc(r.refundTx) + '" target="_blank" rel="noopener">tx</a>';
      } else {
        line.innerHTML = G + head + 'waiting for somebody to take it' + follow(j.id);
      }
      if (r.status === 'in_progress') line.innerHTML += follow(j.id);
      const f = line.querySelector('[data-follow]');
      if (f) f.onclick = () => { f.remove(); watch(j.id, line); };
    } catch {}
  }
}

/** The control that starts live updates on a job from the list. */
function follow(id) {
  return watching.has(id)
    ? '<span class="copy" style="cursor:default">following</span>'
    : '<button class="copy" data-follow="' + esc(id) + '">follow</button>';
}

/**
 * How to point a program at this.
 *
 * Kept in the terminal rather than on a documentation site, because the thing
 * somebody wants at the moment they get a key is the next command, and a link
 * to read later is a link nobody opens. Short enough to fit on one screen and
 * complete enough to work from.
 */
function docs() {
  const base = location.origin;
  const K = '<span class="gutter">  </span>';

  say('CONNECT YOUR AGENT', 'ok');
  say(K + 'Nothing here needs this page. It is one discovery call and two to');
  say(K + 'get a key, all of which a program can do on its own.');
  say('');
  say(K + 'GET ' + base + '/agent', 'go');
  say(K + 'returns ready-made confam_ask and confam_result tool definitions,');
  say(K + 'the auth steps, the limits and the proof url. drop the tools');
  say(K + 'straight into your model call.');
  say('');
  say(K + 'Then mint a key. No browser: signing a message is something your', 'sys');
  say(K + 'agent does with its own key. window.ethereum is only the human', 'sys');
  say(K + 'route to the same signature.', 'sys');
  say('');
  say(K + 'POST ' + base + '/agent/keys/challenge   {"address":"0x..."}', 'go');
  say(K + '  -> { "message": "Confam - create an API key ..." }');
  say(K + 'sign that message (personal_sign / EIP-191), then', 'go');
  say(K + 'POST ' + base + '/agent/keys/wallet      {"address":"0x...","signature":"0x..."}');
  say(K + '  -> { "token": "sk_confam_..." }');
  say('');
  say(K + 'viem:   await account.signMessage({ message })');
  say(K + 'ethers: await wallet.signMessage(message)');
  say('');
  say(K + 'send it as: Authorization: Bearer sk_confam_...');
  say(K + 'the key is bound to that address, which is also the wallet you');
  say(K + 'would fund your own jobs from.');
  say('');
  say(K + 'or run /key here and let the browser sign it for you.', 'dim');
  say('');

  say('ASK A QUESTION', 'go');
  say(K + 'POST ' + base + '/agent/ask');
  say(K + '{ "question": "Is the gate open?", "place": "Apapa",');
  say(K + '  "lat": 6.4478, "lng": 3.3619, "bountyNgn": 150 }');
  say('');
  say(K + 'Answers one of two ways. If somebody nearby verified that place');
  say(K + 'recently and it still holds, it returns at once with the photograph');
  say(K + 'and costs ₦50. Otherwise it locks the bounty in escrow on Base and', 'sys');
  say(K + 'puts a job on the board for a person to walk to.', 'sys');
  say('');

  say('GET THE ANSWER', 'go');
  say(K + 'GET ' + base + '/agent/ask/<id>');
  say(K + 'poll it. returns the answer, the photographs, the metres from the');
  say(K + 'pin, the capture time and the verifier.');
  say('');

  say('WHO PAYS', 'go');
  say(K + 'we fund ₦150 to ₦300, five jobs a key a day.');
  say(K + 'for more, send "selfFund": true — the job is created and you sign');
  say(K + 'the escrow yourself from the wallet your key is bound to, through');
  say(K + 'POST /escrow/<id>/fund/quote then POST /escrow/<id>/fund.');
  say(K + 'no limits apply to your own money.');
  say('');

  say('CHECK THE PROOF', 'go');
  say(K + 'GET ' + base + '/escrow/<id>/proof   (no key needed)');
  say(K + 'returns the keccak256 of every evidence file, the escrow job id,');
  say(K + 'and the funding, claim and release transactions on Base. hash the');
  say(K + 'photograph yourself and compare — this server is not in the way.');
  say('');

  say('DO JOBS AS AN AGENT', 'go');
  say(K + 'not yet. taking a job means being at the place, and the app proves');
  say(K + 'that with GPS at the moment of capture — which is exactly what a', 'sys');
  say(K + 'program cannot honestly provide. verifiers are people, on purpose.', 'sys');
  say('');
  say(K + 'confam.xyz', 'dim');
}

/** Asks the contract for an expired job's money back. */
async function refund(id, line, head) {
  line.className = 'ln dim';
  line.innerHTML = G + head + 'asking the contract for it back...';
  try {
    const r = await (await fetch('/demo/job/' + id + '/refund', { method: 'POST' })).json();
    if (r.ok) {
      line.className = 'ln ok';
      line.innerHTML = G + head + 'refunded' +
        (r.txHash ? ' · <a href="https://basescan.org/tx/' + esc(r.txHash) +
        '" target="_blank" rel="noopener">' + esc(String(r.txHash).slice(0, 20)) + '...</a>' : '');
      budget();
    } else {
      line.className = 'ln warn';
      line.innerHTML = G + head + 'could not refund — ' + esc(r.detail || r.error);
    }
  } catch (e) {
    line.className = 'ln warn';
    line.innerHTML = G + head + 'could not refund — ' + esc(e.message || e);
  }
}

async function getKey() {
  if (!window.ethereum) {
    say(G + 'no wallet in this browser. POST /agent/keys/challenge yourself instead.', 'warn');
    return;
  }
  say(G + 'check your wallet...', 'dim');
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts[0];

    const c = await (await fetch('/agent/keys/challenge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })).json();
    if (c.error) throw new Error(c.error);

    const signature = await window.ethereum.request({
      method: 'personal_sign', params: [c.message, address],
    });

    const r = await (await fetch('/agent/keys/wallet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature }),
    })).json();
    if (!r.token) throw new Error(r.detail || r.error || 'could not mint a key');

    const curl = 'curl -X POST ' + location.origin + '/agent/ask' +
      ' -H "Authorization: Bearer ' + r.token + '"' +
      ' -H "Content-Type: application/json"' +
      " -d '" + JSON.stringify({ question: 'Is the gate open?', place: 'Apapa' }) + "'";

    say(G + 'key for ' + esc(r.address), 'ok');
    withCopy(say(G + esc(r.token) + '<button class="copy">copy</button>', 'big'), r.token);
    say(G + esc(r.warning || 'copy it now - it is not stored and cannot be shown again.'), 'warn');
    say('');
    // The whole command, with the real key in it rather than the truncated one
    // shown, so what gets pasted is what actually runs.
    withCopy(
      say(G + esc('curl -X POST ' + location.origin + '/agent/ask -H "Authorization: Bearer ' +
        r.token.slice(0, 20) + '..." -H "Content-Type: application/json" -d ' +
        JSON.stringify({ question: 'Is the gate open?', place: 'Apapa' })) +
        '<button class="copy">copy</button>', 'dim'),
      curl,
    );
  } catch (e) {
    say(G + esc(e.message || e), 'warn');
  }
}

/**
 * Read but not displayed in the bar any more.
 *
 * A running count of somebody else's budget is not what a visitor is there
 * for, and it made the header read like a meter. It still gets checked, so
 * /ask can say plainly when the money has run out — which is the only moment
 * the number actually matters.
 */
/**
 * Fills the side column, and keeps it current.
 *
 * Refreshed on a slow timer rather than pushed: nothing here is urgent, and a
 * socket for a list nobody is waiting on is a connection to keep alive for no
 * reason. It also refreshes after an answer arrives, since the job somebody
 * just watched should appear in it.
 */
async function feed() {
  try {
    const r = await (await fetch('/demo/answered')).json();
    const box = document.getElementById('feed');
    if (!box) return;
    if (!r.answered || !r.answered.length) {
      box.innerHTML = '<div class="item"><p class="m">Nothing answered yet.</p></div>';
      return;
    }
    box.innerHTML = r.answered.map(a =>
      '<div class="item">' +
      '<p class="q">' + esc(a.text) + '</p>' +
      '<p class="m"><span class="' + (a.confirmed ? 'ok' : 'no') + '">' +
      (a.confirmed ? 'Confirmed' : 'Unconfirmed') + '</span>' +
      ' &middot; ' + esc(a.ago) + ' &middot; ' + esc(a.where) + '</p>' +
      '</div>'
    ).join('');
  } catch {}
}
feed();
setInterval(feed, 60_000);

async function budget() {
  try { await (await fetch('/demo/budget')).json(); } catch {}
}
budget();

/** Clicking anywhere puts you back on the prompt, the way a terminal does. */
document.addEventListener('click', (e) => {
  if (!e.target.closest('a') && !e.target.closest('button')) box.focus();
});
</script>
</body>
</html>`;

/**
 * The page a judge opens.
 *
 * Served as a string rather than a file because `tsc` copies neither, and a
 * demo that works locally and 404s in production because a static asset was
 * not in the build is the worst possible way to lose a submission.
 *
 * No framework and no CDN. It is one form, one result, and a poll — anything
 * more is a dependency that can fail on somebody else's network at three in
 * the morning, which is exactly when this will be opened.
 */
export const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confam — ask the physical world</title>
<style>
  :root {
    --bg:#0A0A0A; --surface:#141414; --line:#262626; --fg:#FAFAFA;
    --muted:#A3A3A3; --faint:#666; --accent:#FF6B00; --ok:#22C55E;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    padding:28px 18px 64px;
  }
  main { max-width:640px; margin:0 auto; }
  .mark { display:flex; align-items:center; gap:10px; margin-bottom:26px; }
  .plate {
    width:26px; height:26px; border:2px solid var(--accent); border-radius:6px;
    display:grid; place-items:center; color:var(--accent); font-weight:800; font-size:14px;
  }
  .word { font-weight:800; letter-spacing:1.6px; font-size:18px; }
  h1 { font-size:30px; line-height:1.15; margin:0 0 10px; font-weight:800; letter-spacing:-.4px; }
  h1 em { color:var(--accent); font-style:normal; }
  .sub { color:var(--muted); margin:0 0 26px; }
  form { border:2px solid var(--line); background:var(--surface); border-radius:2px; padding:16px; }
  label { display:block; font-size:11px; letter-spacing:1.2px; text-transform:uppercase; color:var(--faint); margin-bottom:6px; }
  input {
    width:100%; background:var(--bg); border:2px solid var(--line); border-radius:2px;
    color:var(--fg); padding:11px 12px; font:inherit; margin-bottom:14px;
  }
  input:focus { outline:none; border-color:var(--accent); }
  button {
    width:100%; background:var(--accent); color:#0A0A0A; border:0; border-radius:2px;
    padding:13px; font:inherit; font-weight:800; letter-spacing:1px; text-transform:uppercase;
    cursor:pointer;
  }
  button:disabled { background:#2A2A2A; color:var(--faint); cursor:default; }
  .examples { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0 0; }
  .examples button {
    width:auto; background:transparent; border:2px solid var(--line); color:var(--muted);
    padding:6px 10px; font-size:12px; text-transform:none; letter-spacing:0; font-weight:500;
  }
  .card { border:2px solid var(--line); border-radius:2px; padding:16px; margin-top:16px; background:var(--surface); }
  .card.hit { border-color:var(--ok); }
  .card.go { border-color:var(--accent); }
  .tag { font-size:11px; letter-spacing:1.2px; text-transform:uppercase; }
  .tag.hit { color:var(--ok); } .tag.go { color:var(--accent); }
  .why { color:var(--fg); margin:8px 0 0; }
  .meta { color:var(--faint); font-size:13px; margin-top:10px; font-family:ui-monospace,Menlo,monospace; }
  .answer { font-size:19px; font-weight:700; margin:10px 0 0; }
  img { width:100%; border:2px solid var(--line); border-radius:2px; margin-top:12px; display:block; }
  a { color:var(--accent); }
  .foot { color:var(--faint); font-size:13px; margin-top:26px; }
  .spin { display:inline-block; width:11px; height:11px; border:2px solid var(--faint);
          border-top-color:var(--accent); border-radius:50%; animation:s .7s linear infinite; }
  @keyframes s { to { transform:rotate(360deg); } }
</style>
</head>
<body>
<main>
  <div class="mark"><div class="plate">C</div><div class="word">CONFAM</div></div>

  <h1>Ask the physical world.<br><em>A human goes and looks.</em></h1>
  <p class="sub">
    This agent answers questions no API can. It first checks whether somebody nearby
    already verified that place and whether the answer still holds. If not, it pays
    a real person in Nigeria to walk there and photograph it.
  </p>

  <form id="f">
    <label for="q">What do you want checked?</label>
    <input id="q" placeholder="Is the road flooded right now?" maxlength="200" required>
    <label for="p">Where?</label>
    <input id="p" placeholder="Oredo" maxlength="120" required>
    <button id="go" type="submit">Ask the agent</button>
    <div class="examples">
      <button type="button" data-q="Is there light in Etete?" data-p="Etete Road">light in Etete</button>
      <button type="button" data-q="Is the road flooded right now?" data-p="Oredo">flooding in Oredo</button>
      <button type="button" data-q="Is the market open?" data-p="Ikeja">market in Ikeja</button>
    </div>
  </form>

  <div id="out"></div>

  <p class="foot" id="budget"></p>
  <p class="foot">
    Jobs posted here are real: money leaves a real balance and a real person may walk
    somewhere. The demo budget is capped and one job is allowed per visitor.
  </p>
</main>

<script>
const $ = (s) => document.querySelector(s);
const out = $('#out'), go = $('#go');
let polling = null;

document.querySelectorAll('.examples button').forEach(b =>
  b.onclick = () => { $('#q').value = b.dataset.q; $('#p').value = b.dataset.p; });

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

async function budget() {
  try {
    const b = await (await fetch('/demo/budget')).json();
    $('#budget').textContent = b.configured
      ? b.jobsLeft + ' job' + (b.jobsLeft === 1 ? '' : 's') + ' left in the demo budget.'
      : 'Dispatch is not funded on this server, so the agent will decide but not send anybody.';
  } catch {}
}
budget();

$('#f').onsubmit = async (e) => {
  e.preventDefault();
  if (polling) { clearInterval(polling); polling = null; }
  go.disabled = true; go.textContent = 'Thinking…';
  out.innerHTML = '';

  try {
    const r = await fetch('/demo/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: $('#q').value, place: $('#p').value }),
    });
    render(await r.json());
  } catch (err) {
    out.innerHTML = '<div class="card"><div class="tag">Error</div><p class="why">' + esc(err) + '</p></div>';
  } finally {
    go.disabled = false; go.textContent = 'Ask the agent';
    budget();
  }
};

function render(d) {
  if (d.status === 'answered') {
    out.innerHTML =
      '<div class="card hit"><div class="tag hit">Already answered · ₦' + d.costNgn + '</div>' +
      '<p class="answer">' + esc(d.answer) + '</p>' +
      '<p class="why">' + esc(d.because) + '</p>' +
      '<p class="meta">asked as “' + esc(d.askedAs) + '” · ' + d.ageMinutes + ' min ago' +
      (d.verifier ? ' · ' + esc(d.verifier) : '') + '</p>' +
      (d.evidence || []).map(u => '<img src="' + esc(u) + '" alt="evidence">').join('') +
      '<p class="meta"><a href="/escrow/' + esc(d.questionId) + '/proof">verify this on Base →</a></p>' +
      '</div>';
    return;
  }

  if (d.status === 'dispatched') {
    out.innerHTML =
      '<div class="card go" id="job"><div class="tag go">Somebody has to go · ₦' + d.costNgn + '</div>' +
      '<p class="why">' + esc(d.because) + '</p>' +
      '<p class="meta"><span class="spin"></span> waiting for a verifier to take it…</p>' +
      '<p class="meta">' + d.jobsLeft + ' demo jobs left</p></div>';
    watch(d.id);
    return;
  }

  const why = {
    no_demo_key: 'Dispatch is not funded on this server.',
    budget_spent: 'The demo budget is used up, so no more jobs can be posted.',
    already_posted: 'You have already posted a job. One per visitor.',
    bad_demo_key: 'The demo key is not valid.',
  }[d.reason] || '';

  out.innerHTML =
    '<div class="card go"><div class="tag go">Somebody would have to go</div>' +
    '<p class="why">' + esc(d.because) + '</p>' +
    (why ? '<p class="meta">' + esc(why) + '</p>' : '') + '</div>';
}

function watch(id) {
  polling = setInterval(async () => {
    try {
      const j = await (await fetch('/demo/job/' + id)).json();
      const card = document.querySelector('#job');
      if (!card) return;
      if (j.status === 'in_progress') {
        card.querySelector('.meta').innerHTML =
          '<span class="spin"></span> ' + esc(j.verifier || 'somebody') + ' took it and is walking there…';
      }
      if (j.status === 'answered') {
        clearInterval(polling); polling = null;
        card.className = 'card hit';
        card.innerHTML =
          '<div class="tag hit">Answered by a human</div>' +
          '<p class="answer">' + esc(j.answer) + '</p>' +
          '<p class="meta">' + esc(j.verifier || 'a verifier') + ' walked there' +
          (j.metresFromPlace != null ? ' · ' + j.metresFromPlace + 'm from the pin' : '') +
          (j.capturedAt ? ' · ' + new Date(j.capturedAt).toUTCString() : '') + '</p>' +
          (j.evidence || []).map(u => '<img src="' + esc(u) + '" alt="evidence">').join('') +
          '<p class="meta"><a href="' + esc(j.proof) + '">verify this on Base →</a></p>';
      }
    } catch {}
  }, 5000);
}
</script>
</body>
</html>`;

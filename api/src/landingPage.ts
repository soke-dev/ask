import { LOGO_DATA_URI } from './logo.js';
import { config } from './config.js';
import { APP_SHOT_DATA_URI, APP_SHOT_BG, APP_SHOT_SIZE } from './appShot.js';

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
 * same product. The phone in the hero holds a real screenshot rather than a
 * drawing of one, because somebody deciding whether to install this is
 * entitled to see the thing they would be installing. It goes stale when the
 * home screen changes, which is what "npm run shot" is for.
 *
 * No framework, no CDN, no backslashes. The same rules as the terminal, for
 * the same reasons.
 */

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/**
 * The icons.
 *
 * Drawn here rather than pulled from a package, for the same reason the rest
 * of this file has no framework: a landing page that waits on somebody else's
 * CDN to show its own buttons is worse than one that draws four lines itself.
 *
 * They are stroked outlines on a 24 unit box, which is what the app uses, so a
 * card here and a row in the app read as the same hand. The brand marks are
 * filled, because a logo is a silhouette and an outlined one looks like a
 * mistake.
 */
const ICONS: Record<string, string> = {
  /* Asking. A question said to somebody, not typed into a box. */
  ask: '<path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12z"/>'
     + '<path d="M9.8 9.4a2.3 2.3 0 1 1 3.1 2.2c-.6.2-.9.7-.9 1.3v.4"/>'
     + '<path d="M12 16.2v.01"/>',

  /* The agent. A sparkle, the one shape everybody already reads as this. */
  ai: '<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5 9.3 11.7 4.5 10l4.8-1.7z"/>'
    + '<path d="M17.8 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',

  /* Somebody goes. The pin is the place; the point is a person reaches it. */
  place: '<path d="M12 21.2s6.8-6.1 6.8-10.7a6.8 6.8 0 1 0-13.6 0c0 4.6 6.8 10.7 6.8 10.7z"/>'
       + '<circle cx="12" cy="10.3" r="2.6"/>',

  /* You decide. */
  check: '<circle cx="12" cy="12" r="8.6"/><path d="m8.4 12.2 2.5 2.5 4.7-5.1"/>',

  /* The money. */
  lock: '<rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.2"/>'
      + '<path d="M8.2 10.4V7.2a3.8 3.8 0 0 1 7.6 0v3.2"/><path d="M12 14.6v2.2"/>',

  /* The evidence. A hash, because that is literally what is written down. */
  hash: '<path d="M9.4 3.6 7.2 20.4M17 3.6l-2.2 16.8M4.2 8.6h16M3.4 15.4h16"/>',

  /* Check it yourself. */
  shield: '<path d="M12 3.2l7 2.9v5.4c0 4.5-2.9 8.1-7 9.3-4.1-1.2-7-4.8-7-9.3V6.1z"/>'
        + '<path d="m9 12 2.2 2.2 4.3-4.5"/>',

  /* A browser window with a prompt in it. */
  terminal: '<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.2"/>'
          + '<path d="M3.2 9h17.6"/><path d="m7.6 13 2.2 2.2-2.2 2.2M12.8 17.2h4"/>',

  mail: '<rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.2"/>'
      + '<path d="m3.8 6.6 8.2 5.9 8.2-5.9"/>',

  chev: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',

  /*
   * Outlined, not filled. A solid body needs its eyes punched out in the
   * colour behind it, and an icon cannot know what it is sitting on: on the
   * orange button the body is near black and eyes in the surface colour
   * disappear into it. Outline works on every background there is.
   */
  android: '<path d="M6 10.6a6 6 0 0 1 12 0v6.2a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 16.8z"/>'
         + '<path d="M8.6 5.7 7.2 3.2M15.4 5.7l1.4-2.5"/>'
         + '<circle cx="9.9" cy="9.9" r=".55" fill="currentColor" stroke="none"/>'
         + '<circle cx="14.1" cy="9.9" r=".55" fill="currentColor" stroke="none"/>',

  /* The brand marks below are Simple Icons, MIT. */
  apple: '<path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.088-4.61 1.088zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>',

  x: '<path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zM17.61 20.644h2.039L6.486 3.24H4.298z"/>',

  github: '<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>',

  telegram: '<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>',
};

function icon(name: string, solid = false): string {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="ico${solid ? ' solid' : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

/** A download that may not exist yet says so rather than linking nowhere. */
function download(
  href: string,
  label: string,
  sub: string,
  primary: boolean,
  mark: string,
): string {
  if (!href) {
    return `<span class="btn disabled">${mark}<span class="txt">
      <b>${esc(label)}</b><em>coming soon</em>
    </span></span>`;
  }
  return `<a class="btn${primary ? ' primary' : ''}" href="${esc(href)}">${mark}<span class="txt">
    <b>${esc(label)}</b><em>${esc(sub)}</em>
  </span></a>`;
}

/**
 * One question and its answer.
 *
 * Closed until somebody wants it. Written as details rather than as a script,
 * so it opens with no JavaScript at all and a search engine still reads every
 * answer on the page.
 */
function faq(question: string, answer: string): string {
  return `<details>
    <summary><span>${esc(question)}</span>${icon('chev')}</summary>
    <div class="answer">${answer}</div>
  </details>`;
}

/** Renders only when the link exists, so nothing points at an empty profile. */
function social(href: string, name: string, label: string): string {
  if (!href) return '';
  return `<a class="soc" href="${esc(href)}" target="_blank" rel="noopener"
    aria-label="${esc(label)}" title="${esc(label)}">${icon(name, true)}</a>`;
}

export function landingPage(origin: string): string {
  const { support, apk, testflight } = config.links;

  // The same pair opens the page and closes it, so a reader who scrolls the
  // whole thing does not have to scroll back up to act on it.
  const stores =
    download(apk, 'Download for Android', 'APK, installs directly', true, icon('android')) +
    download(testflight, 'Get it on iPhone', 'TestFlight beta', false, icon('apple', true));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confam — the physical world, on demand</title>
<meta name="description" content="Ask about any place in Nigeria. Confam answers from evidence somebody already verified, or pays a person nearby to walk there and send back a photo or a video.">
<meta property="og:title" content="Confam — the physical world, on demand">
<meta property="og:description" content="Somebody already standing there goes and looks, and sends back the photo or the video.">
<link rel="icon" href="${LOGO_DATA_URI}">
<style>
  :root {
    --bg:#0A0A0A; --surface:#131313; --sunken:#0E0E0E;
    --line:#222; --line-strong:#333;
    --fg:#FAFAFA; --muted:#9C9C9C; --faint:#5F5F5F;
    --accent:#FF6B00; --ok:#3DD68C;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --shot: ${APP_SHOT_BG};
  }
  * { box-sizing:border-box; }
  * { scrollbar-width: thin; scrollbar-color: #2A2A2A transparent; }
  ::-webkit-scrollbar { width:10px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#242424; border:2px solid var(--bg); }
  html { -webkit-text-size-adjust:100%; scroll-behavior:smooth; }
  body {
    margin:0; background:var(--bg); color:var(--fg); overflow-x:hidden;
    font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  a { color:var(--accent); }
  main, .wrap { max-width:1120px; margin:0 auto; padding:0 22px; }
  .ico { width:20px; height:20px; stroke:currentColor; fill:none; flex:none;
         stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .ico.solid { fill:currentColor; stroke:none; }

  /* ── Masthead ─────────────────────────────────────────────────────── */
  header {
    position:sticky; top:0; z-index:20;
    background:rgba(10,10,10,.82); backdrop-filter:blur(14px);
    border-bottom:1px solid var(--line);
  }
  header .in {
    display:flex; align-items:center; gap:10px;
    max-width:1120px; margin:0 auto; padding:14px 22px;
  }
  header img { width:26px; height:26px; border-radius:6px; display:block; }
  .word { font-weight:800; letter-spacing:1.6px; font-size:17px; }
  .word em { font-style:normal; color:var(--accent); }
  header nav { margin-left:auto; display:flex; gap:24px; align-items:center; font-size:14.5px; }
  header nav a { color:var(--muted); text-decoration:none; }
  header nav a:hover { color:var(--fg); }
  header nav a.cta {
    color:var(--fg); border:2px solid var(--line-strong); border-radius:2px;
    padding:7px 15px; font-weight:700; font-size:14px;
  }
  header nav a.cta:hover { border-color:var(--accent); }
  @media (max-width:820px) { header nav a:not(.cta) { display:none; } }

  /* ── Hero ─────────────────────────────────────────────────────────── */
  /*
   * The glow is the only decoration on this page that is not also
   * information, so it sits behind everything and takes no clicks.
   */
  .glow {
    position:absolute; top:-280px; left:50%; transform:translateX(-50%);
    width:900px; height:660px; pointer-events:none; z-index:0;
    background:radial-gradient(50% 50% at 50% 50%, rgba(255,107,0,.15), transparent 70%);
  }
  .hero { position:relative; padding:62px 0 20px; }
  .hero .cols {
    position:relative; z-index:1;
    display:grid; grid-template-columns:1.06fr .94fr; gap:40px; align-items:center;
  }
  .pill {
    display:inline-flex; align-items:center; gap:9px; border-radius:2px;
    border:2px solid var(--line-strong); background:var(--surface);
    padding:6px 13px; font-size:12.5px; color:var(--muted);
    font-family:var(--mono); margin-bottom:22px;
  }
  .pill i { width:7px; height:7px; background:var(--ok); border-radius:50%; font-style:normal; }
  h1 {
    font-size:clamp(38px, 6.4vw, 64px); line-height:1.02; margin:0 0 18px;
    font-weight:800; letter-spacing:-2.2px;
  }
  h1 span { color:var(--accent); display:block; }
  .lede { font-size:clamp(16.5px,2vw,19px); color:var(--muted); max-width:560px; margin:0 0 14px; }
  .asks { font-family:var(--mono); font-size:14px; color:var(--fg); margin:20px 0 28px; }
  .asks span { color:var(--faint); }

  .btns { display:flex; flex-wrap:wrap; gap:11px; }
  .btn {
    display:flex; align-items:center; gap:11px; text-decoration:none;
    border:2px solid var(--line-strong); border-radius:2px;
    padding:11px 17px; color:var(--fg); background:var(--surface);
  }
  .btn .txt { display:flex; flex-direction:column; gap:1px; }
  .btn b { font-size:15px; font-weight:700; }
  .btn em { font-style:normal; font-size:12.5px; color:var(--faint); }
  .btn:hover { border-color:var(--accent); }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#0A0A0A; }
  .btn.primary em { color:#0A0A0A; opacity:.72; }
  .btn.primary:hover { filter:brightness(1.08); }
  .btn.disabled { background:var(--sunken); border-color:var(--line); color:var(--faint); cursor:default; }

  /* ── The phone ────────────────────────────────────────────────────── */
  /*
   * Drawn, not photographed. A screenshot is out of date the first time a
   * screen changes and nobody remembers to retake it. This cannot rot in a
   * way that is invisible, because it is the page's own stylesheet.
   */
  .phone {
    position:relative; width:298px; max-width:100%; margin:0 0 0 auto;
    border:2px solid #2C2C2C; border-radius:40px; padding:9px;
    background:linear-gradient(170deg,#1A1A1A,#0B0B0B);
    box-shadow:0 40px 90px rgba(0,0,0,.72), 0 0 0 1px rgba(255,255,255,.03) inset;
  }
  .island {
    position:absolute; top:19px; left:50%; transform:translateX(-50%);
    width:88px; height:20px; background:#000; border-radius:12px; z-index:3;
  }
  .screen {
    background:var(--shot); border-radius:32px; overflow:hidden;
    display:flex; flex-direction:column;
  }
  /*
   * A strip of phone above the app, so the island has somewhere to sit that
   * is not on top of the header in the screenshot. Its height is not fixed to
   * the picture: the screen takes whatever height the image comes with, so a
   * retaken screenshot of a different size still fits its frame.
   */
  .sbar {
    display:flex; justify-content:space-between; align-items:center;
    padding:14px 20px 10px; font-size:11px; font-weight:700; color:var(--fg);
  }
  .sbar em { font-style:normal; letter-spacing:1px; color:var(--muted); }
  .screen img { display:block; width:100%; height:auto; }
  @media (max-width:900px) {
    .hero .cols { grid-template-columns:1fr; gap:44px; }
    .phone { margin:0 auto; }
  }

  /* ── Sections ─────────────────────────────────────────────────────── */
  section { padding:74px 0 0; margin-top:26px; }
  .kicker {
    font-family:var(--mono); font-size:11px; letter-spacing:1.8px; text-transform:uppercase;
    color:var(--accent); font-weight:700; margin:0 0 14px;
  }
  h2 { font-size:clamp(27px,3.7vw,40px); line-height:1.12; margin:0 0 16px;
       font-weight:800; letter-spacing:-1.2px; }
  h3 { font-size:26px; line-height:1.2; margin:0 0 14px; font-weight:800; letter-spacing:-.7px; }
  p.body { color:var(--muted); max-width:620px; margin:0 0 14px; }
  .mid { text-align:center; max-width:640px; margin:0 auto 34px; }
  .mid p { color:var(--muted); margin:0; }

  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(232px,1fr)); gap:14px; margin-top:26px; }
  .card {
    border:2px solid var(--line); border-radius:2px; padding:20px;
    background:linear-gradient(180deg,rgba(255,255,255,.028),transparent 60%), var(--surface);
  }
  .card:hover { border-color:var(--line-strong); }
  .card .top { display:flex; align-items:center; gap:9px; color:var(--accent); }
  .card .n { font-family:var(--mono); font-size:12px; color:var(--accent); }
  .card b { display:block; margin:12px 0 6px; font-size:16.5px; letter-spacing:-.3px; }
  .card p { margin:0; color:var(--muted); font-size:14.5px; line-height:1.55; }

  .split { display:grid; grid-template-columns:1fr 1fr; gap:34px; align-items:start; }
  @media (max-width:760px) { .split { grid-template-columns:1fr; gap:24px; } }

  .term {
    border:2px solid var(--line-strong); border-radius:2px; background:#080808;
    font-family:var(--mono); font-size:12.5px; line-height:1.75; padding:15px;
    overflow-x:auto;
    /* Without this the browser folds every newline into a space and the
       transcript reads as one run-on paragraph, which is the opposite of the
       thing it is there to show. */
    white-space:pre-wrap;
  }
  .howto { margin-top:34px; }
  .howto h4 { font-size:16.5px; font-weight:800; letter-spacing:-.3px; margin:0 0 12px; }
  .howto .note {
    color:var(--faint); font-size:13.5px; line-height:1.6; max-width:680px; margin:12px 0 0;
  }
  .term .p { color:var(--accent); }
  .term .g { color:var(--ok); }
  .term .d { color:var(--faint); }

  /* ── Questions ────────────────────────────────────────────────────── */
  .faq { max-width:780px; margin:0 auto; }
  details {
    border:2px solid var(--line); border-radius:2px; background:var(--surface); margin-bottom:10px;
  }
  details[open] { border-color:var(--line-strong); }
  summary {
    display:flex; align-items:center; gap:16px; cursor:pointer; list-style:none;
    padding:16px 18px; font-weight:700; font-size:15.5px;
  }
  summary::-webkit-details-marker { display:none; }
  summary span { flex:1; }
  summary .ico { color:var(--faint); transition:transform .18s ease; }
  details[open] summary .ico { transform:rotate(180deg); color:var(--accent); }
  .answer { padding:0 18px 17px; color:var(--muted); font-size:14.5px; line-height:1.6; max-width:640px; }

  /* ── Closing ──────────────────────────────────────────────────────── */
  .close {
    text-align:center; margin-top:96px; padding:74px 22px 78px;
    border-top:1px solid var(--line); border-bottom:1px solid var(--line);
    background:radial-gradient(60% 100% at 50% 0%, rgba(255,107,0,.10), transparent 70%);
  }
  .close h2 { max-width:640px; margin:0 auto 14px; }
  .close p { color:var(--muted); margin:0 auto 28px; max-width:520px; }
  .close .btns { justify-content:center; }

  /* ── Footer ───────────────────────────────────────────────────────── */
  footer { padding:52px 0 60px; color:var(--faint); font-size:14px; }
  footer .cols { display:grid; grid-template-columns:1.6fr 1fr 1fr 1.2fr; gap:30px; }
  @media (max-width:760px) { footer .cols { grid-template-columns:1fr 1fr; gap:28px; } }
  footer .brand { display:flex; align-items:center; gap:9px; margin-bottom:12px; }
  footer .brand img { width:24px; height:24px; border-radius:6px; }
  footer h4 {
    font-size:11px; letter-spacing:1.6px; text-transform:uppercase; color:var(--fg);
    margin:0 0 13px; font-weight:700;
  }
  footer ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; }
  footer a { color:var(--muted); text-decoration:none; }
  footer a:hover { color:var(--accent); }
  footer .mailto { display:inline-flex; align-items:center; gap:8px; }
  footer .ico { width:16px; height:16px; }
  .socs { display:flex; gap:9px; margin-top:16px; }
  .soc {
    width:34px; height:34px; border:2px solid var(--line); border-radius:2px;
    display:flex; align-items:center; justify-content:center; color:var(--muted);
  }
  .soc:hover { border-color:var(--accent); color:var(--accent); }
  .soc .ico { width:15px; height:15px; }
  .fine {
    border-top:1px solid var(--line); margin-top:40px; padding-top:22px;
    font-size:13px; line-height:1.6; max-width:720px;
  }
</style>
</head>
<body>

<header>
  <div class="in">
    <img src="${LOGO_DATA_URI}" alt="Confam">
    <span class="word">CONFAM<em>AI</em></span>
    <nav>
      <a href="#ai">Confam AI</a>
      <a href="#how">How it works</a>
      <a href="#proof">Proof</a>
      <a href="#faq">Questions</a>
      <a class="cta" href="#get">Get the app</a>
    </nav>
  </div>
</header>

<main>
  <div class="hero">
    <div class="glow"></div>
    <div class="cols">
      <div>
        <span class="pill"><i></i> live on Base mainnet</span>
        <h1>The physical world,<span>on demand.</span></h1>
        <p class="lede">
          Some things cannot be looked up. Confam pays somebody already standing there to go and
          look, and sends back the photo or the video.
        </p>
        <p class="asks">
          Is the road flooded? <span>&middot;</span> Is the queue long? <span>&middot;</span>
          Is the shop open? <span>&middot;</span> Did the delivery arrive?
        </p>

        <div class="btns" id="get">
          ${stores}
          <a class="btn" href="${esc(origin)}/confamagent">
            ${icon('terminal')}
            <span class="txt"><b>Try Confam Agent</b><em>in your browser, no install</em></span>
          </a>
        </div>
      </div>

      <div class="phone">
        <div class="island"></div>
        <div class="screen">
          <div class="sbar"><span>9:41</span><em>&#9679;&#9679;&#9679;&#9679;</em></div>
          <img src="${APP_SHOT_DATA_URI}"
               width="${APP_SHOT_SIZE.width}" height="${APP_SHOT_SIZE.height}"
               alt="The Confam home screen, asking what you need checked right now, above a list of questions confirmed nearby">
        </div>
      </div>
    </div>
  </div>

  <section id="ai">
    <p class="kicker">Confam AI</p>
    <div class="split">
      <div>
        <h3>An agent that knows when to send a human.</h3>
        <p class="body">
          Every question goes to it first. It reads what somebody already verified about that
          place and how long ago, and decides one thing: does anybody have to go.
        </p>
        <p class="body">
          It never answers from its own knowledge. Everything it gives you came from a person who
          stood there, so a wrong answer is somebody's mistake at a real place rather than a
          confident guess.
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

    <div class="howto">
      <h4>Point your own agent at it</h4>
      <div class="term">
<span class="d"># 1. get a key. in the app: You, then Confam AI, then Create a key</span>

<span class="d"># 2. ask. finding somebody and paying them is handled for you</span>
<span class="p">POST</span> ${esc(origin)}/agent/ask
     Authorization: Bearer sk_confam_...
     { "question": "Is the gate open?", "place": "Apapa", "bountyNgn": 150 }

     <span class="d">-&gt; { "status": "dispatched", "id": "8f2c...", "costNgn": 150 }</span>
     <span class="g">-&gt; { "status": "answered", "source": "cached" }</span> <span class="d">if somebody already went</span>

<span class="d"># 3. poll until somebody has been</span>
<span class="p">GET</span>  ${esc(origin)}/agent/ask/&lt;id&gt;

     <span class="g">-&gt; { "status": "answered", "answer": "Yes, the gate is open.",</span>
     <span class="g">     "evidence": ["/media/..."], "evidenceKind": "video",</span>
     <span class="g">     "metresFromPlace": 34, "verifier": "musa" }</span>

<span class="d"># 4. accept, and the person who walked there is paid</span>
<span class="p">POST</span> ${esc(origin)}/agent/ask/&lt;id&gt;/accept

     <span class="d">-&gt; { "ok": true, "paidNgn": 135, "chain": { "txHash": "0x..." } }</span>
      </div>
      <p class="note">
        The tool definitions are at <a href="${esc(origin)}/agent">/agent</a>, ready to paste into
        whatever your agent uses. An answer nobody polls within fifteen minutes is accepted for
        you, so somebody who walked there is never left waiting on a program that stopped calling.
      </p>
    </div>
  </section>

  <section id="how">
    <p class="kicker">How it works</p>
    <h2>Four steps, and only one of them is yours.</h2>
    <div class="grid">
      <div class="card">
        <div class="top">${icon('ask')}<span class="n">01</span></div>
        <b>You ask about a place</b>
        <p>A question and the spot it is about. Asking costs nothing.</p>
      </div>
      <div class="card">
        <div class="top">${icon('ai')}<span class="n">02</span></div>
        <b>Confam AI checks what is known</b>
        <p>If somebody verified that place recently and it still holds, you get it straight away
           with what they brought back, and you can tip them for it.</p>
      </div>
      <div class="card">
        <div class="top">${icon('place')}<span class="n">03</span></div>
        <b>Otherwise somebody goes</b>
        <p>You set what you will pay and how long they have. Whoever takes it first walks there
           in person.</p>
      </div>
      <div class="card">
        <div class="top">${icon('check')}<span class="n">04</span></div>
        <b>You decide</b>
        <p>Photo or video comes back with the time and how far from the place it was taken.
           Confirm it and they are paid.</p>
      </div>
    </div>
  </section>

  <section id="proof">
    <p class="kicker">Proof, not promises</p>
    <h2>You do not have to take our word for any of it.</h2>
    <div class="grid">
      <div class="card">
        <div class="top">${icon('lock')}</div>
        <b>The money is in a contract</b>
        <p>A bounty is locked in escrow on Base and released when you accept the answer. Nobody
           can move it in between, including us.</p>
      </div>
      <div class="card">
        <div class="top">${icon('hash')}</div>
        <b>The evidence is committed</b>
        <p>A hash of every photo and video is written to Base and signed by the verifier, so it
           can be proved the file was not swapped afterwards.</p>
      </div>
      <div class="card">
        <div class="top">${icon('shield')}</div>
        <b>Check it yourself</b>
        <p>Every answer has a proof page: the hashes, the escrow, and every transaction. Hash the
           file yourself and compare. Our servers are not in the path.</p>
      </div>
    </div>
  </section>

  <section id="faq">
    <div class="mid">
      <p class="kicker">Questions</p>
      <h2>Frequently asked</h2>
      <p>If yours is not here, the address at the bottom is read by a person.</p>
    </div>
    <div class="faq">
      ${faq(
        'What is Confam?',
        'You ask about a place. Somebody already near it goes, photographs or films it, and you ' +
          'pay them for the trip. It answers the questions a search engine cannot, because they ' +
          'are about right now rather than about last year.',
      )}
      ${faq(
        'How do I know the answer is real?',
        'Every photo and video arrives with the time it was taken and how far from the place it ' +
          'was taken, and a hash of the file is written to Base and signed by the person who ' +
          'took it. If the file changed afterwards the hash stops matching, and anybody can ' +
          'check that without asking us.',
      )}
      ${faq(
        'What does it cost?',
        'Asking costs nothing. You set the bounty when you ask and only pay when you accept the ' +
          'answer. The smallest is &#8358;150, and Confam keeps a tenth of what is paid out.',
      )}
      ${faq(
        'How do people get paid?',
        'The bounty is locked in an escrow contract on Base the moment the job is created, and ' +
          'released to the verifier when the answer is accepted. Wallets are non custodial, so ' +
          'the money is theirs rather than a balance we owe them.',
      )}
      ${faq(
        'What is Confam AI?',
        'The agent that reads your question first and decides whether anybody has to walk. If a ' +
          'recent verified answer already covers it you get that instead, in seconds, and you ' +
          'can tip the person who went. It never invents an answer.',
      )}
      ${faq(
        'Can my own program use it?',
        'Yes. Create a key in the app under Confam AI, then post a question to /agent/ask and ' +
          'poll for the answer. Your agent pays the human who walks there, in USDC. The tool ' +
          'definitions are at <a href="' + esc(origin) + '/agent">/agent</a>, ready to paste.',
      )}
      ${faq(
        'Do you keep my ID?',
        'Your ID is saved and used only to check you are a real person, which keeps spam out and ' +
          'unlocks the higher paying jobs. Only our team can see it. Other people in the app ' +
          'only ever see your username.',
      )}
      ${faq(
        'Where does it work?',
        'Anywhere somebody is close enough to walk. It is busiest in Nigerian cities at the ' +
          'moment, and a question nobody is near simply expires and costs you nothing.',
      )}
    </div>
  </section>
</main>

<div class="close">
  <h2>Stop guessing. Confam it.</h2>
  <p>Ask about anywhere, and let somebody who is already there settle it.</p>
  <div class="btns">${stores}</div>
</div>

<footer>
  <div class="wrap">
    <div class="cols">
      <div>
        <div class="brand">
          <img src="${LOGO_DATA_URI}" alt="Confam">
          <span class="word">CONFAM<em>AI</em></span>
        </div>
        <p style="margin:0;max-width:280px">The physical world, on demand.</p>
        <div class="socs">
          ${social(config.links.x, 'x', 'Confam on X')}
          ${social(config.links.github, 'github', 'Confam on GitHub')}
          ${social(config.links.telegram, 'telegram', 'Confam on Telegram')}
        </div>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li><a href="#ai">Confam AI</a></li>
          <li><a href="#how">How it works</a></li>
          <li><a href="${esc(origin)}/confamagent">Agent terminal</a></li>
          <li><a href="${esc(origin)}/agent">Tool definitions</a></li>
        </ul>
      </div>
      <div>
        <h4>Legal</h4>
        <ul>
          <li><a href="${esc(origin)}/terms">Terms of service</a></li>
          <li><a href="${esc(origin)}/privacy">Privacy policy</a></li>
          <li><a href="${esc(origin)}/licences">Open source licences</a></li>
        </ul>
      </div>
      <div>
        <h4>Talk to us</h4>
        <ul>
          <li><a class="mailto" href="mailto:${esc(support)}">${icon('mail')}${esc(support)}</a></li>
          <li><a href="#faq">Frequently asked</a></li>
        </ul>
      </div>
    </div>
    <p class="fine">
      Confam connects people who want something checked with people already nearby who will go and
      check it. Verifiers are independent and are not employed by us. An answer describes one
      moment at one place, so do not lean on one for a decision that matters without checking it
      again.
    </p>
  </div>
</footer>

</body>
</html>`;
}

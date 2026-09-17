/**
 * Does a Nimiq Pay WebView give us a camera and a location?
 *
 * The Mini Apps documentation covers providers, network access and external
 * APIs, and says nothing at all about device APIs. Whether a mini app can open
 * the camera decides something much larger than a feature: if it can, both
 * sides of Confam live inside Nimiq Pay and the mini app is the whole product.
 * If it cannot, only asking can move there and the walking stays in the app.
 *
 * That is too big a decision to take on an assumption, so this asks the
 * question directly. Served over HTTPS deliberately: getUserMedia is refused
 * outright in an insecure context, so testing over a LAN address would fail
 * for a reason that has nothing to do with permissions and teach us nothing.
 *
 * Everything is reported on the page. There is no console to read inside a
 * WebView on somebody else's phone.
 */

export function miniTestPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Mini App capability check</title>
<style>
  :root {
    --bg:#0A0A0A; --surface:#141414; --line:#262626;
    --fg:#FAFAFA; --muted:#9C9C9C; --accent:#FF6B00;
    --ok:#3DD68C; --no:#FF4D4D; --wait:#FFB020;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    padding:20px 16px 48px; max-width:640px; margin:0 auto;
  }
  h1 { font-size:19px; margin:0 0 4px; letter-spacing:-.3px; }
  .sub { color:var(--muted); font-size:13.5px; margin:0 0 20px; }

  .row {
    display:flex; align-items:flex-start; gap:12px;
    border:2px solid var(--line); border-radius:2px; background:var(--surface);
    padding:13px 14px; margin-bottom:10px;
  }
  .row b { display:block; font-size:14.5px; margin-bottom:3px; }
  .row .v {
    font-family:var(--mono); font-size:12px; color:var(--muted);
    word-break:break-all; white-space:pre-wrap;
  }
  .dot { width:11px; height:11px; border-radius:50%; margin-top:5px; flex:none; background:var(--wait); }
  .dot.ok { background:var(--ok); }
  .dot.no { background:var(--no); }

  button {
    display:block; width:100%; font:inherit; font-weight:700; font-size:15px;
    background:var(--accent); color:#0A0A0A; border:0; border-radius:2px;
    padding:15px; margin:18px 0 10px; cursor:pointer;
  }
  button.ghost { background:var(--surface); color:var(--fg); border:2px solid var(--line); }
  button:disabled { opacity:.5; }

  video, canvas {
    display:block; width:100%; border:2px solid var(--line); border-radius:2px;
    margin-top:10px; background:#000;
  }
  canvas { display:none; }
  #shot { display:none; }
  h2 {
    font-family:var(--mono); font-size:11px; letter-spacing:1.4px; text-transform:uppercase;
    color:var(--accent); margin:26px 0 10px; font-weight:600;
  }
</style>
</head>
<body>

<h1>Mini App capability check</h1>
<p class="sub">
  Open this inside Nimiq Pay. It reports what the WebView actually allows, which
  decides whether a verifier can capture evidence here or only in the app.
</p>

<h2>Environment</h2>
<div id="env"></div>

<h2>Camera</h2>
<button id="cam">Ask for the camera</button>
<div id="camOut"></div>
<video id="v" playsinline muted autoplay></video>
<button id="snap" class="ghost" disabled>Take a still</button>
<canvas id="c"></canvas>
<img id="shot" alt="captured frame">

<h2>Location</h2>
<button id="geo">Ask for location</button>
<div id="geoOut"></div>

<script>
  var envEl = document.getElementById('env');

  function row(where, label, state, value) {
    var d = document.createElement('div');
    d.className = 'row';
    d.innerHTML =
      '<span class="dot ' + state + '"></span>' +
      '<div><b>' + label + '</b><span class="v">' + value + '</span></div>';
    where.appendChild(d);
    return d;
  }

  /* ---- what we are running inside ------------------------------------ */
  var secure = window.isSecureContext;
  row(envEl, 'Secure context', secure ? 'ok' : 'no',
      secure ? 'yes, so the camera is allowed to be asked for'
             : 'NO - getUserMedia is refused here whatever the permissions say');

  row(envEl, 'Ethereum provider', window.ethereum ? 'ok' : 'no',
      window.ethereum ? 'window.ethereum is injected' : 'not present');

  var np = window.nimiqPay;
  row(envEl, 'Nimiq Pay host', np ? 'ok' : 'no',
      np ? 'window.nimiqPay present, language ' + (np.language || 'unknown')
         : 'not present - are you inside Nimiq Pay?');

  row(envEl, 'getUserMedia', navigator.mediaDevices ? 'ok' : 'no',
      navigator.mediaDevices ? 'the API exists' : 'navigator.mediaDevices is undefined');

  var rec = window.MediaRecorder;
  var types = [];
  if (rec) {
    ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .forEach(function (t) { if (rec.isTypeSupported(t)) types.push(t); });
  }
  row(envEl, 'Video recording', rec && types.length ? 'ok' : 'no',
      rec ? (types.length ? types.join(String.fromCharCode(10)) : 'MediaRecorder exists but supports none of the usual types')
          : 'MediaRecorder is not available');

  row(envEl, 'User agent', 'ok', navigator.userAgent);

  /* ---- camera -------------------------------------------------------- */
  var stream = null;
  document.getElementById('cam').onclick = function () {
    var out = document.getElementById('camOut');
    out.innerHTML = '';
    if (!navigator.mediaDevices) {
      row(out, 'Camera', 'no', 'navigator.mediaDevices is not available at all');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      .then(function (s) {
        stream = s;
        var v = document.getElementById('v');
        v.srcObject = s;
        var track = s.getVideoTracks()[0];
        var st = track.getSettings ? track.getSettings() : {};
        row(out, 'Camera', 'ok',
            'granted - ' + (track.label || 'unnamed') +
            String.fromCharCode(10) + (st.width || '?') + ' by ' + (st.height || '?') +
            ', facing ' + (st.facingMode || 'unknown'));
        document.getElementById('snap').disabled = false;
      })
      .catch(function (e) {
        row(out, 'Camera', 'no', e.name + ': ' + e.message);
      });
  };

  document.getElementById('snap').onclick = function () {
    var v = document.getElementById('v');
    var c = document.getElementById('c');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(function (blob) {
      var out = document.getElementById('camOut');
      if (!blob) { row(out, 'Still capture', 'no', 'toBlob returned nothing'); return; }
      var img = document.getElementById('shot');
      img.src = URL.createObjectURL(blob);
      img.style.display = 'block';
      row(out, 'Still capture', 'ok',
          'captured ' + c.width + ' by ' + c.height + ', ' +
          Math.round(blob.size / 1024) + ' kB as ' + blob.type);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    }, 'image/jpeg', 0.85);
  };

  /* ---- location ------------------------------------------------------ */
  document.getElementById('geo').onclick = function () {
    var out = document.getElementById('geoOut');
    out.innerHTML = '';
    if (!navigator.geolocation) {
      row(out, 'Location', 'no', 'navigator.geolocation is not available');
      return;
    }
    var started = Date.now();
    navigator.geolocation.getCurrentPosition(
      function (p) {
        row(out, 'Location', 'ok',
            p.coords.latitude.toFixed(6) + ', ' + p.coords.longitude.toFixed(6) +
            String.fromCharCode(10) + 'accurate to ' + Math.round(p.coords.accuracy) +
            'm, took ' + (Date.now() - started) + 'ms');
      },
      function (e) {
        row(out, 'Location', 'no', 'code ' + e.code + ': ' + e.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
</script>
</body>
</html>`;
}

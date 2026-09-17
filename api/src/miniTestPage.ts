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

  #play { display:none; }
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

<h2>Video</h2>
<button id="rec" class="ghost" disabled>Record 5 seconds</button>
<div id="recOut"></div>
<video id="play" playsinline controls></video>

<h2>Upload</h2>
<button id="up" class="ghost" disabled>Send the recording to the server</button>
<div id="upOut"></div>

<h2>Wallet</h2>
<button id="wallet">Connect and sign</button>
<div id="wOut"></div>

<h2>Chain</h2>
<button id="poly" class="ghost">Switch to Polygon</button>
<div id="polyOut"></div>

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
  if (rec && types.length) document.getElementById('rec').disabled = false;

  /* ---- camera -------------------------------------------------------- */
  var stream = null;
  document.getElementById('cam').onclick = function () {
    var out = document.getElementById('camOut');
    out.innerHTML = '';
    if (!navigator.mediaDevices) {
      row(out, 'Camera', 'no', 'navigator.mediaDevices is not available at all');
      return;
    }
    /*
     * Asking for nothing got 640 by 480. A WebView hands back the lowest
     * common denominator unless told otherwise, and VGA is too little for
     * evidence: the blur and exposure scores have less to read, and a proof
     * page is meant to convince somebody who was not there.
     */
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    })
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

  /* ---- video ----------------------------------------------------------
   *
   * Reporting a supported mime type and producing a file somebody can watch
   * are different claims, and the second is the one that matters. The size is
   * what decides whether video is usable at all: a verifier on Nigerian mobile
   * data uploading four megabytes for a ten second clip is a verifier who
   * gives up, so the bitrate is capped here to find out what that buys.
   */
  function bestType() {
    var want = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < want.length; i += 1) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(want[i])) return want[i];
    }
    return '';
  }

  document.getElementById('rec').onclick = function () {
    var out = document.getElementById('recOut');
    out.innerHTML = '';
    var btn = this;

    if (!window.MediaRecorder) { row(out, 'Recording', 'no', 'MediaRecorder is not available'); return; }
    var type = bestType();
    if (!type) { row(out, 'Recording', 'no', 'no supported container'); return; }

    /* Audio too, because the app records it and a microphone is its own grant. */
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: true,
    }).then(function (s) {
      var chunks = [];
      var started = Date.now();
      var mr;
      try {
        mr = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 600000 });
      } catch (e) {
        row(out, 'Recording', 'no', 'constructor refused: ' + e.name + ': ' + e.message);
        s.getTracks().forEach(function (t) { t.stop(); });
        return;
      }

      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onerror = function (e) { row(out, 'Recording', 'no', 'error: ' + (e.error || e)); };
      mr.onstop = function () {
        var seconds = (Date.now() - started) / 1000;
        s.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(chunks, { type: type });
        var kb = Math.round(blob.size / 1024);
        row(out, 'Recording', blob.size ? 'ok' : 'no',
            blob.size
              ? kb + ' kB for ' + seconds.toFixed(1) + 's as ' + blob.type +
                String.fromCharCode(10) + Math.round(kb / seconds) + ' kB per second' +
                String.fromCharCode(10) + 'a 10s clip would be about ' +
                Math.round((kb / seconds) * 10) + ' kB'
              : 'produced an empty file');
        if (blob.size) {
          window.__recording = blob;
          document.getElementById('up').disabled = false;
          var pl = document.getElementById('play');
          pl.src = URL.createObjectURL(blob);
          pl.style.display = 'block';
          row(out, 'Playback', 'ok', 'press play above to confirm it is watchable');
        }
        btn.disabled = false;
        btn.textContent = 'Record 5 seconds';
      };

      mr.start();
      btn.textContent = 'Recording...';
      btn.disabled = true;
      setTimeout(function () { if (mr.state !== 'inactive') mr.stop(); }, 5000);
    }).catch(function (e) {
      row(out, 'Recording', 'no', 'camera or microphone refused: ' + e.name + ': ' + e.message);
    });
  };

  /* ---- upload ----------------------------------------------------------
   *
   * The one that decides whether any of this is usable. A recording that
   * cannot leave the WebView is not evidence, and the time it takes on the
   * connection a verifier is actually standing on matters as much as whether
   * it succeeds at all.
   */
  document.getElementById('up').onclick = function () {
    var out = document.getElementById('upOut');
    out.innerHTML = '';
    var blob = window.__recording;
    if (!blob) { row(out, 'Upload', 'no', 'record something first'); return; }

    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Uploading...';
    var started = Date.now();

    fetch('/minitest/upload', {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob,
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (res) {
        var secs = (Date.now() - started) / 1000;
        var kb = Math.round(blob.size / 1024);
        if (!res.ok) {
          row(out, 'Upload', 'no', 'server said ' + res.status + ': ' + JSON.stringify(res.j));
        } else {
          var same = res.j.kb === kb;
          row(out, 'Upload', same ? 'ok' : 'no',
              res.j.kb + ' kB arrived in ' + secs.toFixed(1) + 's' +
              String.fromCharCode(10) + Math.round(kb / secs) + ' kB per second' +
              String.fromCharCode(10) + (same ? 'size matches what was sent' : 'SIZE MISMATCH, sent ' + kb) +
              String.fromCharCode(10) + 'hash ' + String(res.j.keccak256).slice(0, 22) + '...');
        }
      })
      .catch(function (e) { row(out, 'Upload', 'no', e.name + ': ' + e.message); })
      .finally(function () { btn.disabled = false; btn.textContent = 'Send the recording to the server'; });
  };

  /* ---- wallet ----------------------------------------------------------
   *
   * The whole sign-in, end to end: an address from the host, a nonce from the
   * server, a signature, and the server recovering that same address from it.
   * If this works there is no sign-in screen to build.
   */
  document.getElementById('wallet').onclick = function () {
    var out = document.getElementById('wOut');
    out.innerHTML = '';
    var eth = window.ethereum;
    if (!eth) { row(out, 'Wallet', 'no', 'window.ethereum is not injected'); return; }

    var address;
    eth.request({ method: 'eth_requestAccounts' })
      .then(function (accounts) {
        address = accounts && accounts[0];
        if (!address) throw new Error('no account returned');
        row(out, 'Address', 'ok', address);
        return eth.request({ method: 'eth_chainId' });
      })
      .then(function (chainId) {
        row(out, 'Chain', 'ok', chainId + (chainId === '0x89' ? ' (Polygon)' : ' (not Polygon)'));
        return fetch('/minitest/challenge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address: address }),
        }).then(function (r) { return r.json(); });
      })
      .then(function (j) {
        row(out, 'Challenge', 'ok', j.message);
        return eth.request({ method: 'personal_sign', params: [j.message, address] });
      })
      .then(function (signature) {
        row(out, 'Signature', 'ok', String(signature).slice(0, 26) + '...');
        return fetch('/minitest/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address: address, signature: signature }),
        }).then(function (r) { return r.json(); });
      })
      .then(function (j) {
        row(out, 'Server verified', j.ok ? 'ok' : 'no',
            j.ok ? 'the signature recovers to that address, so sign-in works'
                 : 'did not verify: ' + JSON.stringify(j));
      })
      .catch(function (e) { row(out, 'Wallet', 'no', (e.code ? 'code ' + e.code + ' ' : '') + (e.message || e)); });
  };

  /* ---- switching chain -------------------------------------------------
   *
   * Nimiq Pay opens on Ethereum. Every escrow call has to happen on Polygon,
   * so the mini app must move the wallet first and know what that looks like
   * to the person holding the phone: whether it prompts, whether it can be
   * refused, and whether the chain stays switched afterwards.
   */
  document.getElementById('poly').onclick = function () {
    var out = document.getElementById('polyOut');
    out.innerHTML = '';
    var eth = window.ethereum;
    if (!eth) { row(out, 'Switch', 'no', 'window.ethereum is not injected'); return; }

    eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] })
      .then(function () { return eth.request({ method: 'eth_chainId' }); })
      .then(function (id) {
        row(out, 'Switch', id === '0x89' ? 'ok' : 'no',
            id === '0x89' ? 'now on Polygon (0x89)' : 'asked for 0x89 but still on ' + id);
        /* And can we read a balance there — is there USDT to spend? */
        return eth.request({ method: 'eth_accounts' }).then(function (accts) {
          if (!accts || !accts[0]) return;
          var data = '0x70a08231000000000000000000000000' + accts[0].slice(2);
          return eth.request({
            method: 'eth_call',
            params: [{ to: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', data: data }, 'latest'],
          }).then(function (hex) {
            var raw = BigInt(hex || '0x0');
            row(out, 'USDT balance', raw > 0n ? 'ok' : 'no',
                (Number(raw) / 1e6).toFixed(6) + ' USDT on Polygon' +
                (raw > 0n ? '' : ' - nothing to spend, top up before testing a payment'));
          });
        });
      })
      .catch(function (e) {
        row(out, 'Switch', 'no', (e.code ? 'code ' + e.code + ' ' : '') + (e.message || e));
      });
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

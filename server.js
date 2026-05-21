#!/usr/bin/env node
'use strict';

/**
 * 3D Text Animation Timeline Editor & Display
 * ─────────────────────────────────────────────
 * Editor:   http://localhost:5003/
 * Display:  http://localhost:5003/display   ← use as OBS Browser Source
 *
 * Setup:
 *   npm install express ws opentype.js
 *   node server.js
 *
 * Malayalam / custom fonts:
 *   Drop .ttf or .otf files into the  fonts/  folder.
 *   The server converts them to Three.js typeface JSON on startup
 *   (and when you click ↻ Scan Fonts in the editor).
 *   Requires opentype.js:  npm install opentype.js
 */

const express = require('express');
const http    = require('http');
const wsLib   = require('ws');
const path    = require('path');
const fs      = require('fs');

// ── Paths ────────────────────────────────────────────────────────────────────
const PORT  = 5003;
const BASE  = __dirname;
const SAVES = path.join(BASE, 'saves');
const FONTS = path.join(BASE, 'fonts');
for (const d of [SAVES, FONTS]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

// ── HTTP + WebSocket ─────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const WSS    = new wsLib.WebSocketServer({ server });

app.use(express.json({ limit: '50mb' }));
app.use('/fonts', express.static(FONTS));

// ── App State ────────────────────────────────────────────────────────────────
let appState = {
  tracks: [
    { id: 1, enabled: true,  text: 'BREAKING NEWS', font: 'helvetiker', color: '#ff4444',
      animation: 'crashLandTop',   size: 1.0, depth: 0.30, yPos:  1.8, delay:    0, duration: 0, bevel: true },
    { id: 2, enabled: false, text: 'Price Drop',    font: 'helvetiker', color: '#ffcc00',
      animation: 'zipInRight',     size: 0.8, depth: 0.25, yPos:  0.0, delay:  800, duration: 0, bevel: true },
    { id: 3, enabled: false, text: 'At WalMarts',   font: 'helvetiker', color: '#44ff44',
      animation: 'zipInSpin',      size: 0.7, depth: 0.20, yPos: -1.8, delay: 1600, duration: 0, bevel: true },
  ],
};

// ── WebSocket broadcast ───────────────────────────────────────────────────────
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  WSS.clients.forEach(c => c.readyState === wsLib.OPEN && c.send(msg));
}

WSS.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'init', state: appState }));
});

// ── Font helpers ──────────────────────────────────────────────────────────────
function getFontList() {
  const list = [{ id: 'helvetiker', label: 'Helvetiker Regular (Built-in)', url: null }];
  try {
    for (const f of fs.readdirSync(FONTS)) {
      if (!f.endsWith('_typeface.json')) continue;
      const id = f.slice(0, -14);  // strip _typeface.json
      list.push({ id, label: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), url: '/fonts/' + f });
    }
  } catch (_) {}
  return list;
}

async function convertFonts() {
  let op;
  try { op = require('opentype.js'); }
  catch (_) {
    console.log('[fonts] opentype.js not found — run: npm install opentype.js');
    return;
  }
  for (const f of fs.readdirSync(FONTS)) {
    if (!/\.(ttf|otf)$/i.test(f)) continue;
    const base = f.slice(0, f.lastIndexOf('.'));
    const out  = path.join(FONTS, base + '_typeface.json');
    if (fs.existsSync(out)) continue;
    console.log('[fonts] Converting: ' + f);
    try {
      const font = op.loadSync(path.join(FONTS, f));
      fs.writeFileSync(out, JSON.stringify(fontToTypeface(font)));
      console.log('[fonts] ✓ ' + base + '_typeface.json');
    } catch (e) { console.error('[fonts] ✗ ' + e.message); }
  }
}

function fontToTypeface(font) {
  const RES = 1000, SC = RES / font.unitsPerEm;
  const R = n => Math.round(n);
  const glyphs = {};
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    if (!g.unicode) continue;
    const ch  = String.fromCodePoint(g.unicode);
    const pth = g.getPath(0, 0, RES);
    let o = '';
    for (const c of pth.commands) {
      if      (c.type === 'M') o += 'm '  + R(c.x)  + ' ' + R(c.y)  + ' ';
      else if (c.type === 'L') o += 'l '  + R(c.x)  + ' ' + R(c.y)  + ' ';
      else if (c.type === 'Q') o += 'q '  + R(c.x1) + ' ' + R(c.y1) + ' ' + R(c.x)  + ' ' + R(c.y)  + ' ';
      else if (c.type === 'C') o += 'b '  + R(c.x1) + ' ' + R(c.y1) + ' ' + R(c.x2) + ' ' + R(c.y2) + ' ' + R(c.x) + ' ' + R(c.y) + ' ';
      else if (c.type === 'Z') o += 'z ';
    }
    glyphs[ch] = {
      ha: R(g.advanceWidth * SC),
      x_min: R((g.xMin || 0) * SC),
      x_max: R((g.xMax || 0) * SC),
      o: o.trim(),
    };
  }
  const head = font.tables.head || {};
  const post = font.tables.post || {};
  return {
    glyphs,
    familyName: (font.names.fontFamily && font.names.fontFamily.en) || 'Custom',
    ascender:           R(font.ascender  * SC),
    descender:          R(font.descender * SC),
    underlinePosition:  R((post.underlinePosition  || -100) * SC),
    underlineThickness: R((post.underlineThickness ||   50) * SC),
    boundingBox: {
      yMin: R((head.yMin || 0)    * SC),
      xMin: R((head.xMin || 0)    * SC),
      yMax: R((head.yMax || 1000) * SC),
      xMax: R((head.xMax || 1000) * SC),
    },
    resolution: RES,
    original_font_information: font.names,
  };
}

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/state', (_, res) => res.json(appState));

app.post('/api/state', (req, res) => {
  appState = req.body;
  // Auto-play: broadcast state + trigger so display re-animates on every change
  broadcast({ type: 'state', state: appState, autoPlay: true });
  res.json({ ok: true });
});

app.post('/api/trigger', (_, res) => {
  broadcast({ type: 'trigger' });
  res.json({ ok: true });
});

app.post('/api/reset', (_, res) => {
  broadcast({ type: 'reset' });
  res.json({ ok: true });
});

app.get('/api/fonts', (_, res) => res.json(getFontList()));

app.get('/api/scan-fonts', async (_, res) => {
  await convertFonts();
  res.json(getFontList());
});

app.get('/api/saves', (_, res) =>
  res.json(fs.readdirSync(SAVES).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))));

app.get('/api/saves/:n', (req, res) => {
  const p = path.join(SAVES, req.params.n + '.json');
  fs.existsSync(p)
    ? res.json(JSON.parse(fs.readFileSync(p, 'utf8')))
    : res.status(404).json({ error: 'Not found' });
});

app.post('/api/saves/:n', (req, res) => {
  fs.writeFileSync(path.join(SAVES, req.params.n + '.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.delete('/api/saves/:n', (req, res) => {
  const p = path.join(SAVES, req.params.n + '.json');
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/',        (_, res) => res.send(editorPage()));
app.get('/display', (_, res) => res.send(displayPage()));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log('\n3D Title Editor');
  console.log('  Editor:  http://localhost:' + PORT + '/');
  console.log('  Display: http://localhost:' + PORT + '/display');
  console.log('  Fonts:   ' + FONTS);
  console.log('  Saves:   ' + SAVES + '\n');
  await convertFonts();
});


// ══════════════════════════════════════════════════════════════════════════════
// EDITOR PAGE
// ══════════════════════════════════════════════════════════════════════════════
function editorPage() {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>3D Title Editor</title><style>' + EDITOR_CSS + '</style></head>' +
    '<body>' + EDITOR_HTML + '<script>' + EDITOR_JS + '<\/script></body></html>';
}

const EDITOR_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--surface:#161b22;--surface2:#21262d;--border:#30363d;
  --text:#c9d1d9;--muted:#8b949e;--accent:#58a6ff;--accent2:#3fb950;
  --danger:#f85149;--warn:#e3b341;--radius:8px;
}
body{background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif;
  display:flex;flex-direction:column;height:100vh;overflow:hidden}
/* Header */
header{display:flex;align-items:center;gap:12px;padding:8px 16px;
  background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;z-index:10}
.brand{font-weight:700;font-size:16px;color:var(--accent);white-space:nowrap}
.filename{color:var(--muted);font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filename.dirty::after{content:' ●';color:var(--warn)}
.hbtn{background:var(--surface2);border:1px solid var(--border);color:var(--text);
  padding:4px 12px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}
.hbtn:hover{background:var(--border)}
.hbtn.primary{background:var(--accent);border-color:var(--accent);color:#0d1117;font-weight:600}
.hbtn.primary:hover{opacity:.9}
.hbtn.danger{background:var(--danger);border-color:var(--danger);color:#fff;font-weight:600}
/* Layout */
.main{display:flex;flex:1;overflow:hidden}
/* Tracks panel */
.tracks-panel{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
/* Preview panel */
.preview-panel{width:360px;flex-shrink:0;background:var(--surface);border-left:1px solid var(--border);
  display:flex;flex-direction:column}
.preview-title{padding:10px 14px;font-size:12px;font-weight:600;color:var(--muted);
  text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border)}
#previewCanvas{flex:1;background:#111;display:block;width:100%}
.preview-controls{padding:10px;border-top:1px solid var(--border);display:flex;gap:8px}
.preview-controls button{flex:1}
/* Track cards */
.track{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;
  transition:border-color .15s}
.track.enabled{border-color:var(--accent)}
.track-header{display:flex;align-items:center;gap:10px;padding:8px 12px;
  background:var(--surface2);border-bottom:1px solid var(--border);cursor:pointer;user-select:none}
.track-num{font-weight:700;font-size:13px;color:var(--muted)}
.track-label{flex:1;font-weight:600;font-size:13px}
.track-anim-badge{font-size:11px;padding:2px 8px;border-radius:20px;
  background:var(--surface);border:1px solid var(--border);color:var(--muted)}
.track-toggle{width:36px;height:20px;border-radius:10px;border:none;cursor:pointer;
  transition:background .2s;flex-shrink:0;position:relative;appearance:none;
  background:var(--border)}
.track-toggle.on{background:var(--accent)}
.track-toggle::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;
  border-radius:50%;background:#fff;transition:transform .2s}
.track-toggle.on::after{transform:translateX(16px)}
.track-body{padding:12px;display:grid;gap:10px}
/* Form rows */
.row{display:flex;align-items:center;gap:8px}
.row label{font-size:12px;color:var(--muted);white-space:nowrap;min-width:52px}
.row input[type=text]{flex:1;background:var(--surface2);border:1px solid var(--border);
  color:var(--text);padding:5px 8px;border-radius:6px;font-size:14px}
.row input[type=text]:focus{outline:none;border-color:var(--accent)}
.row select{flex:1;background:var(--surface2);border:1px solid var(--border);
  color:var(--text);padding:5px 8px;border-radius:6px;font-size:13px}
.row select:focus{outline:none;border-color:var(--accent)}
.row input[type=color]{width:36px;height:28px;border:1px solid var(--border);
  border-radius:6px;cursor:pointer;background:none;padding:2px}
.row input[type=range]{flex:1;accent-color:var(--accent)}
.row input[type=number]{width:70px;background:var(--surface2);border:1px solid var(--border);
  color:var(--text);padding:5px 8px;border-radius:6px;font-size:13px;text-align:center}
.val{font-size:12px;color:var(--accent);min-width:36px;text-align:right}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
/* Footer controls */
footer{background:var(--surface);border-top:1px solid var(--border);padding:10px 16px;
  display:flex;align-items:center;gap:10px;flex-shrink:0}
footer .spacer{flex:1}
/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;
  display:flex;align-items:center;justify-content:center}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:20px;min-width:340px;max-width:480px;width:90%}
.modal h3{margin-bottom:14px;font-size:15px}
.modal input[type=text]{width:100%;background:var(--surface2);border:1px solid var(--border);
  color:var(--text);padding:7px 10px;border-radius:6px;font-size:14px;margin-bottom:12px}
.modal input[type=text]:focus{outline:none;border-color:var(--accent)}
.modal-list{list-style:none;max-height:200px;overflow-y:auto;margin-bottom:12px;
  border:1px solid var(--border);border-radius:6px}
.modal-list li{padding:8px 12px;cursor:pointer;display:flex;align-items:center;
  justify-content:space-between}
.modal-list li:hover{background:var(--surface2)}
.modal-list li span{color:var(--muted);font-size:12px}
.modal-btns{display:flex;gap:8px;justify-content:flex-end}
.hidden{display:none!important}
/* Scrollbar */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
`;

const EDITOR_HTML = `
<header>
  <div class="brand">🎬 3D Title Editor</div>
  <div class="filename" id="filenameDisplay">untitled</div>
  <button class="hbtn" onclick="fileOpen()">Open</button>
  <button class="hbtn" onclick="fileSave()">Save</button>
  <button class="hbtn" onclick="fileSaveAs()">Save As…</button>
  <button class="hbtn" onclick="scanFonts()" title="Scan fonts folder for new TTF/OTF files">↻ Fonts</button>
  <a class="hbtn" href="/display" target="_blank" title="Open display in new tab">⎋ Display</a>
</header>

<div class="main">
  <div class="tracks-panel" id="tracksPanel"><!-- tracks injected by JS --></div>

  <div class="preview-panel">
    <div class="preview-title">Live Preview</div>
    <canvas id="previewCanvas"></canvas>
    <div class="preview-controls">
      <button class="hbtn primary" onclick="apiTrigger()">▶ Trigger</button>
      <button class="hbtn danger"  onclick="apiReset()">■ Reset</button>
    </div>
  </div>
</div>

<footer>
  <span style="color:var(--muted);font-size:12px">Changes auto-apply to display</span>
  <div class="spacer"></div>
  <button class="hbtn primary" onclick="apiTrigger()">▶ Trigger All</button>
  <button class="hbtn danger"  onclick="apiReset()">■ Reset</button>
</footer>

<!-- Open file modal -->
<div class="modal-overlay hidden" id="openModal">
  <div class="modal">
    <h3>Open Scene</h3>
    <ul class="modal-list" id="savesList"></ul>
    <div class="modal-btns">
      <button class="hbtn" onclick="closeModal('openModal')">Cancel</button>
    </div>
  </div>
</div>

<!-- Save As modal -->
<div class="modal-overlay hidden" id="saveAsModal">
  <div class="modal">
    <h3>Save As</h3>
    <input type="text" id="saveAsName" placeholder="Scene name…" />
    <div class="modal-btns">
      <button class="hbtn" onclick="closeModal('saveAsModal')">Cancel</button>
      <button class="hbtn primary" onclick="doSaveAs()">Save</button>
    </div>
  </div>
</div>
`;

const EDITOR_JS = `
var state = null;
var currentFile = null;
var dirty = false;
var fonts = [];
var pushTimer = null;
var previewScene, previewCamera, previewRenderer, previewMeshes = [], previewClock;
var previewFontCache = {};
var previewAnimStates = [{},{},{}];

var ANIM_PRESETS = [
  {id:'crashLandTop',   label:'Crash Land (Top)'},
  {id:'zipInRight',     label:'Zip In (Right)'},
  {id:'zipInSpin',      label:'Zip In + Spin'},
  {id:'spinContinuous', label:'Spin Continuously'},
  {id:'spinAndStop',    label:'Spin & Stop'},
  {id:'bounce',         label:'Bounce'},
  {id:'fadeIn',         label:'Fade In'},
  {id:'static',         label:'Static'},
];

// ── Initialise ───────────────────────────────────────────────────────────────
async function init() {
  fonts = await fetch('/api/fonts').then(r => r.json());
  var res = await fetch('/api/state');
  state = await res.json();
  renderTracks();
  initPreview();
}

// ── Track UI ──────────────────────────────────────────────────────────────────
function renderTracks() {
  var panel = document.getElementById('tracksPanel');
  panel.innerHTML = '';
  state.tracks.forEach(function(t) { panel.appendChild(buildTrackCard(t)); });
}

function buildTrackCard(t) {
  var wrap = document.createElement('div');
  wrap.className = 'track' + (t.enabled ? ' enabled' : '');
  wrap.id = 'track-' + t.id;

  // Font options
  var fontOpts = fonts.map(function(f) {
    return '<option value="' + esc(f.id) + '"' + (t.font === f.id ? ' selected' : '') + '>' + esc(f.label) + '</option>';
  }).join('');

  // Anim options
  var animOpts = ANIM_PRESETS.map(function(a) {
    return '<option value="' + a.id + '"' + (t.animation === a.id ? ' selected' : '') + '>' + a.label + '</option>';
  }).join('');

  var animLabel = (ANIM_PRESETS.find(function(a){return a.id===t.animation;})||{label:t.animation}).label;

  wrap.innerHTML =
    '<div class="track-header" onclick="toggleTrackOpen(' + t.id + ')">' +
      '<span class="track-num">T' + t.id + '</span>' +
      '<span class="track-label" id="tLabel-' + t.id + '">' + esc(t.text || '(empty)') + '</span>' +
      '<span class="track-anim-badge" id="tBadge-' + t.id + '">' + animLabel + '</span>' +
      '<button class="track-toggle' + (t.enabled ? ' on' : '') + '" id="tToggle-' + t.id + '"' +
        ' onclick="event.stopPropagation();toggleTrack(' + t.id + ')" title="Enable/disable track"></button>' +
    '</div>' +
    '<div class="track-body" id="tbody-' + t.id + '">' +
      '<div class="row">' +
        '<label>Text</label>' +
        '<input type="text" id="text-' + t.id + '" value="' + esc(t.text) + '"' +
          ' oninput="trackChange(' + t.id + ',\'text\',this.value)">' +
      '</div>' +
      '<div class="row">' +
        '<label>Font</label>' +
        '<select id="font-' + t.id + '" onchange="trackChange(' + t.id + ',\'font\',this.value)">' + fontOpts + '</select>' +
        '<label style="min-width:auto">Color</label>' +
        '<input type="color" id="color-' + t.id + '" value="' + t.color + '"' +
          ' oninput="trackChange(' + t.id + ',\'color\',this.value)">' +
      '</div>' +
      '<div class="row">' +
        '<label>Anim</label>' +
        '<select id="anim-' + t.id + '" onchange="trackChange(' + t.id + ',\'animation\',this.value)">' + animOpts + '</select>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="row"><label>Size</label>' +
          '<input type="range" id="size-' + t.id + '" min="0.2" max="3" step="0.05" value="' + t.size + '"' +
            ' oninput="trackChange(' + t.id + ',\'size\',+this.value);document.getElementById(\'sizeV-' + t.id + '\').textContent=this.value">' +
          '<span class="val" id="sizeV-' + t.id + '">' + t.size + '</span>' +
        '</div>' +
        '<div class="row"><label>Depth</label>' +
          '<input type="range" id="depth-' + t.id + '" min="0.02" max="1" step="0.02" value="' + t.depth + '"' +
            ' oninput="trackChange(' + t.id + ',\'depth\',+this.value);document.getElementById(\'depthV-' + t.id + '\').textContent=this.value">' +
          '<span class="val" id="depthV-' + t.id + '">' + t.depth + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="row"><label>Y Pos</label>' +
          '<input type="range" id="ypos-' + t.id + '" min="-5" max="5" step="0.1" value="' + t.yPos + '"' +
            ' oninput="trackChange(' + t.id + ',\'yPos\',+this.value);document.getElementById(\'yposV-' + t.id + '\').textContent=this.value">' +
          '<span class="val" id="yposV-' + t.id + '">' + t.yPos + '</span>' +
        '</div>' +
        '<div class="row"><label>Bevel</label>' +
          '<input type="checkbox" id="bevel-' + t.id + '"' + (t.bevel ? ' checked' : '') +
            ' onchange="trackChange(' + t.id + ',\'bevel\',this.checked)">' +
        '</div>' +
      '</div>' +
      '<div class="row">' +
        '<label>Delay</label>' +
        '<input type="number" id="delay-' + t.id + '" value="' + t.delay + '" min="0" step="100"' +
          ' oninput="trackChange(' + t.id + ',\'delay\',+this.value)"> ms' +
        '<label style="min-width:auto;margin-left:12px">Hold</label>' +
        '<input type="number" id="dur-' + t.id + '" value="' + t.duration + '" min="0" step="500"' +
          ' oninput="trackChange(' + t.id + ',\'duration\',+this.value)"> ms<span style="color:var(--muted);font-size:11px;margin-left:4px">(0=∞)</span>' +
      '</div>' +
    '</div>';

  return wrap;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleTrack(id) {
  var t = state.tracks.find(function(x){return x.id===id;});
  t.enabled = !t.enabled;
  document.getElementById('track-'+id).className = 'track' + (t.enabled ? ' enabled' : '');
  var btn = document.getElementById('tToggle-'+id);
  btn.className = 'track-toggle' + (t.enabled ? ' on' : '');
  schedulePush();
}

function toggleTrackOpen(id) {
  var body = document.getElementById('tbody-'+id);
  body.style.display = body.style.display === 'none' ? '' : 'none';
}

function trackChange(id, key, value) {
  var t = state.tracks.find(function(x){return x.id===id;});
  t[key] = value;
  // Update label & badge in header
  if (key === 'text')      document.getElementById('tLabel-'+id).textContent = value || '(empty)';
  if (key === 'animation') {
    var label = (ANIM_PRESETS.find(function(a){return a.id===value;})||{label:value}).label;
    document.getElementById('tBadge-'+id).textContent = label;
  }
  markDirty();
  schedulePush();
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushState, 400); // debounce 400ms
}

async function pushState() {
  await fetch('/api/state', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(state) });
  updatePreview();
}

// ── File ops ──────────────────────────────────────────────────────────────────
function markDirty() {
  dirty = true;
  document.getElementById('filenameDisplay').classList.add('dirty');
}

function clearDirty() {
  dirty = false;
  document.getElementById('filenameDisplay').classList.remove('dirty');
}

function setFilename(name) {
  currentFile = name;
  document.getElementById('filenameDisplay').textContent = name || 'untitled';
  clearDirty();
}

async function fileOpen() {
  var saves = await fetch('/api/saves').then(r=>r.json());
  var list = document.getElementById('savesList');
  list.innerHTML = '';
  if (!saves.length) {
    list.innerHTML = '<li style="color:var(--muted);cursor:default">No saved scenes</li>';
  } else {
    saves.forEach(function(name) {
      var li = document.createElement('li');
      li.innerHTML = esc(name) + '<span>click to open</span>';
      li.onclick = function() { loadScene(name); closeModal('openModal'); };
      list.appendChild(li);
    });
  }
  document.getElementById('openModal').classList.remove('hidden');
}

async function loadScene(name) {
  var data = await fetch('/api/saves/'+encodeURIComponent(name)).then(r=>r.json());
  state = data;
  setFilename(name);
  renderTracks();
  pushState();
}

async function fileSave() {
  if (!currentFile) { fileSaveAs(); return; }
  await fetch('/api/saves/'+encodeURIComponent(currentFile), {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(state)
  });
  clearDirty();
}

function fileSaveAs() {
  document.getElementById('saveAsName').value = currentFile || '';
  document.getElementById('saveAsModal').classList.remove('hidden');
  setTimeout(function(){document.getElementById('saveAsName').focus();},50);
}

async function doSaveAs() {
  var name = document.getElementById('saveAsName').value.trim();
  if (!name) return;
  await fetch('/api/saves/'+encodeURIComponent(name), {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(state)
  });
  setFilename(name);
  closeModal('saveAsModal');
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.addEventListener('keydown', function(e) {
  if (e.key==='Escape') { closeModal('openModal'); closeModal('saveAsModal'); }
  if ((e.metaKey||e.ctrlKey) && e.key==='s') { e.preventDefault(); fileSave(); }
});

document.getElementById('saveAsName').addEventListener('keydown', function(e) {
  if (e.key==='Enter') doSaveAs();
});

// ── Font scanning ─────────────────────────────────────────────────────────────
async function scanFonts() {
  var btn = event.target;
  btn.textContent = '…scanning';
  btn.disabled = true;
  fonts = await fetch('/api/scan-fonts').then(r=>r.json());
  btn.textContent = '↻ Fonts';
  btn.disabled = false;
  renderTracks(); // refresh font selects
}

// ── API controls ──────────────────────────────────────────────────────────────
function apiTrigger() { fetch('/api/trigger', {method:'POST'}); }
function apiReset()   { fetch('/api/reset',   {method:'POST'}); }

// ══════════════════════════════════════════════════════════════════════════════
// MINI PREVIEW (Three.js)
// ══════════════════════════════════════════════════════════════════════════════
var THREE_CDN_LOADED = false;

function loadThreeScripts(cb) {
  if (THREE_CDN_LOADED) { cb(); return; }
  function loadScript(src, next) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = next;
    document.head.appendChild(s);
  }
  loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', function() {
    loadScript('https://unpkg.com/three@0.128.0/examples/js/loaders/FontLoader.js', function() {
      loadScript('https://unpkg.com/three@0.128.0/examples/js/geometries/TextGeometry.js', function() {
        THREE_CDN_LOADED = true;
        cb();
      });
    });
  });
}

function initPreview() {
  loadThreeScripts(function() {
    var canvas = document.getElementById('previewCanvas');
    var w = canvas.clientWidth, h = canvas.clientHeight || 240;
    previewScene    = new THREE.Scene();
    previewCamera   = new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
    previewCamera.position.set(0, 0, 10);
    previewRenderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    previewRenderer.setPixelRatio(window.devicePixelRatio);
    previewRenderer.setSize(w, h);
    previewRenderer.setClearColor(0x000000, 0);

    var amb = new THREE.AmbientLight(0xffffff, 0.6);
    previewScene.add(amb);
    var dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 5, 5);
    previewScene.add(dir);

    previewMeshes = [null, null, null];
    previewClock  = 0;
    updatePreview();
    previewLoop();
  });
}

function previewLoop() {
  requestAnimationFrame(previewLoop);
  if (!previewRenderer) return;
  previewClock += 0.016;
  previewMeshes.forEach(function(m) {
    if (!m) return;
    m.rotation.y += 0.008;
  });
  previewRenderer.render(previewScene, previewCamera);
}

var previewFontLoader;
function getPreviewFontLoader() {
  if (!previewFontLoader) previewFontLoader = new THREE.FontLoader();
  return previewFontLoader;
}

function loadPreviewFont(track, cb) {
  var url = track.font === 'helvetiker'
    ? 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json'
    : '/fonts/' + track.font + '_typeface.json';
  if (previewFontCache[url]) { cb(previewFontCache[url]); return; }
  getPreviewFontLoader().load(url, function(f) { previewFontCache[url] = f; cb(f); });
}

function updatePreview() {
  if (!previewScene) return;
  state.tracks.forEach(function(t, i) {
    if (!t.enabled) {
      if (previewMeshes[i]) { previewScene.remove(previewMeshes[i]); previewMeshes[i] = null; }
      return;
    }
    loadPreviewFont(t, function(font) {
      if (previewMeshes[i]) { previewScene.remove(previewMeshes[i]); previewMeshes[i] = null; }
      try {
        var geo = new THREE.TextGeometry(t.text || ' ', {
          font: font, size: t.size * 0.7, height: t.depth * 0.7,
          curveSegments: 8, bevelEnabled: t.bevel,
          bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 3,
        });
        geo.center();
        var col = parseInt(t.color.replace('#',''), 16);
        var mat = new THREE.MeshPhongMaterial({ color: col, transparent: true, opacity: 1 });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = t.yPos * 0.5;
        previewScene.add(mesh);
        previewMeshes[i] = mesh;
      } catch(e) {}
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
`;


// ══════════════════════════════════════════════════════════════════════════════
// DISPLAY PAGE
// ══════════════════════════════════════════════════════════════════════════════
function displayPage() {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<title>3D Display</title>' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{overflow:hidden;background:transparent}canvas{display:block;width:100vw;height:100vh}</style>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>' +
    '<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/FontLoader.js"><\/script>' +
    '<script src="https://unpkg.com/three@0.128.0/examples/js/geometries/TextGeometry.js"><\/script>' +
    '</head><body><script>' + DISPLAY_JS + '<\/script></body></html>';
}

const DISPLAY_JS = `
// ── Three.js setup ────────────────────────────────────────────────────────────
var scene    = new THREE.Scene();
var camera   = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 1000);
camera.position.set(0, 0, 10);

var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', function() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

var ambLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambLight);
var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

// ── Easing ────────────────────────────────────────────────────────────────────
function easeOutBounce(t) {
  var n1=7.5625, d1=2.75;
  if (t<1/d1)       return n1*t*t;
  if (t<2/d1)       return n1*(t-=1.5/d1)*t+0.75;
  if (t<2.5/d1)     return n1*(t-=2.25/d1)*t+0.9375;
  return n1*(t-=2.625/d1)*t+0.984375;
}
function easeOutCubic(t)  { return 1-Math.pow(1-t,3); }
function easeInCubic(t)   { return t*t*t; }
function easeOutElastic(t) {
  if (t<=0) return 0; if (t>=1) return 1;
  return Math.pow(2,-10*t)*Math.sin((t*10-0.75)*(2*Math.PI/3))+1;
}
function lerp(a,b,t) { return a+(b-a)*t; }
function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,v)); }

// ── Animation preset definitions ──────────────────────────────────────────────
var ENTER_DUR = {
  crashLandTop:   1600,
  zipInRight:      700,
  zipInSpin:       700,
  spinContinuous:  500,
  spinAndStop:     300,
  bounce:         1400,
  fadeIn:         1000,
  static:          500,
};
var EXIT_DUR = {
  crashLandTop:    600,
  zipInRight:      500,
  zipInSpin:       500,
  spinContinuous:  400,
  spinAndStop:     400,
  bounce:          600,
  fadeIn:          600,
  static:          400,
};

function doEnter(mesh, cfg, t) {
  mesh.visible = true;
  switch(cfg.animation) {
    case 'crashLandTop':
      mesh.position.y = lerp(18, cfg.yPos, easeOutBounce(t));
      mesh.position.x = 0;
      mesh.material.opacity = clamp(t*5, 0, 1);
      break;
    case 'zipInRight':
    case 'zipInSpin':
      mesh.position.x = lerp(22, 0, easeOutElastic(t));
      mesh.position.y = cfg.yPos;
      mesh.material.opacity = clamp(t*4, 0, 1);
      break;
    case 'bounce':
      mesh.position.y = lerp(cfg.yPos+10, cfg.yPos, easeOutBounce(t));
      mesh.position.x = 0;
      mesh.material.opacity = clamp(t*3, 0, 1);
      break;
    default:  // spinContinuous, spinAndStop, fadeIn, static
      mesh.position.set(0, cfg.yPos, 0);
      mesh.material.opacity = t;
      break;
  }
}

function doActive(mesh, cfg, elapsed, trackState) {
  switch(cfg.animation) {
    case 'crashLandTop':
      mesh.position.y = cfg.yPos + Math.sin(elapsed*0.6)*0.04;
      break;
    case 'zipInSpin':
    case 'spinContinuous':
      mesh.rotation.y += 0.015;
      break;
    case 'spinAndStop':
      trackState.rotSpeed = Math.max(0, (trackState.rotSpeed||0.12) - 0.0003);
      mesh.rotation.y += trackState.rotSpeed;
      break;
    case 'bounce':
      mesh.position.y = cfg.yPos + Math.abs(Math.sin(elapsed*1.8))*0.18;
      break;
    case 'zipInRight':
    case 'fadeIn':
    case 'static':
    default:
      break;
  }
}

function doExit(mesh, cfg, t) {
  switch(cfg.animation) {
    case 'crashLandTop':
      mesh.position.y = lerp(cfg.yPos, 18, easeInCubic(t));
      mesh.material.opacity = 1-t;
      break;
    case 'zipInRight':
    case 'zipInSpin':
      mesh.position.x = lerp(0, -22, easeInCubic(t));
      mesh.material.opacity = 1-t;
      break;
    default:
      mesh.material.opacity = 1-t;
      break;
  }
}

// ── Track state ───────────────────────────────────────────────────────────────
var tracks = [
  { phase:'idle', startTime:0, mesh:null, config:null, rotSpeed:0.12, delayTimer:null },
  { phase:'idle', startTime:0, mesh:null, config:null, rotSpeed:0.12, delayTimer:null },
  { phase:'idle', startTime:0, mesh:null, config:null, rotSpeed:0.12, delayTimer:null },
];

var fontCache = {};
var fontLoader = new THREE.FontLoader();

function loadFont(cfg, cb) {
  var url = cfg.font === 'helvetiker'
    ? 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json'
    : '/fonts/' + cfg.font + '_typeface.json';
  if (fontCache[url]) { cb(fontCache[url]); return; }
  fontLoader.load(url, function(f) { fontCache[url]=f; cb(f); },
    undefined, function(e) { console.error('Font load error:', e); });
}

function buildMesh(cfg, cb) {
  loadFont(cfg, function(font) {
    try {
      var geo = new THREE.TextGeometry(cfg.text || ' ', {
        font: font,
        size: cfg.size,
        height: cfg.depth,
        curveSegments: 12,
        bevelEnabled: cfg.bevel,
        bevelThickness: 0.03,
        bevelSize: 0.02,
        bevelOffset: 0,
        bevelSegments: 5,
      });
      geo.center();
      var col = parseInt(cfg.color.replace('#',''), 16);
      var mat = new THREE.MeshPhongMaterial({
        color: col, specular: 0x444444, shininess: 40,
        transparent: true, opacity: 0,
      });
      cb(new THREE.Mesh(geo, mat));
    } catch(e) { console.error('TextGeometry error:', e); }
  });
}

function applyState(newState) {
  newState.tracks.forEach(function(cfg, i) {
    var t = tracks[i];
    t.config = cfg;
    if (!cfg.enabled) {
      // Hide + remove mesh
      if (t.mesh) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); t.mesh = null; }
      t.phase = 'idle';
      return;
    }
    // Rebuild mesh with new config
    buildMesh(cfg, function(mesh) {
      if (t.mesh) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); }
      mesh.visible = false;
      mesh.position.set(0, cfg.yPos, 0);
      scene.add(mesh);
      t.mesh = mesh;
      t.rotSpeed = 0.12;
    });
  });
}

function triggerAll() {
  if (!appState) return;
  appState.tracks.forEach(function(cfg, i) {
    if (!cfg.enabled) return;
    var t = tracks[i];
    clearTimeout(t.delayTimer);
    t.delayTimer = setTimeout(function() {
      if (!t.mesh) return;
      t.phase     = 'entering';
      t.startTime = Date.now();
      t.rotSpeed  = 0.12;
      t.mesh.rotation.set(0,0,0);
      t.mesh.position.set(cfg.animation==='zipInRight'||cfg.animation==='zipInSpin' ? 22 : 0, cfg.yPos, 0);
    }, cfg.delay || 0);
  });
}

function resetAll() {
  tracks.forEach(function(t) {
    clearTimeout(t.delayTimer);
    t.phase = 'idle';
    if (t.mesh) {
      t.mesh.visible = false;
      t.mesh.material.opacity = 0;
      t.mesh.position.set(0, t.config ? t.config.yPos : 0, 0);
      t.mesh.rotation.set(0,0,0);
    }
  });
}

// ── Render loop ───────────────────────────────────────────────────────────────
var lastTime = Date.now();

function animate() {
  requestAnimationFrame(animate);
  var now = Date.now();
  var delta = (now - lastTime) / 1000;
  lastTime = now;

  tracks.forEach(function(t) {
    if (!t.mesh || t.phase === 'idle') return;
    var cfg     = t.config;
    var elapsed = (now - t.startTime) / 1000;

    if (t.phase === 'entering') {
      var dur = (ENTER_DUR[cfg.animation] || 600) / 1000;
      var tv  = clamp(elapsed / dur, 0, 1);
      doEnter(t.mesh, cfg, tv);
      if (tv >= 1) {
        t.phase     = 'active';
        t.startTime = now;
        t.mesh.position.set(0, cfg.yPos, 0);
        t.mesh.material.opacity = 1;
      }
    } else if (t.phase === 'active') {
      doActive(t.mesh, cfg, elapsed, t);
      if (cfg.duration > 0 && elapsed * 1000 >= cfg.duration) {
        t.phase     = 'exiting';
        t.startTime = now;
      }
    } else if (t.phase === 'exiting') {
      var dur = (EXIT_DUR[cfg.animation] || 400) / 1000;
      var tv  = clamp(elapsed / dur, 0, 1);
      doExit(t.mesh, cfg, tv);
      if (tv >= 1) {
        t.phase = 'idle';
        t.mesh.visible = false;
        t.mesh.material.opacity = 0;
      }
    }
  });

  renderer.render(scene, camera);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
var appState = null;
var wsReconnTimer = null;

function connectWS() {
  var ws = new WebSocket('ws://' + location.host);
  ws.onmessage = function(e) {
    var msg = JSON.parse(e.data);
    if (msg.type === 'init' || msg.type === 'state') {
      appState = msg.state;
      applyState(appState);
      if (msg.autoPlay) {
        // Slight delay so meshes can build before animating
        setTimeout(triggerAll, 300);
      }
    } else if (msg.type === 'trigger') {
      triggerAll();
    } else if (msg.type === 'reset') {
      resetAll();
    }
  };
  ws.onclose = function() {
    clearTimeout(wsReconnTimer);
    wsReconnTimer = setTimeout(connectWS, 2000);
  };
  ws.onerror = function() { ws.close(); };
}

connectWS();
animate();
`;

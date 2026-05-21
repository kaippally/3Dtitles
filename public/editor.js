/* ── State ─────────────────────────────────────────────────────────────────── */
var gState     = null;
var gFile      = null;
var gDirty     = false;
var gFonts     = [];
var gPushTimer = null;

var PRESETS = [
  { id: 'crashLandTop',   label: 'Crash Land (Top)'   },
  { id: 'zipInRight',     label: 'Zip In (Right)'      },
  { id: 'zipInSpin',      label: 'Zip In + Spin'       },
  { id: 'spinContinuous', label: 'Spin Continuously'   },
  { id: 'spinAndStop',    label: 'Spin & Stop'         },
  { id: 'bounce',         label: 'Bounce'              },
  { id: 'fadeIn',         label: 'Fade In'             },
  { id: 'static',         label: 'Static'              },
];

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function $(selector)   { return document.querySelector(selector); }
function $id(id)       { return document.getElementById(id); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findTrack(id) {
  return gState.tracks.find(function(t) { return t.id === id; });
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  wireButtons();
  fetchFonts(function() {
    fetchState(function() {
      renderTracks();
      initPreview();   // Three.js scripts already loaded via <script> in HTML
    });
  });
});

/* ── Button wiring ─────────────────────────────────────────────────────────── */
function wireButtons() {
  $id('btnOpen').addEventListener('click', fileOpen);
  $id('btnSave').addEventListener('click', fileSave);
  $id('btnSaveAs').addEventListener('click', fileSaveAs);
  $id('btnFonts').addEventListener('click', scanFonts);
  $id('btnTrigger').addEventListener('click',  apiTrigger);
  $id('btnTrigger2').addEventListener('click', apiTrigger);
  $id('btnReset').addEventListener('click',   apiReset);
  $id('btnReset2').addEventListener('click',  apiReset);
  $id('btnCloseOpen').addEventListener('click',   function() { closeModal('openModal');   });
  $id('btnCloseSaveAs').addEventListener('click', function() { closeModal('saveAsModal'); });
  $id('btnDoSaveAs').addEventListener('click', doSaveAs);

  $id('saveAsName').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSaveAs();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeModal('openModal'); closeModal('saveAsModal'); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); fileSave(); }
  });
}

/* ── Data ──────────────────────────────────────────────────────────────────── */
function fetchFonts(cb) {
  fetch('/api/fonts')
    .then(function(r) { return r.json(); })
    .then(function(d) { gFonts = d; if (cb) cb(); })
    .catch(function(e) { console.error('fetchFonts:', e); if (cb) cb(); });
}

function fetchState(cb) {
  fetch('/api/state')
    .then(function(r) { return r.json(); })
    .then(function(d) { gState = d; if (cb) cb(); })
    .catch(function(e) { console.error('fetchState:', e); if (cb) cb(); });
}

/* ── Track rendering ───────────────────────────────────────────────────────── */
function renderTracks() {
  if (!gState) return;
  var panel = $id('tracksPanel');
  panel.innerHTML = '';
  gState.tracks.forEach(function(t) {
    panel.appendChild(buildTrack(t));
  });
}

function buildTrack(t) {
  var wrap = document.createElement('div');
  wrap.className = 'track' + (t.enabled ? ' active' : '');
  wrap.id = 'track-' + t.id;

  /* ── Font options ── */
  var fOpts = gFonts.map(function(f) {
    return '<option value="' + esc(f.id) + '"' + (t.font === f.id ? ' selected' : '') + '>' + esc(f.label) + '</option>';
  }).join('');

  /* ── Animation options ── */
  var aOpts = PRESETS.map(function(p) {
    return '<option value="' + p.id + '"' + (t.animation === p.id ? ' selected' : '') + '>' + p.label + '</option>';
  }).join('');

  var animLabel = (PRESETS.find(function(p) { return p.id === t.animation; }) || { label: t.animation }).label;

  /* ── Build HTML ──
     All attributes use double quotes — no escaping of single quotes needed.  */
  wrap.innerHTML =
    '<div class="track-header" id="th-' + t.id + '">' +
      '<span class="track-num">T' + t.id + '</span>' +
      '<span class="track-label" id="tLabel-' + t.id + '">' + esc(t.text || '(empty)') + '</span>' +
      '<span class="anim-badge"  id="tBadge-' + t.id + '">' + animLabel + '</span>' +
      '<button class="tog' + (t.enabled ? ' on' : '') + '" id="tTog-' + t.id + '"></button>' +
    '</div>' +
    '<div class="track-body" id="tbody-' + t.id + '">' +
      '<div class="row">' +
        '<label>Text</label>' +
        '<input type="text" id="ti-' + t.id + '" value="' + esc(t.text) + '">' +
      '</div>' +
      '<div class="row">' +
        '<label>Font</label>' +
        '<select id="tf-' + t.id + '">' + fOpts + '</select>' +
        '<label style="min-width:auto">Color</label>' +
        '<input type="color" id="tc-' + t.id + '" value="' + t.color + '">' +
      '</div>' +
      '<div class="row">' +
        '<label>Anim</label>' +
        '<select id="ta-' + t.id + '">' + aOpts + '</select>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="row"><label>Size</label>' +
          '<input type="range" id="ts-' + t.id + '" min="0.2" max="3" step="0.05" value="' + t.size + '">' +
          '<span class="val" id="vs-' + t.id + '">' + t.size + '</span>' +
        '</div>' +
        '<div class="row"><label>Depth</label>' +
          '<input type="range" id="td-' + t.id + '" min="0.02" max="1" step="0.02" value="' + t.depth + '">' +
          '<span class="val" id="vd-' + t.id + '">' + t.depth + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="row"><label>Y Pos</label>' +
          '<input type="range" id="ty-' + t.id + '" min="-5" max="5" step="0.1" value="' + t.yPos + '">' +
          '<span class="val" id="vy-' + t.id + '">' + t.yPos + '</span>' +
        '</div>' +
        '<div class="row"><label>Bevel</label>' +
          '<input type="checkbox" id="tb-' + t.id + '"' + (t.bevel ? ' checked' : '') + '>' +
        '</div>' +
      '</div>' +
      '<div class="row">' +
        '<label>Delay</label>' +
        '<input type="number" id="tdy-' + t.id + '" value="' + t.delay + '" min="0" step="100"> ms' +
        '<label style="min-width:auto;margin-left:10px">Hold</label>' +
        '<input type="number" id="tdr-' + t.id + '" value="' + t.duration + '" min="0" step="500"> ms' +
        '<span style="color:var(--muted);font-size:11px;margin-left:4px">(0=forever)</span>' +
      '</div>' +
    '</div>';

  /* ── Wire events via querySelector — elements are inside wrap, not in document yet ── */
  var tog    = wrap.querySelector('#tTog-'  + t.id);
  var header = wrap.querySelector('#th-'    + t.id);
  var body   = wrap.querySelector('#tbody-' + t.id);

  // Collapse / expand body on header click
  header.addEventListener('click', function(e) {
    if (e.target === tog) return;
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });

  // Enable toggle
  tog.addEventListener('click', function(e) {
    e.stopPropagation();
    var track = findTrack(t.id);
    track.enabled = !track.enabled;
    tog.classList.toggle('on', track.enabled);
    wrap.classList.toggle('active', track.enabled);
    schedulePush();
  });

  // Text input
  wrap.querySelector('#ti-' + t.id).addEventListener('input', function() {
    findTrack(t.id).text = this.value;
    wrap.querySelector('#tLabel-' + t.id).textContent = this.value || '(empty)';
    schedulePush();
  });

  // Font select
  wrap.querySelector('#tf-' + t.id).addEventListener('change', function() {
    findTrack(t.id).font = this.value;
    schedulePush();
  });

  // Animation select
  wrap.querySelector('#ta-' + t.id).addEventListener('change', function() {
    findTrack(t.id).animation = this.value;
    var lbl = (PRESETS.find(function(p) { return p.id === this.value; }.bind(this)) || { label: this.value }).label;
    wrap.querySelector('#tBadge-' + t.id).textContent = lbl;
    schedulePush();
  });

  // Color picker
  wrap.querySelector('#tc-' + t.id).addEventListener('input', function() {
    findTrack(t.id).color = this.value;
    schedulePush();
  });

  // Size slider
  wrap.querySelector('#ts-' + t.id).addEventListener('input', function() {
    findTrack(t.id).size = parseFloat(this.value);
    wrap.querySelector('#vs-' + t.id).textContent = this.value;
    schedulePush();
  });

  // Depth slider
  wrap.querySelector('#td-' + t.id).addEventListener('input', function() {
    findTrack(t.id).depth = parseFloat(this.value);
    wrap.querySelector('#vd-' + t.id).textContent = this.value;
    schedulePush();
  });

  // Y-Pos slider
  wrap.querySelector('#ty-' + t.id).addEventListener('input', function() {
    findTrack(t.id).yPos = parseFloat(this.value);
    wrap.querySelector('#vy-' + t.id).textContent = this.value;
    schedulePush();
  });

  // Bevel checkbox
  wrap.querySelector('#tb-' + t.id).addEventListener('change', function() {
    findTrack(t.id).bevel = this.checked;
    schedulePush();
  });

  // Delay number
  wrap.querySelector('#tdy-' + t.id).addEventListener('input', function() {
    findTrack(t.id).delay = parseFloat(this.value) || 0;
    schedulePush();
  });

  // Duration number
  wrap.querySelector('#tdr-' + t.id).addEventListener('input', function() {
    findTrack(t.id).duration = parseFloat(this.value) || 0;
    schedulePush();
  });

  return wrap;
}

/* ── Push state to server (debounced 400 ms) ───────────────────────────────── */
function schedulePush() {
  markDirty();
  clearTimeout(gPushTimer);
  gPushTimer = setTimeout(pushState, 400);
}

function pushState() {
  if (!gState) return;
  fetch('/api/state', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(gState),
  }).then(function() { updatePreview(); });
}

/* ── File operations ───────────────────────────────────────────────────────── */
function markDirty()    { gDirty = true;  $id('fname').classList.add('dirty');    }
function clearDirty()   { gDirty = false; $id('fname').classList.remove('dirty'); }
function setFilename(n) { gFile = n; $id('fname').textContent = n || 'untitled'; clearDirty(); }

function fileOpen() {
  fetch('/api/saves')
    .then(function(r) { return r.json(); })
    .then(function(saves) {
      var list = $id('savesList');
      list.innerHTML = '';
      if (!saves.length) {
        list.innerHTML = '<li style="color:var(--muted);cursor:default">No saved scenes</li>';
      } else {
        saves.forEach(function(name) {
          var li = document.createElement('li');
          li.innerHTML = esc(name) + '<span>open</span>';
          li.addEventListener('click', function() {
            loadScene(name);
            closeModal('openModal');
          });
          list.appendChild(li);
        });
      }
      $id('openModal').classList.remove('hidden');
    });
}

function loadScene(name) {
  fetch('/api/saves/' + encodeURIComponent(name))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      gState = data;
      setFilename(name);
      renderTracks();
      pushState();
    });
}

function fileSave() {
  if (!gFile) { fileSaveAs(); return; }
  fetch('/api/saves/' + encodeURIComponent(gFile), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(gState),
  }).then(function() { clearDirty(); });
}

function fileSaveAs() {
  $id('saveAsName').value = gFile || '';
  $id('saveAsModal').classList.remove('hidden');
  setTimeout(function() { $id('saveAsName').focus(); }, 50);
}

function doSaveAs() {
  var name = $id('saveAsName').value.trim();
  if (!name) return;
  fetch('/api/saves/' + encodeURIComponent(name), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(gState),
  }).then(function() { setFilename(name); closeModal('saveAsModal'); });
}

function closeModal(mid) { $id(mid).classList.add('hidden'); }

function scanFonts() {
  var btn = $id('btnFonts');
  btn.textContent = '...scanning';
  btn.disabled = true;
  fetch('/api/scan-fonts')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      gFonts = data;
      btn.textContent = '↻ Fonts';
      btn.disabled = false;
      renderTracks();
    });
}

function apiTrigger() { fetch('/api/trigger', { method: 'POST' }); }
function apiReset()   { fetch('/api/reset',   { method: 'POST' }); }

/* ── Live preview ──────────────────────────────────────────────────────────── */
var pvScene, pvCamera, pvRenderer, pvLoader;
var pvMeshes    = [null, null, null];
var pvFontCache = {};

function initPreview() {
  // Three.js already loaded from <script> tags in editor.html
  if (typeof THREE === 'undefined') {
    console.warn('Three.js not loaded yet — preview unavailable');
    return;
  }

  var canvas = $id('previewCanvas');
  var W = canvas.clientWidth  || 340;
  var H = canvas.clientHeight || 240;

  pvScene    = new THREE.Scene();
  pvCamera   = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
  pvCamera.position.set(0, 0, 10);

  pvRenderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  pvRenderer.setPixelRatio(devicePixelRatio);
  pvRenderer.setSize(W, H);
  pvRenderer.setClearColor(0x000000, 0);

  pvScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  var dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(5, 5, 5);
  pvScene.add(dl);

  pvLoader = new THREE.FontLoader();
  pvAnimLoop();
  updatePreview();
}

function pvAnimLoop() {
  requestAnimationFrame(pvAnimLoop);
  if (!pvRenderer) return;
  pvMeshes.forEach(function(m) { if (m) m.rotation.y += 0.008; });
  pvRenderer.render(pvScene, pvCamera);
}

function pvLoadFont(track, cb) {
  var url = track.font === 'helvetiker'
    ? 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json'
    : '/fonts/' + track.font + '_typeface.json';
  if (pvFontCache[url]) { cb(pvFontCache[url]); return; }
  pvLoader.load(url, function(f) { pvFontCache[url] = f; cb(f); });
}

function updatePreview() {
  if (!pvScene || !gState) return;
  gState.tracks.forEach(function(t, i) {
    if (pvMeshes[i]) { pvScene.remove(pvMeshes[i]); pvMeshes[i] = null; }
    if (!t.enabled) return;
    pvLoadFont(t, function(font) {
      try {
        var geo = new THREE.TextGeometry(t.text || ' ', {
          font:          font,
          size:          t.size  * 0.65,
          height:        t.depth * 0.65,
          curveSegments: 8,
          bevelEnabled:  t.bevel,
          bevelThickness: 0.02,
          bevelSize:      0.015,
          bevelSegments:  3,
        });
        geo.center();
        var col = parseInt(t.color.replace('#', ''), 16);
        var mat = new THREE.MeshPhongMaterial({ color: col, transparent: true, opacity: 1 });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = t.yPos * 0.5;
        pvScene.add(mesh);
        pvMeshes[i] = mesh;
      } catch (e) { console.error('preview mesh error:', e); }
    });
  });
}

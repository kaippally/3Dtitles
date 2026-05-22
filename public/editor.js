/* ── State ─────────────────────────────────────────────────────────────────── */
var gState = null;
var gFile = null;
var gDirty = false;
var gFonts = [];
var gPushTimer = null;
var gSpinPaused = false;

var PRESETS = [
  { id: 'crashLandTop', label: 'Crash Land (Top)' },
  { id: 'zipInRight', label: 'Zip In (Right)' },
  { id: 'zipInSpin', label: 'Zip In + Spin' },
  { id: 'spinContinuous', label: 'Spin Continuously' },
  { id: 'spinAndStop', label: 'Spin & Stop' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'fadeIn', label: 'Fade In' },
  { id: 'static', label: 'Static' },
];

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function $(selector) { return document.querySelector(selector); }
function $id(id) { return document.getElementById(id); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findTrack(id) {
  return gState.tracks.find(function (t) { return t.id === id; });
}

function updateTrackOutputText(track) {
  if (track.font && track.font.toLowerCase().includes('manorama')) {
    track.outputText = convertUnicodeToCustomASCII(track.text || '');
  } else {
    track.outputText = track.text || '';
  }
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  wireButtons();
  fetchResolutions(function () {
    fetchFonts(function () {
      fetchState(function () {
        updateGlobalUI();
        renderTracks();
        initPreview();
      });
    });
  });
});

/* ── Button wiring ─────────────────────────────────────────────────────────── */
function wireButtons() {
  $id('btnOpen').addEventListener('click', fileOpen);
  $id('btnSave').addEventListener('click', fileSave);
  $id('btnSaveAs').addEventListener('click', fileSaveAs);
  $id('btnFonts').addEventListener('click', scanFonts);
  $id('btnTrigger').addEventListener('click', apiTrigger);
  $id('btnTrigger2').addEventListener('click', apiTrigger);
  $id('btnReset').addEventListener('click', apiReset);
  $id('btnReset2').addEventListener('click', apiReset);
  $id('btnCloseOpen').addEventListener('click', function () { closeModal('openModal'); });
  $id('btnCloseSaveAs').addEventListener('click', function () { closeModal('saveAsModal'); });
  $id('btnDoSaveAs').addEventListener('click', doSaveAs);

  $id('saveAsName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSaveAs();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal('openModal'); closeModal('saveAsModal'); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); fileSave(); }
  });

  // Global Scene Settings wiring
  $id('selAspectRatio').addEventListener('change', function () {
    if (gState) {
      gState.aspectRatio = this.value;
      schedulePush();
      resizePreview();
    }
  });


  // Pause spin toggle
  $id('btnPauseSpin').addEventListener('click', function () {
    gSpinPaused = !gSpinPaused;
    this.innerHTML = gSpinPaused ? '&#9654; Resume Spin' : '&#10074;&#10074; Pause Spin';
    this.classList.toggle('active', gSpinPaused);
  });
}

/* ── Data ──────────────────────────────────────────────────────────────────── */
function fetchResolutions(cb) {
  fetch('/resolutions.json')
    .then(function (r) { return r.json(); })
    .then(function (resList) {
      var sel = $id('selAspectRatio');
      sel.innerHTML = '';
      resList.forEach(function (res) {
        var opt = document.createElement('option');
        opt.value = res;
        opt.textContent = res;
        sel.appendChild(opt);
      });
      if (cb) cb();
    })
    .catch(function (e) {
      console.error('fetchResolutions error:', e);
      var sel = $id('selAspectRatio');
      var fallback = ["1920x1080", "1080x720", "720x1080", "1280x720", "1080x1080"];
      sel.innerHTML = '';
      fallback.forEach(function (res) {
        var opt = document.createElement('option');
        opt.value = res;
        opt.textContent = res;
        sel.appendChild(opt);
      });
      if (cb) cb();
    });
}

function updateGlobalUI() {
  if (!gState) return;
  $id('selAspectRatio').value = gState.aspectRatio || '1920x1080';
  resizePreview();
}

function fetchFonts(cb) {
  fetch('/api/fonts')
    .then(function (r) { return r.json(); })
    .then(function (d) { gFonts = d; if (cb) cb(); })
    .catch(function (e) { console.error('fetchFonts:', e); if (cb) cb(); });
}

function fetchState(cb) {
  fetch('/api/state')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      gState = d;
      if (gState) {
        if (!gState.aspectRatio) gState.aspectRatio = '1920x1080';
        if (gState.tracks) {
          gState.tracks.forEach(function (t) {
            updateTrackOutputText(t);
            if (t.xPos === undefined) t.xPos = 0.0;
            if (!t.align) t.align = 'center';
            if (t.audioStart === undefined) t.audioStart = '';
            if (t.audioEnd === undefined) t.audioEnd = '';
          });
        }
      }
      if (cb) cb();
    })
    .catch(function (e) { console.error('fetchState:', e); if (cb) cb(); });
}

/* ── Track rendering ───────────────────────────────────────────────────────── */
function renderTracks() {
  if (!gState) return;
  var panel = $id('tracksPanel');
  panel.innerHTML = '';
  gState.tracks.forEach(function (t) {
    panel.appendChild(buildTrack(t));
  });
}

function buildTrack(t) {
  var wrap = document.createElement('div');
  wrap.className = 'track' + (t.enabled ? ' active' : '');
  wrap.id = 'track-' + t.id;

  /* ── Font options ── */
  var fOpts = gFonts.map(function (f) {
    return '<option value="' + esc(f.id) + '"' + (t.font === f.id ? ' selected' : '') + '>' + esc(f.label) + '</option>';
  }).join('');

  /* ── Animation options ── */
  var aOpts = PRESETS.map(function (p) {
    return '<option value="' + p.id + '"' + (t.animation === p.id ? ' selected' : '') + '>' + p.label + '</option>';
  }).join('');

  var animLabel = (PRESETS.find(function (p) { return p.id === t.animation; }) || { label: t.animation }).label;

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
    '<div class="row"><label>X Pos</label>' +
    '<input type="range" id="tx-' + t.id + '" min="-10" max="10" step="0.1" value="' + (t.xPos !== undefined ? t.xPos : 0.0) + '">' +
    '<span class="val" id="vx-' + t.id + '">' + (t.xPos !== undefined ? t.xPos : 0.0) + '</span>' +
    '</div>' +
    '<div class="row"><label>Y Pos</label>' +
    '<input type="range" id="ty-' + t.id + '" min="-5" max="5" step="0.1" value="' + t.yPos + '">' +
    '<span class="val" id="vy-' + t.id + '">' + t.yPos + '</span>' +
    '</div>' +
    '</div>' +
    '<div class="row2">' +
    '<div class="row"><label>Align</label>' +
    '<div class="align-group" id="tag-' + t.id + '">' +
    '<button type="button" class="abtn' + (t.align === 'left' ? ' active' : '') + '" data-val="left" title="Left Align">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>' +
    '</button>' +
    '<button type="button" class="abtn' + (!t.align || t.align === 'center' ? ' active' : '') + '" data-val="center" title="Center Align">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="10" x2="6" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="18" y1="18" x2="6" y2="18"></line></svg>' +
    '</button>' +
    '<button type="button" class="abtn' + (t.align === 'right' ? ' active' : '') + '" data-val="right" title="Right Align">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="7" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="17" y2="18"></line></svg>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '<div class="row"><label>Bevel</label>' +
    '<input type="checkbox" id="tb-' + t.id + '"' + (t.bevel ? ' checked' : '') + '>' +
    '</div>' +
    '</div>' +
    '<div class="row2">' +
    '<div class="row"><label style="min-width:55px">Audio In</label>' +
    '<input type="text" id="tai-' + t.id + '" value="' + esc(t.audioStart || '') + '" placeholder="e.g. /audio/in.mp3" style="width:100%">' +
    '</div>' +
    '<div class="row"><label style="min-width:55px">Audio Out</label>' +
    '<input type="text" id="tao-' + t.id + '" value="' + esc(t.audioEnd || '') + '" placeholder="e.g. /audio/out.mp3" style="width:100%">' +
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
  var tog = wrap.querySelector('#tTog-' + t.id);
  var header = wrap.querySelector('#th-' + t.id);
  var body = wrap.querySelector('#tbody-' + t.id);

  // Collapse / expand body on header click
  header.addEventListener('click', function (e) {
    if (e.target === tog) return;
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });

  // Enable toggle
  tog.addEventListener('click', function (e) {
    e.stopPropagation();
    var track = findTrack(t.id);
    track.enabled = !track.enabled;
    tog.classList.toggle('on', track.enabled);
    wrap.classList.toggle('active', track.enabled);
    schedulePush();
  });

  // Text input
  wrap.querySelector('#ti-' + t.id).addEventListener('input', function () {
    var track = findTrack(t.id);
    track.text = this.value;
    updateTrackOutputText(track);
    wrap.querySelector('#tLabel-' + t.id).textContent = this.value || '(empty)';
    schedulePush();
  });

  // Font select
  wrap.querySelector('#tf-' + t.id).addEventListener('change', function () {
    var track = findTrack(t.id);
    track.font = this.value;
    updateTrackOutputText(track);
    schedulePush();
  });

  // Animation select
  wrap.querySelector('#ta-' + t.id).addEventListener('change', function () {
    findTrack(t.id).animation = this.value;
    var lbl = (PRESETS.find(function (p) { return p.id === this.value; }.bind(this)) || { label: this.value }).label;
    wrap.querySelector('#tBadge-' + t.id).textContent = lbl;
    schedulePush();
  });

  // Color picker
  wrap.querySelector('#tc-' + t.id).addEventListener('input', function () {
    findTrack(t.id).color = this.value;
    schedulePush();
  });

  // Size slider
  wrap.querySelector('#ts-' + t.id).addEventListener('input', function () {
    findTrack(t.id).size = parseFloat(this.value);
    wrap.querySelector('#vs-' + t.id).textContent = this.value;
    schedulePush();
  });

  // Depth slider
  wrap.querySelector('#td-' + t.id).addEventListener('input', function () {
    findTrack(t.id).depth = parseFloat(this.value);
    wrap.querySelector('#vd-' + t.id).textContent = this.value;
    schedulePush();
  });

  // X-Pos slider
  wrap.querySelector('#tx-' + t.id).addEventListener('input', function () {
    findTrack(t.id).xPos = parseFloat(this.value);
    wrap.querySelector('#vx-' + t.id).textContent = this.value;
    schedulePush();
  });

  // Y-Pos slider
  wrap.querySelector('#ty-' + t.id).addEventListener('input', function () {
    findTrack(t.id).yPos = parseFloat(this.value);
    wrap.querySelector('#vy-' + t.id).textContent = this.value;
    schedulePush();
  });

  // Align group
  var alignButtons = wrap.querySelectorAll('#tag-' + t.id + ' .abtn');
  alignButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var track = findTrack(t.id);
      track.align = this.getAttribute('data-val');
      alignButtons.forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      schedulePush();
    });
  });

  // Bevel checkbox
  wrap.querySelector('#tb-' + t.id).addEventListener('change', function () {
    findTrack(t.id).bevel = this.checked;
    schedulePush();
  });

  // Delay number
  wrap.querySelector('#tdy-' + t.id).addEventListener('input', function () {
    findTrack(t.id).delay = parseFloat(this.value) || 0;
    schedulePush();
  });

  // Duration number
  wrap.querySelector('#tdr-' + t.id).addEventListener('input', function () {
    findTrack(t.id).duration = parseFloat(this.value) || 0;
    schedulePush();
  });

  // Audio In input
  wrap.querySelector('#tai-' + t.id).addEventListener('input', function () {
    var track = findTrack(t.id);
    track.audioStart = this.value;
    schedulePush();
  });

  // Audio Out input
  wrap.querySelector('#tao-' + t.id).addEventListener('input', function () {
    var track = findTrack(t.id);
    track.audioEnd = this.value;
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gState),
  }).then(function () { updatePreview(); });
}

/* ── File operations ───────────────────────────────────────────────────────── */
function markDirty() { gDirty = true; $id('fname').classList.add('dirty'); }
function clearDirty() { gDirty = false; $id('fname').classList.remove('dirty'); }
function setFilename(n) { gFile = n; $id('fname').textContent = n || 'untitled'; clearDirty(); }

function fileOpen() {
  fetch('/api/saves')
    .then(function (r) { return r.json(); })
    .then(function (saves) {
      var list = $id('savesList');
      list.innerHTML = '';
      if (!saves.length) {
        list.innerHTML = '<li style="color:var(--muted);cursor:default">No saved scenes</li>';
      } else {
        saves.forEach(function (name) {
          var li = document.createElement('li');
          li.innerHTML = esc(name) + '<span>open</span>';
          li.addEventListener('click', function () {
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
    .then(function (r) { return r.json(); })
    .then(function (data) {
      gState = data;
      if (gState) {
        if (!gState.aspectRatio) gState.aspectRatio = '1920x1080';
        if (gState.tracks) {
          gState.tracks.forEach(function (t) {
            updateTrackOutputText(t);
            if (t.xPos === undefined) t.xPos = 0.0;
            if (!t.align) t.align = 'center';
            if (t.audioStart === undefined) t.audioStart = '';
            if (t.audioEnd === undefined) t.audioEnd = '';
          });
        }
      }
      setFilename(name);
      renderTracks();
      updateGlobalUI();
      pushState();
    });
}

function fileSave() {
  if (!gFile) { fileSaveAs(); return; }
  fetch('/api/saves/' + encodeURIComponent(gFile), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gState),
  }).then(function () { clearDirty(); });
}

function fileSaveAs() {
  $id('saveAsName').value = gFile || '';
  $id('saveAsModal').classList.remove('hidden');
  setTimeout(function () { $id('saveAsName').focus(); }, 50);
}

function doSaveAs() {
  var name = $id('saveAsName').value.trim();
  if (!name) return;
  fetch('/api/saves/' + encodeURIComponent(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gState),
  }).then(function () { setFilename(name); closeModal('saveAsModal'); });
}

function closeModal(mid) { $id(mid).classList.add('hidden'); }

function scanFonts() {
  var btn = $id('btnFonts');
  btn.textContent = '...scanning';
  btn.disabled = true;
  fetch('/api/scan-fonts')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      gFonts = data;
      btn.textContent = '↻ Fonts';
      btn.disabled = false;
      renderTracks();
    });
}

function apiTrigger() { fetch('/api/trigger', { method: 'POST' }); }
function apiReset() { fetch('/api/reset', { method: 'POST' }); }

/* ── Live preview ──────────────────────────────────────────────────────────── */
var pvScene, pvCamera, pvRenderer, pvLoader;
var pvMeshes = [null, null, null];
function initPreview() {
  if (typeof THREE === 'undefined') {
    console.warn('Three.js not loaded yet — preview unavailable');
    return;
  }
  var canvas = $id('previewCanvas');
  pvScene = new THREE.Scene();
  pvCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  pvCamera.position.set(0, 0, 10);

  pvRenderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  pvRenderer.setPixelRatio(devicePixelRatio);
  pvRenderer.setClearColor(0x000000, 0);

  pvScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  var dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(5, 5, 5);
  pvScene.add(dl);

  pvLoader = new THREE.FontLoader();
  window.addEventListener('resize', resizePreview);
  resizePreview();
  pvAnimLoop();
  updatePreview();
}

function resizePreview() {
  if (!pvRenderer || !pvCamera) return;
  var canvas = $id('previewCanvas');
  if (gState && gState.aspectRatio) {
    var parts = gState.aspectRatio.split('x');
    if (parts.length === 2) {
      canvas.style.aspectRatio = parts[0] + ' / ' + parts[1];
    }
  } else {
    canvas.style.aspectRatio = '16 / 9';
  }
  var W = canvas.clientWidth;
  var H = canvas.clientHeight;
  pvCamera.aspect = W / H;
  pvCamera.updateProjectionMatrix();
  pvRenderer.setSize(W, H, false);
}

function pvAnimLoop() {
  requestAnimationFrame(pvAnimLoop);
  if (!pvRenderer) return;
  if (!gSpinPaused) {
    pvMeshes.forEach(function (m) { if (m) m.rotation.y += 0.008; });
  }
  pvRenderer.render(pvScene, pvCamera);
}

function updatePreview() {
  if (!pvScene || !gState) return;
  gState.tracks.forEach(function (t, i) {
    if (pvMeshes[i]) { pvScene.remove(pvMeshes[i]); pvMeshes[i] = null; }
    if (!t.enabled) return;

    var col = parseInt(t.color.replace('#', ''), 16);
    var addMesh = function (geo) {
      if (!geo) return;
      var mat = new THREE.MeshPhongMaterial({ color: col, transparent: true, opacity: 1 });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = (t.xPos !== undefined ? t.xPos : 0.0) * 0.5;
      mesh.position.y = t.yPos * 0.5;
      pvScene.add(mesh);
      pvMeshes[i] = mesh;
    };

    loadFontShared(pvLoader, t.font, function (font) {
      if (!font) return;
      try {
        var text = getRenderingText(t);
        var geo = new THREE.TextGeometry(text, getTextGeometryOptions(t, font));
        alignGeometry(geo, t.align || 'center');
        addMesh(geo);
      } catch (e) { console.error('preview TextGeometry error:', e); }
    });
  });
}

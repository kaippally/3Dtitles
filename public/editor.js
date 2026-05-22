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

function updateTrackOutputText(track) {
  if (track.font && track.font.toLowerCase().includes('manorama')) {
    track.outputText = convertUnicodeToCustomASCII(track.text || '');
  } else {
    track.outputText = track.text || '';
  }
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
    .then(function(d) {
      gState = d;
      if (gState && gState.tracks) {
        gState.tracks.forEach(updateTrackOutputText);
      }
      if (cb) cb();
    })
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
    var track = findTrack(t.id);
    track.text = this.value;
    updateTrackOutputText(track);
    wrap.querySelector('#tLabel-' + t.id).textContent = this.value || '(empty)';
    schedulePush();
  });

  // Font select
  wrap.querySelector('#tf-' + t.id).addEventListener('change', function() {
    var track = findTrack(t.id);
    track.font = this.value;
    updateTrackOutputText(track);
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
      if (gState && gState.tracks) {
        gState.tracks.forEach(updateTrackOutputText);
      }
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
var pvMeshes      = [null, null, null];
var pvFontCache   = {};   // font cache

function initPreview() {
  if (typeof THREE === 'undefined') {
    console.warn('Three.js not loaded yet — preview unavailable');
    return;
  }
  var canvas = $id('previewCanvas');
  var W = canvas.clientWidth  || 340;
  var H = canvas.clientHeight || 240;

  pvScene  = new THREE.Scene();
  pvCamera = new THREE.PerspectiveCamera(45, W/H, 0.1, 1000);
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

/* Load built-in or custom font JSON */
function pvLoadFont(fontId, cb) {
  var url = fontId === 'helvetiker'
    ? '/vendor/fonts/helvetiker_regular.typeface.json'
    : '/fonts/' + fontId + '_typeface.json';

  if (pvFontCache[url]) { cb(pvFontCache[url]); return; }
  pvLoader.load(url, function(f) {
    pvFontCache[url] = f;
    cb(f);
  }, undefined, function(e) {
    console.error('pvLoadFont error:', fontId, e);
    cb(null);
  });
}

function convertUnicodeToCustomASCII(unicodeText) {
    if (!unicodeText) return '';

    let text = unicodeText;

    // --- STEP 1: Apply Unicode Normalization Rules ---
    const normalizations = [
        ['ൻറ', 'ന്റ'], ['ന്പ', 'മ്പ'], ['ററ', 'റ്റ'], ['റ്', 'ർ'],
        ['ണ്', 'ൺ'], ['ന്', 'ൻ'], ['ര്', 'ർ'], ['ല്', 'ൽ'], ['ള്', 'ൾ'],
        ['ക്', 'ൿ'], ['െെ', 'ൈ'], ['ാെ', 'ൊ'], ['ാേ', 'ോ'],
        ['ൗെ', 'ൌ'], ['എെ', 'ഐ'], ['ഇൗ', 'ഈ'], ['ഉൗ', 'ഊ'], ['ഒൗ', 'ഔ']
    ];
    
    normalizations.forEach(([from, to]) => {
        text = text.replace(new RegExp(from, 'g'), to);
    });

    if (text.normalize) {
        text = text.normalize('NFC');
    }

    // --- STEP 2: Complex Sequential Combinations (Pre-Vowels & Split Vowels) ---
    // Handle the visual layout logic where signs wrap *around* or go *before* the letter
    const complexReplacements = [
        // 3-Character Word Specific Constructs
        { target: 'മുന്ദ്രണം', replace: 'മാ്ന്ദ്രണം' }, // Helper hook for custom sub-parsing if needed
        
        // Split Vowel Combinations (Typewriter visual positioning)
        { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{)ൊ/g, replace: 'æ$1Þ' }, // æ + char + Þ
        { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{)ോ/g, replace: 'ç$1Þ' }, // ç + char + Þ
        { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{)ൌ/g, replace: 'æ$1ì' }, // æ + char + ì
        
        // Pre-Vowel Signs (Shift to the front of the syllable block)
        { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{)െ/g, replace: 'æ$1' }, // Left swing e
        { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{)േ/g, replace: 'ç$1' }, // Left swing E
        { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{)ൈ/g, replace: 'è$1' }, // Left swing Ai
    ];

    complexReplacements.forEach(cfg => {
        text = text.replace(cfg.pattern || cfg.target, cfg.replace);
    });

    // --- STEP 3: Multi-character Conjuncts & Core Dictionary Mapping ---
    // Extracted directly from your schema, sorted by length to protect strings like "ന്ത്" from breaking early
    const dictionary = [
        // Complex strings/combinations
        ['ന്ദ്ര', 'ന്ദ്\u0D4D\u0D30'], // Split ndra structurally
        ['കൃ', 'മ\u0D43'],
        ['ഷ്ണ', 'ക്ഷ്ണ'],
        
        // Exact Glyph Dictionary Mappings Provided
        ['ശ്ശ', '€'], ['ശ്ശം', 'Û'], ['വ്വ', 'Œ'], ['ച്ച', '‚'], ['ല്ല', 'ˆ'], ['്ല', 'ï'],
        ['ക്ക', 'A'], ['ങ്ങ', 'B'], ['ങ്ക', 'C'], ['ഞ്ഞ', 'E'], ['ഞ്ച', 'F'], ['ട്ട', 'G'], 
        ['ണ്ണ', 'H'], ['ണ്ട', 'I'], ['ത്ത', 'J'], ['ന്ന', 'K'], ['ന്ത', 'L'], ['പ്പ', 'M'], 
        ['മ്മ', 'N'], ['മ്പ', 'O'], ['ഗ്ഗ', 'P'], ['സ്സ', 'T'], ['ള്ള', 'U'], ['ര്', 'V'], 
        ['ല്', 'W'], ['ന്', 'X'], ['ണ്', 'Y'], ['ള്', 'Z'], ['ന്റ', 'a'], ['്വ', 'b'], 
        ['്യ', 'c'], ['്ര', 'd'], ['ക്ഷ', 'f'], ['ദ്ദ', 'g'], ['ദ്ധ', 'i'], ['ത്ഥ', 'j'], 
        ['ണ്ഡ', 'm'], ['ഗ്ന', 'o'], ['ണ്മ', 'p'], ['ത്ഭ', 'q'], ['r', 'r'], ['ന്ഥ', 's'], 
        ['ന്ധ', 't'], ['ഗ്മ', 'u'], ['ത്മ', 'v'], ['ന്ദ', 'w'], ['റ്റ', 'x'], ['ത്ന', 'y'], 
        ['nm', 'z'], ['ള', '{'], ['മ്ല', '|'], ['ഖ', '~'], ['്', '¡'], ['ം', '¢'], 
        ['ഃ', '£'], ['അ', '¥'], ['സ്ല', 'Š'], ['ഇ', '§'], ['ഉ', '©'], ['ഊ', 'ª'], 
        ['ഋ', '«'], ['എ', '®'], ['ഏ', '¯'], ['ഐ', '°'], ['ഗ്ല', '±'], ['ഒ', '²'], 
        ['ഓ', '³'], ['ക', 'µ'], ['ഖ', '¶'], ['ഗ', '·'], ['ങ', '¹'], ['ച', 'º'], 
        ['ഛ', '»'], ['ട', '¿'], ['ഠ', 'À'], ['ഡ', 'Á'], ['ഢ', 'Â'], ['ണ', 'Ã'], 
        ['ത', 'Ä'], ['ഥ', 'Å'], ['ദ', 'Æ'], ['ധ', 'Ç'], ['ന', 'È'], ['പ', 'É'], 
        ['ഫ', 'Ë'], ['ബ', 'Ì'], ['ഭ', 'Í'], ['മ', 'Î'], ['യ', 'Ï'], ['ക്ല', 'Ð'], 
        ['വ', 'Õ'], ['ശ', 'Ö'], ['×', 'ഷ'], ['ഷ', '×'], ['സ', 'Ø'], ['ഹ', 'Ù'], 
        ['റ്റ', 'Ú'], ['ല', 'Ü'], ['ഴ', 'Ý'], ['റ', 'ù'], ['ആ', '¦'], ['ജ', '¼'], 
        ['ഞ', '¾'],
        
        // Dependent Modifiers
        ['ാ', 'Þ'], ['ി', 'ß'], ['ീ', 'à'], ['ു', 'á'], ['ൂ', 'â'], ['ൃ', 'ã'],
        ['്', 'í'], ['ി', 'ò'], ['ു', 'ó'], ['ൂ', 'ô'], ['ര', 'ø']
    ];

    // Greedily iterate over mapping array
    dictionary.forEach(([unicodeChar, asciiChar]) => {
        text = text.replace(new RegExp(unicodeChar, 'g'), asciiChar);
    });

    // --- STEP 4: Post-Processing / Punctuation Filter ---
    // Optional rule based on clean config $remove_punctuation=true
    text = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");

    return text;
}

function updatePreview() {
  if (!pvScene || !gState) return;
  gState.tracks.forEach(function(t, i) {
    if (pvMeshes[i]) { pvScene.remove(pvMeshes[i]); pvMeshes[i] = null; }
    if (!t.enabled) return;

    var col = parseInt(t.color.replace('#', ''), 16);
    var addMesh = function(geo) {
      if (!geo) return;
      var mat  = new THREE.MeshPhongMaterial({ color: col, transparent: true, opacity: 1 });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = t.yPos * 0.5;
      pvScene.add(mesh);
      pvMeshes[i] = mesh;
    };

    pvLoadFont(t.font, function(font) {
      if (!font) return;
      try {
        var text = t.text || ' ';
        if (t.font && t.font.toLowerCase().includes('manorama')) {
          text = convertUnicodeToCustomASCII(text);
        }
        var geo = new THREE.TextGeometry(text, {
          font:           font,
          size:           t.size  * 0.65,
          height:         t.depth * 0.65,
          curveSegments:  8,
          bevelEnabled:   t.bevel,
          bevelThickness: 0.02,
          bevelSize:      0.015,
          bevelSegments:  3,
        });
        geo.center();
        addMesh(geo);
      } catch (e) { console.error('preview TextGeometry error:', e); }
    });
  });
}

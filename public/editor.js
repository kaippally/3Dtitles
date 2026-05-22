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

var gSelectedTrackId = null;

function selectTrack(trackId) {
  gSelectedTrackId = trackId;
  document.querySelectorAll('.track').forEach(function (el) {
    el.classList.remove('selected-highlight');
  });
  if (trackId !== null) {
    var card = document.getElementById('track-' + trackId);
    if (card) card.classList.add('selected-highlight');
  }
  if (pvSelectionHelper) {
    if (pvGroup) pvGroup.remove(pvSelectionHelper);
    pvSelectionHelper = null;
  }
  if (trackId !== null && pvGroup && gState) {
    var idx = gState.tracks.findIndex(function (t) { return t.id === trackId; });
    if (idx >= 0 && pvMeshes[idx]) {
      drawSelectionHelper(pvMeshes[idx], findTrack(trackId));
    }
  }
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  wireButtons();
  initResizers();
  refreshTemplates();

  var searchInput = $id('templatesSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      filterTemplates(this.value);
    });
  }

  var autoTriggerEl = $id('chkAutoTrigger');
  if (autoTriggerEl) {
    var savedAutoTrigger = localStorage.getItem('autoTriggerEdits');
    if (savedAutoTrigger !== null) {
      autoTriggerEl.checked = (savedAutoTrigger === 'true');
    }
    autoTriggerEl.addEventListener('change', function () {
      localStorage.setItem('autoTriggerEdits', this.checked);
    });
  }

  fetchResolutions(function () {
    fetchFonts(function () {
      fetchInitialState(function () {
        updateGlobalUI();
        renderTracks();
        initPreview();
        refreshTemplates();
      });
    });
  });
});

/* ── Button wiring ─────────────────────────────────────────────────────────── */
function wireButtons() {
  $id('btnSave').addEventListener('click', fileSave);
  $id('btnSaveAs').addEventListener('click', fileSaveAs);
  $id('btnFonts').addEventListener('click', scanFonts);
  $id('btnTrigger').addEventListener('click', apiTrigger);
  $id('btnTrigger2').addEventListener('click', apiTrigger);
  $id('btnReset').addEventListener('click', apiReset);
  $id('btnReset2').addEventListener('click', apiReset);
  $id('btnCloseSaveAs').addEventListener('click', function () { closeModal('saveAsModal'); });
  $id('btnDoSaveAs').addEventListener('click', doSaveAs);

  $id('saveAsName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSaveAs();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeModal('saveAsModal');
      if (gPreviewAudioObj) {
        gPreviewAudioObj.pause();
        gPreviewAudioObj = null;
      }
      closeModal('audioModal');
      closeModal('imageModal');
    }
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


  // Reset view rotation
  var btnResetView = $id('btnResetView');
  if (btnResetView) {
    btnResetView.addEventListener('click', function () {
      if (pvGroup) {
        pvGroup.rotation.set(0, 0, 0);
      }
    });
  }

  // Audio picker modal buttons wiring
  $id('btnCloseAudio').addEventListener('click', function () {
    if (gPreviewAudioObj) {
      gPreviewAudioObj.pause();
      gPreviewAudioObj = null;
    }
    closeModal('audioModal');
  });

  $id('btnClearAudio').addEventListener('click', clearAudioSelection);

  $id('btnUploadAudio').addEventListener('click', function () {
    $id('audioFileInput').click();
  });

  $id('audioFileInput').addEventListener('change', function () {
    var file = this.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      var base64Data = e.target.result;

      var btn = $id('btnUploadAudio');
      var originalText = btn.textContent;
      btn.textContent = 'Uploading...';
      btn.disabled = true;

      fetch('/api/audio/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          data: base64Data
        })
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          btn.textContent = originalText;
          btn.disabled = false;
          if (res.ok) {
            openAudioModal(gActiveAudioTrackId, gActiveAudioField);
          } else {
            alert('Upload failed: ' + (res.error || 'unknown error'));
          }
        })
        .catch(function (err) {
          btn.textContent = originalText;
          btn.disabled = false;
          alert('Upload error: ' + err.message);
        });
    };
    reader.readAsDataURL(file);
    this.value = '';
  });

  // Image picker modal buttons wiring
  $id('btnCloseImage').addEventListener('click', function () {
    closeModal('imageModal');
  });

  $id('btnClearImage').addEventListener('click', clearImageSelection);

  $id('btnUploadImage').addEventListener('click', function () {
    $id('imageFileInput').click();
  });

  $id('imageFileInput').addEventListener('change', function () {
    var file = this.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      var base64Data = e.target.result;

      var btn = $id('btnUploadImage');
      var originalText = btn.textContent;
      btn.textContent = 'Uploading...';
      btn.disabled = true;

      fetch('/api/image/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          data: base64Data
        })
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          btn.textContent = originalText;
          btn.disabled = false;
          if (res.ok) {
            openImageModal(gActiveImageTrackId);
          } else {
            alert('Upload failed: ' + (res.error || 'unknown error'));
          }
        })
        .catch(function (err) {
          btn.textContent = originalText;
          btn.disabled = false;
          alert('Upload error: ' + err.message);
        });
    };
    reader.readAsDataURL(file);
    this.value = '';
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

function normalizeState(state) {
  if (!state) return state;
  if (!state.aspectRatio) state.aspectRatio = '1920x1080';
  if (!state.tracks) state.tracks = [];

  var defaultTracks = [
    { id: 1, enabled: true, type: 'text', text: '', font: 'helvetiker', color: '#ff4444', animation: 'crashLandTop', size: 1.0, depth: 0.30, xPos: 0.0, yPos: 1.8, zPos: 0.0, delay: 0, duration: 0, bevel: true, align: 'center', audioStart: '', audioEnd: '' },
    { id: 2, enabled: false, type: 'text', text: '', font: 'helvetiker', color: '#ffcc00', animation: 'zipInRight', size: 0.8, depth: 0.25, xPos: 0.0, yPos: 0.0, zPos: 0.0, delay: 800, duration: 0, bevel: true, align: 'center', audioStart: '', audioEnd: '' },
    { id: 3, enabled: false, type: 'text', text: '', font: 'helvetiker', color: '#44ff44', animation: 'zipInSpin', size: 0.7, depth: 0.20, xPos: 0.0, yPos: -1.8, zPos: 0.0, delay: 1600, duration: 0, bevel: true, align: 'center', audioStart: '', audioEnd: '' },
    { id: 4, enabled: false, type: 'image', image: '', animation: 'static', size: 1.0, xPos: 0.0, yPos: -1.8, zPos: 0.0, delay: 0, duration: 0, audioStart: '', audioEnd: '' }
  ];

  for (var i = 1; i <= 4; i++) {
    if (!state.tracks.some(function (t) { return t.id === i; })) {
      var def = defaultTracks.find(function (dt) { return dt.id === i; });
      if (def) state.tracks.push(Object.assign({}, def));
    }
  }

  state.tracks.sort(function (a, b) {
    return a.id - b.id;
  });

  state.tracks.forEach(function (t) {
    if (t.type === undefined) t.type = (t.id === 4 ? 'image' : 'text');
    if (t.image === undefined) t.image = '';
    if (t.text === undefined) t.text = '';
    if (t.xPos === undefined) t.xPos = 0.0;
    if (t.yPos === undefined) t.yPos = 0.0;
    if (t.zPos === undefined) t.zPos = 0.0;
    if (t.size === undefined) t.size = 1.0;
    if (t.sizeX === undefined) t.sizeX = t.size;
    if (t.sizeY === undefined) t.sizeY = t.size;
    if (t.shadowEnabled === undefined) t.shadowEnabled = false;
    if (t.shadowDepth === undefined) t.shadowDepth = 0.2;
    if (t.shadowBlur === undefined) t.shadowBlur = 0.0;
    if (t.shadowColor === undefined) t.shadowColor = '#000000';
    if (t.depth === undefined) t.depth = 0.20;
    if (t.delay === undefined) t.delay = 0;
    if (t.duration === undefined) t.duration = 0;
    if (t.bevel === undefined) t.bevel = true;
    if (!t.align) t.align = 'center';
    if (t.audioStart === undefined) t.audioStart = '';
    if (t.audioEnd === undefined) t.audioEnd = '';
    updateTrackOutputText(t);
  });

  return state;
}

function fetchState(cb) {
  fetch('/api/state')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      gState = normalizeState(d);
      if (cb) cb();
    })
    .catch(function (e) { console.error('fetchState:', e); if (cb) cb(); });
}

function fetchInitialState(cb) {
  fetch('/api/active-template')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.activeTemplate) {
        var name = d.activeTemplate;
        fetch('/api/saves/' + encodeURIComponent(name))
          .then(function (r) {
            if (!r.ok) throw new Error('Failed to load active template');
            return r.json();
          })
          .then(function (data) {
            gState = normalizeState(data);
            setFilename(name);
            if (cb) cb();
          })
          .catch(function (err) {
            console.warn('Failed to load active template JSON, falling back:', err);
            fetchState(cb);
          });
      } else {
        fetchState(cb);
      }
    })
    .catch(function (err) {
      console.warn('Error fetching active template name, falling back:', err);
      fetchState(cb);
    });
}

/* ── Track rendering ───────────────────────────────────────────────────────── */
function renderTracks() {
  if (!gState) return;
  var panel = $id('tracksPanel');
  panel.innerHTML = '';
  var sorted = gState.tracks.slice().sort(function (a, b) {
    var aImg = a.type === 'image' ? 0 : 1;
    var bImg = b.type === 'image' ? 0 : 1;
    return aImg - bImg || a.id - b.id;
  });
  sorted.forEach(function (t) { panel.appendChild(buildTrack(t)); });
  // Re-apply highlight after innerHTML wipe
  if (gSelectedTrackId !== null) {
    var card = document.getElementById('track-' + gSelectedTrackId);
    if (card) card.classList.add('selected-highlight');
  }
}

function buildTrack(t) {
  var wrap = document.createElement('div');
  wrap.className = 'track' + (t.enabled ? ' active' : '');
  wrap.id = 'track-' + t.id;

  wrap.addEventListener('click', function (e) {
    if (gSelectedTrackId !== t.id) {
      selectTrack(t.id);
    }
  }, true);

  var aOpts = PRESETS.map(function (p) {
    return '<option value="' + p.id + '"' + (t.animation === p.id ? ' selected' : '') + '>' + p.label + '</option>';
  }).join('');

  var animLabel = (PRESETS.find(function (p) { return p.id === t.animation; }) || { label: t.animation }).label;

  if (t.type === 'image') {
    wrap.innerHTML =
      '<div class="track-header" id="th-' + t.id + '">' +
      '<span class="track-num">T' + t.id + '</span>' +
      '<span class="track-label" id="tLabel-' + t.id + '">' + esc(t.image ? t.image.split('/').pop() : '(no image)') + '</span>' +
      '<span class="anim-badge"  id="tBadge-' + t.id + '">' + animLabel + '</span>' +
      '<button class="tog' + (t.enabled ? ' on' : '') + '" id="tTog-' + t.id + '"></button>' +
      '</div>' +
      '<div class="track-body" id="tbody-' + t.id + '">' +
      '<div class="row">' +
      '<label>Image</label>' +
      '<input type="text" id="timg-' + t.id + '" value="' + esc(t.image || '') + '" placeholder="Click to select PNG..." style="width:100%; cursor:pointer" readonly>' +
      '</div>' +
      '<div class="row">' +
      '<label>Anim</label>' +
      '<select id="ta-' + t.id + '">' + aOpts + '</select>' +
      '</div>' +
      '<div class="row2">' +
      '<div class="row"><label>Size</label>' +
      '<input type="range" id="ts-' + t.id + '" min="0.1" max="10" step="0.05" value="' + t.size + '">' +
      '<span class="val" id="vs-' + t.id + '">' + t.size + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="row2">' +
      '<div class="row"><label>X Pos</label>' +
      '<input type="range" id="tx-' + t.id + '" min="-20" max="20" step="0.1" value="' + (t.xPos !== undefined ? t.xPos : 0.0) + '">' +
      '<span class="val" id="vx-' + t.id + '">' + (t.xPos !== undefined ? t.xPos : 0.0) + '</span>' +
      '</div>' +
      '<div class="row"><label>Y Pos</label>' +
      '<input type="range" id="ty-' + t.id + '" min="-10" max="10" step="0.1" value="' + t.yPos + '">' +
      '<span class="val" id="vy-' + t.id + '">' + t.yPos + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="row2">' +
      '<div class="row"><label>Z Pos</label>' +
      '<input type="range" id="tz-' + t.id + '" min="-10" max="10" step="0.1" value="' + (t.zPos !== undefined ? t.zPos : 0.0) + '">' +
      '<span class="val" id="vz-' + t.id + '">' + (t.zPos !== undefined ? t.zPos : 0.0) + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="row2">' +
      '<div class="row"><label style="min-width:55px">Audio In</label>' +
      '<input type="text" id="tai-' + t.id + '" value="' + esc(t.audioStart || '') + '" placeholder="Click to select Audio In..." style="width:100%; cursor:pointer" readonly>' +
      '</div>' +
      '<div class="row"><label style="min-width:55px">Audio Out</label>' +
      '<input type="text" id="tao-' + t.id + '" value="' + esc(t.audioEnd || '') + '" placeholder="Click to select Audio Out..." style="width:100%; cursor:pointer" readonly>' +
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

    var tog = wrap.querySelector('#tTog-' + t.id);
    var header = wrap.querySelector('#th-' + t.id);
    var body = wrap.querySelector('#tbody-' + t.id);

    header.addEventListener('click', function (e) {
      if (e.target === tog) return;
      body.style.display = body.style.display === 'none' ? '' : 'none';
    });

    tog.addEventListener('click', function (e) {
      e.stopPropagation();
      var track = findTrack(t.id);
      track.enabled = !track.enabled;
      tog.classList.toggle('on', track.enabled);
      wrap.classList.toggle('active', track.enabled);
      schedulePush();
    });

    wrap.querySelector('#timg-' + t.id).addEventListener('click', function () {
      openImageModal(t.id);
    });

    wrap.querySelector('#ta-' + t.id).addEventListener('change', function () {
      findTrack(t.id).animation = this.value;
      var lbl = (PRESETS.find(function (p) { return p.id === this.value; }.bind(this)) || { label: this.value }).label;
      wrap.querySelector('#tBadge-' + t.id).textContent = lbl;
      schedulePush();
    });

    wrap.querySelector('#ts-' + t.id).addEventListener('input', function () {
      var track = findTrack(t.id);
      track.size = parseFloat(this.value);
      track.sizeX = track.size;
      track.sizeY = track.size;
      wrap.querySelector('#vs-' + t.id).textContent = this.value;
      schedulePush();
    });

    wrap.querySelector('#tx-' + t.id).addEventListener('input', function () {
      findTrack(t.id).xPos = parseFloat(this.value);
      wrap.querySelector('#vx-' + t.id).textContent = this.value;
      schedulePush();
    });

    wrap.querySelector('#ty-' + t.id).addEventListener('input', function () {
      findTrack(t.id).yPos = parseFloat(this.value);
      wrap.querySelector('#vy-' + t.id).textContent = this.value;
      schedulePush();
    });

    wrap.querySelector('#tz-' + t.id).addEventListener('input', function () {
      findTrack(t.id).zPos = parseFloat(this.value);
      wrap.querySelector('#vz-' + t.id).textContent = this.value;
      schedulePush();
    });

    wrap.querySelector('#tdy-' + t.id).addEventListener('input', function () {
      findTrack(t.id).delay = parseFloat(this.value) || 0;
      schedulePush();
    });

    wrap.querySelector('#tdr-' + t.id).addEventListener('input', function () {
      findTrack(t.id).duration = parseFloat(this.value) || 0;
      schedulePush();
    });

    wrap.querySelector('#tai-' + t.id).addEventListener('click', function () {
      openAudioModal(t.id, 'audioStart');
    });

    wrap.querySelector('#tao-' + t.id).addEventListener('click', function () {
      openAudioModal(t.id, 'audioEnd');
    });

    return wrap;
  }

  /* ── Font options ── */
  var fOpts = gFonts.map(function (f) {
    return '<option value="' + esc(f.id) + '"' + (t.font === f.id ? ' selected' : '') + '>' + esc(f.label) + '</option>';
  }).join('');

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
    '<input type="range" id="tx-' + t.id + '" min="-20" max="20" step="0.1" value="' + (t.xPos !== undefined ? t.xPos : 0.0) + '">' +
    '<span class="val" id="vx-' + t.id + '">' + (t.xPos !== undefined ? t.xPos : 0.0) + '</span>' +
    '</div>' +
    '<div class="row"><label>Y Pos</label>' +
    '<input type="range" id="ty-' + t.id + '" min="-10" max="10" step="0.1" value="' + t.yPos + '">' +
    '<span class="val" id="vy-' + t.id + '">' + t.yPos + '</span>' +
    '</div>' +
    '</div>' +
    '<div class="row2">' +
    '<div class="row"><label>Z Pos</label>' +
    '<input type="range" id="tz-' + t.id + '" min="-10" max="10" step="0.1" value="' + (t.zPos !== undefined ? t.zPos : 0.0) + '">' +
    '<span class="val" id="vz-' + t.id + '">' + (t.zPos !== undefined ? t.zPos : 0.0) + '</span>' +
    '</div>' +
    '<div class="row"><label>Bevel</label>' +
    '<input type="checkbox" id="tb-' + t.id + '"' + (t.bevel ? ' checked' : '') + '>' +
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
    '</div>' +
    '<div class="row2">' +
    '<div class="row"><label style="min-width:55px">Audio In</label>' +
    '<input type="text" id="tai-' + t.id + '" value="' + esc(t.audioStart || '') + '" placeholder="Click to select Audio In..." style="width:100%; cursor:pointer" readonly>' +
    '</div>' +
    '<div class="row"><label style="min-width:55px">Audio Out</label>' +
    '<input type="text" id="tao-' + t.id + '" value="' + esc(t.audioEnd || '') + '" placeholder="Click to select Audio Out..." style="width:100%; cursor:pointer" readonly>' +
    '</div>' +
    '</div>' +
    '<div class="row" style="gap:6px">' +
    '<label style="min-width:auto;display:flex;align-items:center;gap:4px">' +
    '<input type="checkbox" id="tse-' + t.id + '"' + (t.shadowEnabled ? ' checked' : '') + '> Shadow' +
    '</label>' +
    '<input type="color" id="tsc-' + t.id + '" value="' + (t.shadowColor || '#000000') + '" style="width:30px;height:24px;padding:0;border:none;margin-left:4px">' +
    '<label style="min-width:auto;margin-left:4px">Depth</label>' +
    '<input type="number" id="tsd-' + t.id + '" min="-2" max="2" step="0.05" value="' + (t.shadowDepth !== undefined ? t.shadowDepth : 0.2) + '" style="width:55px;height:24px;padding:2px">' +
    '<label style="min-width:auto;margin-left:4px">Blur</label>' +
    '<input type="number" id="tsb-' + t.id + '" min="0" max="5" step="0.1" value="' + (t.shadowBlur !== undefined ? t.shadowBlur : 0.0) + '" style="width:50px;height:24px;padding:2px">' +
    '</div>' +
    '<div class="row">' +
    '<label>Delay</label>' +
    '<input type="number" id="tdy-' + t.id + '" value="' + t.delay + '" min="0" step="100"> ms' +
    '<label style="min-width:auto;margin-left:10px">Hold</label>' +
    '<input type="number" id="tdr-' + t.id + '" value="' + t.duration + '" min="0" step="500"> ms' +
    '<span style="color:var(--muted);font-size:11px;margin-left:4px">(0=forever)</span>' +
    '</div>' +
    '</div>';

  /* ── Wire events via querySelector ── */
  var tog = wrap.querySelector('#tTog-' + t.id);
  var header = wrap.querySelector('#th-' + t.id);
  var body = wrap.querySelector('#tbody-' + t.id);

  header.addEventListener('click', function (e) {
    if (e.target === tog) return;
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });

  tog.addEventListener('click', function (e) {
    e.stopPropagation();
    var track = findTrack(t.id);
    track.enabled = !track.enabled;
    tog.classList.toggle('on', track.enabled);
    wrap.classList.toggle('active', track.enabled);
    schedulePush();
  });

  wrap.querySelector('#ti-' + t.id).addEventListener('input', function () {
    var track = findTrack(t.id);
    track.text = this.value;
    updateTrackOutputText(track);
    wrap.querySelector('#tLabel-' + t.id).textContent = this.value || '(empty)';
    schedulePush();
  });

  wrap.querySelector('#tf-' + t.id).addEventListener('change', function () {
    var track = findTrack(t.id);
    track.font = this.value;
    updateTrackOutputText(track);
    schedulePush();
  });

  wrap.querySelector('#ta-' + t.id).addEventListener('change', function () {
    findTrack(t.id).animation = this.value;
    var lbl = (PRESETS.find(function (p) { return p.id === this.value; }.bind(this)) || { label: this.value }).label;
    wrap.querySelector('#tBadge-' + t.id).textContent = lbl;
    schedulePush();
  });

  wrap.querySelector('#tc-' + t.id).addEventListener('input', function () {
    findTrack(t.id).color = this.value;
    schedulePush();
  });

  wrap.querySelector('#ts-' + t.id).addEventListener('input', function () {
    var track = findTrack(t.id);
    track.size = parseFloat(this.value);
    track.sizeX = track.size;
    track.sizeY = track.size;
    wrap.querySelector('#vs-' + t.id).textContent = this.value;
    schedulePush();
  });

  wrap.querySelector('#td-' + t.id).addEventListener('input', function () {
    findTrack(t.id).depth = parseFloat(this.value);
    wrap.querySelector('#vd-' + t.id).textContent = this.value;
    schedulePush();
  });

  wrap.querySelector('#tx-' + t.id).addEventListener('input', function () {
    findTrack(t.id).xPos = parseFloat(this.value);
    wrap.querySelector('#vx-' + t.id).textContent = this.value;
    schedulePush();
  });

  wrap.querySelector('#ty-' + t.id).addEventListener('input', function () {
    findTrack(t.id).yPos = parseFloat(this.value);
    wrap.querySelector('#vy-' + t.id).textContent = this.value;
    schedulePush();
  });

  wrap.querySelector('#tz-' + t.id).addEventListener('input', function () {
    findTrack(t.id).zPos = parseFloat(this.value);
    wrap.querySelector('#vz-' + t.id).textContent = this.value;
    schedulePush();
  });

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

  wrap.querySelector('#tb-' + t.id).addEventListener('change', function () {
    findTrack(t.id).bevel = this.checked;
    schedulePush();
  });

  wrap.querySelector('#tse-' + t.id).addEventListener('change', function () {
    findTrack(t.id).shadowEnabled = this.checked;
    schedulePush();
  });

  wrap.querySelector('#tsc-' + t.id).addEventListener('input', function () {
    findTrack(t.id).shadowColor = this.value;
    schedulePush();
  });

  wrap.querySelector('#tsd-' + t.id).addEventListener('input', function () {
    findTrack(t.id).shadowDepth = parseFloat(this.value) || 0;
    schedulePush();
  });

  wrap.querySelector('#tsb-' + t.id).addEventListener('input', function () {
    findTrack(t.id).shadowBlur = parseFloat(this.value) || 0;
    schedulePush();
  });

  wrap.querySelector('#tdy-' + t.id).addEventListener('input', function () {
    findTrack(t.id).delay = parseFloat(this.value) || 0;
    schedulePush();
  });

  wrap.querySelector('#tdr-' + t.id).addEventListener('input', function () {
    findTrack(t.id).duration = parseFloat(this.value) || 0;
    schedulePush();
  });

  wrap.querySelector('#tai-' + t.id).addEventListener('click', function () {
    openAudioModal(t.id, 'audioStart');
  });

  wrap.querySelector('#tao-' + t.id).addEventListener('click', function () {
    openAudioModal(t.id, 'audioEnd');
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
  var autoTriggerEl = $id('chkAutoTrigger');
  var autoTrigger = autoTriggerEl ? autoTriggerEl.checked : true;
  var body = JSON.stringify(gState);

  var statePromise = fetch('/api/state?autoPlay=' + autoTrigger, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body,
  }).then(function (r) {
    if (!r.ok) console.error('Error pushing state to server');
    updatePreview();
  });

  var savePromise = gFile
    ? fetch('/api/saves/' + encodeURIComponent(gFile), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      }).then(function (res) {
        if (res.ok) clearDirty();
        else console.error('Auto-save failed');
      }).catch(function (err) {
        console.error('Auto-save error:', err);
      })
    : Promise.resolve();

  Promise.all([statePromise, savePromise]).catch(function (e) {
    console.error('pushState error:', e);
  });
}

/* ── File operations ───────────────────────────────────────────────────────── */
function markDirty() { gDirty = true; $id('fname').classList.add('dirty'); }
function clearDirty() { gDirty = false; $id('fname').classList.remove('dirty'); }
function setFilename(n) { gFile = n; $id('fname').textContent = n || 'untitled'; clearDirty(); }

function loadScene(name) {
  fetch('/api/saves/' + encodeURIComponent(name))
    .then(function (r) {
      if (!r.ok) {
        throw new Error('Failed to load scene');
      }
      return r.json();
    })
    .then(function (data) {
      gState = normalizeState(data);
      setFilename(name);
      renderTracks();
      updateGlobalUI();
      pushState();
      refreshTemplates();
    })
    .catch(function (err) {
      alert('Error loading scene: ' + err.message);
    });
}

function fileSave() {
  if (!gFile) { fileSaveAs(); return; }
  fetch('/api/saves/' + encodeURIComponent(gFile), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gState),
  })
    .then(function (res) {
      if (!res.ok) {
        return res.json().then(function (err) { throw new Error(err.error || 'Server error'); });
      }
      return res.json();
    })
    .then(function () {
      clearDirty();
      refreshTemplates();
      console.log('Saved successfully');
    })
    .catch(function (err) {
      alert('Error saving template: ' + err.message);
    });
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
  })
    .then(function (res) {
      if (!res.ok) {
        return res.json().then(function (err) { throw new Error(err.error || 'Server error'); });
      }
      return res.json();
    })
    .then(function () {
      setFilename(name);
      closeModal('saveAsModal');
      refreshTemplates();
    })
    .catch(function (err) {
      alert('Error saving template: ' + err.message);
    });
}

function closeModal(mid) {
  var el = $id(mid);
  if (el) el.classList.add('hidden');
}

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

/* ── Audio selection modal ────────────────────────────────────────────────── */
var gActiveAudioTrackId = null;
var gActiveAudioField = null;
var gPreviewAudioObj = null;

function openAudioModal(trackId, field) {
  gActiveAudioTrackId = trackId;
  gActiveAudioField = field;

  fetch('/api/audio')
    .then(function (r) { return r.json(); })
    .then(function (files) {
      var list = $id('audioList');
      list.innerHTML = '';
      if (!files.length) {
        list.innerHTML = '<li style="color:var(--muted);cursor:default;padding:8px 12px;">No audio files found. Upload one!</li>';
      } else {
        files.forEach(function (filename) {
          var li = document.createElement('li');
          li.style.display = 'flex';
          li.style.justifyContent = 'space-between';
          li.style.alignItems = 'center';
          li.style.padding = '8px 12px';

          var nameSpan = document.createElement('span');
          nameSpan.textContent = filename;
          nameSpan.style.cursor = 'pointer';
          nameSpan.style.flex = '1';
          nameSpan.addEventListener('click', function () {
            selectAudio('/audio/' + filename);
          });
          li.appendChild(nameSpan);

          var playBtn = document.createElement('button');
          playBtn.className = 'hbtn';
          playBtn.style.padding = '2px 8px';
          playBtn.style.marginLeft = '10px';
          playBtn.innerHTML = '▶';
          playBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            togglePreviewAudio('/audio/' + filename, playBtn);
          });
          li.appendChild(playBtn);

          list.appendChild(li);
        });
      }
      $id('audioModal').classList.remove('hidden');
    });
}

function togglePreviewAudio(url, btn) {
  if (gPreviewAudioObj) {
    gPreviewAudioObj.pause();
    if (gPreviewAudioObj.src.endsWith(url)) {
      gPreviewAudioObj = null;
      btn.innerHTML = '▶';
      return;
    }
  }

  document.querySelectorAll('#audioList button').forEach(function (b) {
    b.innerHTML = '▶';
  });

  gPreviewAudioObj = new Audio(url);
  gPreviewAudioObj.play().catch(function (e) { console.warn("Preview play blocked/failed:", e); });
  btn.innerHTML = '■';
  gPreviewAudioObj.onended = function () {
    btn.innerHTML = '▶';
    gPreviewAudioObj = null;
  };
}

function selectAudio(url) {
  if (gPreviewAudioObj) {
    gPreviewAudioObj.pause();
    gPreviewAudioObj = null;
  }
  var track = findTrack(gActiveAudioTrackId);
  if (track) {
    track[gActiveAudioField] = url;
    var inputId = gActiveAudioField === 'audioStart' ? 'tai-' + gActiveAudioTrackId : 'tao-' + gActiveAudioTrackId;
    var input = $id(inputId);
    if (input) input.value = url;
    schedulePush();
  }
  closeModal('audioModal');
}

function clearAudioSelection() {
  if (gPreviewAudioObj) {
    gPreviewAudioObj.pause();
    gPreviewAudioObj = null;
  }
  var track = findTrack(gActiveAudioTrackId);
  if (track) {
    track[gActiveAudioField] = '';
    var inputId = gActiveAudioField === 'audioStart' ? 'tai-' + gActiveAudioTrackId : 'tao-' + gActiveAudioTrackId;
    var input = $id(inputId);
    if (input) input.value = '';
    schedulePush();
  }
  closeModal('audioModal');
}

/* ── Image selection modal ────────────────────────────────────────────────── */
var gActiveImageTrackId = null;

function openImageModal(trackId) {
  gActiveImageTrackId = trackId;

  fetch('/api/images')
    .then(function (r) { return r.json(); })
    .then(function (files) {
      var list = $id('imageList');
      list.innerHTML = '';
      if (!files.length) {
        list.innerHTML = '<li style="color:var(--muted);cursor:default;padding:8px 12px;">No PNG images found. Upload one!</li>';
      } else {
        files.forEach(function (filename) {
          var li = document.createElement('li');
          li.style.display = 'flex';
          li.style.justifyContent = 'space-between';
          li.style.alignItems = 'center';
          li.style.padding = '8px 12px';

          var nameSpan = document.createElement('span');
          nameSpan.textContent = filename;
          nameSpan.style.cursor = 'pointer';
          nameSpan.style.flex = '1';
          nameSpan.addEventListener('click', function () {
            selectImage('/images/' + filename);
          });
          li.appendChild(nameSpan);

          var imgPreview = document.createElement('img');
          imgPreview.src = '/images/' + filename;
          imgPreview.style.height = '24px';
          imgPreview.style.marginLeft = '10px';
          imgPreview.style.borderRadius = '2px';
          imgPreview.style.border = '1px solid var(--border)';
          li.appendChild(imgPreview);

          list.appendChild(li);
        });
      }
      $id('imageModal').classList.remove('hidden');
    });
}

function selectImage(url) {
  var track = findTrack(gActiveImageTrackId);
  if (track) {
    track.image = url;
    var input = $id('timg-' + gActiveImageTrackId);
    if (input) input.value = url;
    var lbl = $id('tLabel-' + gActiveImageTrackId);
    if (lbl) lbl.textContent = url.split('/').pop();
    schedulePush();
  }
  closeModal('imageModal');
}

function clearImageSelection() {
  var track = findTrack(gActiveImageTrackId);
  if (track) {
    track.image = '';
    var input = $id('timg-' + gActiveImageTrackId);
    if (input) input.value = '';
    var lbl = $id('tLabel-' + gActiveImageTrackId);
    if (lbl) lbl.textContent = '(no image)';
    schedulePush();
  }
  closeModal('imageModal');
}

/* ── Live preview ──────────────────────────────────────────────────────────── */
var pvScene, pvCamera, pvRenderer, pvLoader, pvGroup;
var pvMeshes = [null, null, null, null];
var pvSelectionHelper = null;

function getZPlane(track) {
  return (track.zPos !== undefined ? track.zPos : 0.0) * 0.5;
}

function getHandlesFromSelection() {
  var handles = [];
  if (pvSelectionHelper) {
    pvSelectionHelper.traverse(function (child) {
      if (child.userData && child.userData.isHandle) handles.push(child);
    });
  }
  return handles;
}

function getLocalRay(raycaster) {
  pvGroup.updateMatrixWorld();
  var invMatrix = new THREE.Matrix4().copy(pvGroup.matrixWorld).invert();
  var localOrigin = raycaster.ray.origin.clone().applyMatrix4(invMatrix);
  var localDirection = raycaster.ray.direction.clone().transformDirection(invMatrix);
  return new THREE.Ray(localOrigin, localDirection);
}

function getLocalIntersection(raycaster, zPlane) {
  var localRay = getLocalRay(raycaster);
  if (Math.abs(localRay.direction.z) < 0.0001) return null;
  var t = (zPlane - localRay.origin.z) / localRay.direction.z;
  if (t < 0) return null;
  return new THREE.Vector3().copy(localRay.origin).addScaledVector(localRay.direction, t);
}

function getTrackIdFromObject(obj) {
  var curr = obj;
  while (curr) {
    if (curr.userData && curr.userData.trackId !== undefined) {
      return curr.userData.trackId;
    }
    curr = curr.parent;
  }
  return null;
}

function getTrackLocalBounds(mesh, track) {
  if (track.type === 'image') {
    if (mesh && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      var min = mesh.geometry.boundingBox.min;
      var max = mesh.geometry.boundingBox.max;
      return {
        minX: min.x,
        maxX: max.x,
        minY: min.y,
        maxY: max.y
      };
    }
    return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };
  } else {
    var textMesh = mesh;
    if (mesh instanceof THREE.Group) {
      textMesh = mesh.children[0];
    }
    if (textMesh && textMesh.geometry) {
      textMesh.geometry.computeBoundingBox();
      var min = textMesh.geometry.boundingBox.min;
      var max = textMesh.geometry.boundingBox.max;
      return {
        minX: min.x,
        maxX: max.x,
        minY: min.y,
        maxY: max.y
      };
    }
    return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };
  }
}

function drawSelectionHelper(mesh, track) {
  if (!pvGroup) return;
  if (pvSelectionHelper) {
    pvSelectionHelper.traverse(function (child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    pvGroup.remove(pvSelectionHelper);
    pvSelectionHelper = null;
  }

  var bounds = getTrackLocalBounds(mesh, track);

  var helperGroup = new THREE.Group();
  helperGroup.position.copy(mesh.position);

  var boxGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(bounds.minX, bounds.maxY, 0.01),
    new THREE.Vector3(bounds.maxX, bounds.maxY, 0.01),
    new THREE.Vector3(bounds.maxX, bounds.minY, 0.01),
    new THREE.Vector3(bounds.minX, bounds.minY, 0.01),
    new THREE.Vector3(bounds.minX, bounds.maxY, 0.01)
  ]);
  var boxMat = new THREE.LineBasicMaterial({ color: 0x00a2ff });
  var boxLine = new THREE.Line(boxGeo, boxMat);
  helperGroup.add(boxLine);

  var handleGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  var handleMat = new THREE.MeshBasicMaterial({ color: 0x00a2ff, depthTest: false });

  var corners = [
    { name: 'TL', x: bounds.minX, y: bounds.maxY },
    { name: 'TR', x: bounds.maxX, y: bounds.maxY },
    { name: 'BL', x: bounds.minX, y: bounds.minY },
    { name: 'BR', x: bounds.maxX, y: bounds.minY }
  ];

  corners.forEach(function (c) {
    var handleMesh = new THREE.Mesh(handleGeo, handleMat);
    handleMesh.position.set(c.x, c.y, 0.01);
    handleMesh.userData = { isHandle: true, handleName: c.name, trackId: track.id };
    helperGroup.add(handleMesh);
  });

  pvGroup.add(helperGroup);
  pvSelectionHelper = helperGroup;
}

function syncTrackSidebarInputs(t) {
  var card = document.getElementById('track-' + t.id);
  if (!card) return;
  var tx = card.querySelector('#tx-' + t.id);
  if (tx) {
    tx.value = t.xPos.toFixed(1);
    var vx = card.querySelector('#vx-' + t.id);
    if (vx) vx.textContent = t.xPos.toFixed(1);
  }
  var ty = card.querySelector('#ty-' + t.id);
  if (ty) {
    ty.value = t.yPos.toFixed(1);
    var vy = card.querySelector('#vy-' + t.id);
    if (vy) vy.textContent = t.yPos.toFixed(1);
  }
  var ts = card.querySelector('#ts-' + t.id);
  if (ts) {
    ts.value = t.size.toFixed(2);
    var vs = card.querySelector('#vs-' + t.id);
    if (vs) vs.textContent = t.size.toFixed(2);
  }
}

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

  pvGroup = new THREE.Group();
  pvScene.add(pvGroup);

  pvLoader = new THREE.FontLoader();

  var dragMode = null;
  var dragTrackId = null;
  var dragHandleName = null;
  var dragStartIntersection = null;
  var dragStartTrackState = null;
  var previousPointerPosition = { x: 0, y: 0 };
  var pvRaycaster = new THREE.Raycaster();
  var pvMouseVec = new THREE.Vector2();

  canvas.style.cursor = 'grab';

  canvas.addEventListener('pointerdown', function (e) {
    var rect = canvas.getBoundingClientRect();
    pvMouseVec.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    pvRaycaster.setFromCamera(pvMouseVec, pvCamera);

    // 1. Check if we hit a handle of the selected track
    var intersectsHandles = pvRaycaster.intersectObjects(getHandlesFromSelection());
    if (intersectsHandles.length > 0) {
      var handleObj = intersectsHandles[0].object;
      dragMode = 'resize';
      dragTrackId = handleObj.userData.trackId;
      dragHandleName = handleObj.userData.handleName;

      var track = findTrack(dragTrackId);
      dragStartTrackState = JSON.parse(JSON.stringify(track));
      dragStartIntersection = getLocalIntersection(pvRaycaster, getZPlane(track));

      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'pointer';
      e.stopPropagation();
      return;
    }

    // 2. Check if we hit a track mesh
    var meshObjects = pvMeshes.filter(function (m) { return !!m; });
    var intersectsMeshes = pvRaycaster.intersectObjects(meshObjects, true);
    if (intersectsMeshes.length > 0) {
      var trackId = getTrackIdFromObject(intersectsMeshes[0].object);
      if (trackId !== null) {
        dragMode = 'translate';
        dragTrackId = trackId;

        var track = findTrack(dragTrackId);
        dragStartTrackState = JSON.parse(JSON.stringify(track));
        dragStartIntersection = getLocalIntersection(pvRaycaster, getZPlane(track));

        selectTrack(trackId);

        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'move';
        e.stopPropagation();
        return;
      }
    }

    // 3. Hit background — rotate scene
    dragMode = 'rotate';
    previousPointerPosition = { x: e.clientX, y: e.clientY };
    selectTrack(null);
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', function (e) {
    var rect = canvas.getBoundingClientRect();
    pvMouseVec.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    pvRaycaster.setFromCamera(pvMouseVec, pvCamera);

    if (!dragMode) {
      if (pvRaycaster.intersectObjects(getHandlesFromSelection()).length > 0) {
        canvas.style.cursor = 'pointer';
        return;
      }
      var meshObjects = pvMeshes.filter(function (m) { return !!m; });
      if (pvRaycaster.intersectObjects(meshObjects, true).length > 0) {
        canvas.style.cursor = 'move';
        return;
      }
      canvas.style.cursor = 'grab';
      return;
    }

    if (dragMode === 'rotate') {
      var deltaX = e.clientX - previousPointerPosition.x;
      var deltaY = e.clientY - previousPointerPosition.y;

      if (pvGroup) {
        pvGroup.rotation.y += deltaX * 0.01;
        pvGroup.rotation.x += deltaY * 0.01;
      }

      previousPointerPosition = { x: e.clientX, y: e.clientY };
      return;
    }

    if (dragMode === 'translate') {
      var currentIntersection = getLocalIntersection(pvRaycaster, getZPlane(dragStartTrackState));
      if (currentIntersection && dragStartIntersection) {
        var translateDeltaX = currentIntersection.x - dragStartIntersection.x;
        var translateDeltaY = currentIntersection.y - dragStartIntersection.y;

        var track = findTrack(dragTrackId);
        track.xPos = dragStartTrackState.xPos + translateDeltaX * 2.0;
        track.yPos = dragStartTrackState.yPos + translateDeltaY * 2.0;

        syncTrackSidebarInputs(track);
        schedulePush();
      }
      return;
    }

    if (dragMode === 'resize') {
      var currentIntersection = getLocalIntersection(pvRaycaster, getZPlane(dragStartTrackState));
      if (currentIntersection && dragStartIntersection) {
        var origMesh = null;
        for (var idx = 0; idx < gState.tracks.length; idx++) {
          if (gState.tracks[idx].id === dragTrackId) {
            origMesh = pvMeshes[idx];
            break;
          }
        }
        if (!origMesh) return;

        var origBounds = getTrackLocalBounds(origMesh, dragStartTrackState);
        var origW = Math.abs(origBounds.maxX - origBounds.minX);
        var origH = Math.abs(origBounds.maxY - origBounds.minY);

        // Compute initial corners in local space
        var sx = dragStartTrackState.xPos * 0.5;
        var sy = dragStartTrackState.yPos * 0.5;
        var x_TL = sx + origBounds.minX;
        var y_TL = sy + origBounds.maxY;
        var x_TR = sx + origBounds.maxX;
        var y_TR = sy + origBounds.maxY;
        var x_BL = sx + origBounds.minX;
        var y_BL = sy + origBounds.minY;
        var x_BR = sx + origBounds.maxX;
        var y_BR = sy + origBounds.minY;

        // Ax/Ay = anchor corner (stays fixed), opposite of the dragged handle
        var Ax = 0, Ay = 0;

        if (dragHandleName === 'TL') {
          Ax = x_BR; Ay = y_BR;
        } else if (dragHandleName === 'TR') {
          Ax = x_BL; Ay = y_BL;
        } else if (dragHandleName === 'BL') {
          Ax = x_TR; Ay = y_TR;
        } else if (dragHandleName === 'BR') {
          Ax = x_TL; Ay = y_TL;
        }

        var Cx = currentIntersection.x;
        var Cy = currentIntersection.y;

        var newW = Math.abs(Cx - Ax);
        var newH = Math.abs(Cy - Ay);

        var keepAspect = (dragStartTrackState.type === 'text') || e.ctrlKey || e.metaKey;
        var signX = Cx > Ax ? 1 : -1;
        var signY = Cy > Ay ? 1 : -1;

        if (keepAspect) {
          var diagX = signX * origW;
          var diagY = signY * origH;
          var dot = (Cx - Ax) * diagX + (Cy - Ay) * diagY;
          var diagLenSq = diagX * diagX + diagY * diagY;
          var tDiag = Math.max(0.01, dot / diagLenSq);
          newW = tDiag * origW;
          newH = tDiag * origH;
        }

        var newDx = Ax + signX * newW;
        var newDy = Ay + signY * newH;

        var newCenterX = (Ax + newDx) / 2;
        var newCenterY = (Ay + newDy) / 2;

        var track = findTrack(dragTrackId);
        var scaleX = newW / origW;

        if (track.type === 'text') {
          track.size = dragStartTrackState.size * scaleX;
          track.sizeX = track.size;
          track.sizeY = track.size;
        } else {
          var aspect = origMesh.userData.aspect || 1;
          track.sizeX = newW / aspect;
          track.sizeY = newH;
          track.size = track.sizeY;
        }

        track.xPos = newCenterX * 2;
        track.yPos = newCenterY * 2;

        syncTrackSidebarInputs(track);
        schedulePush();
      }
    }
  });

  var stopDrag = function (e) {
    if (!dragMode) return;
    canvas.releasePointerCapture(e.pointerId);
    dragMode = null;
    dragTrackId = null;
    dragHandleName = null;
    dragStartIntersection = null;
    dragStartTrackState = null;
    canvas.style.cursor = 'grab';
  };

  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  window.addEventListener('resize', resizePreview);
  resizePreview();
  pvAnimLoop();
  updatePreview();
}

function resizePreview() {
  if (!pvRenderer || !pvCamera) return;
  var canvas = $id('previewCanvas');
  var container = canvas.parentElement;
  if (!container) return;

  var aspectParts = ['16', '9'];
  if (gState && gState.aspectRatio) {
    var parts = gState.aspectRatio.split('x');
    if (parts.length === 2) aspectParts = parts;
  }
  var targetRatio = parseFloat(aspectParts[0]) / parseFloat(aspectParts[1]);
  var padding = 24;
  var maxW = container.clientWidth - padding;
  var maxH = container.clientHeight - padding;
  if (maxW <= 0 || maxH <= 0) {
    maxW = container.clientWidth;
    maxH = container.clientHeight;
  }

  var containerRatio = maxW / maxH;
  var W, H;
  if (containerRatio > targetRatio) {
    H = maxH;
    W = H * targetRatio;
  } else {
    W = maxW;
    H = W / targetRatio;
  }

  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  pvCamera.aspect = W / H;
  pvCamera.updateProjectionMatrix();
  pvRenderer.setSize(W, H, false);
}

function pvAnimLoop() {
  requestAnimationFrame(pvAnimLoop);
  if (!pvRenderer) return;
  pvRenderer.render(pvScene, pvCamera);
}

function updatePreview() {
  if (!pvScene || !gState) return;

  if (pvSelectionHelper) {
    if (pvGroup) pvGroup.remove(pvSelectionHelper);
    pvSelectionHelper = null;
  }

  gState.tracks.forEach(function (t, i) {
    if (pvMeshes[i]) { if (pvGroup) pvGroup.remove(pvMeshes[i]); pvMeshes[i] = null; }
    if (!t.enabled) return;

    if (t.type === 'image') {
      if (!t.image) return;
      var loader = new THREE.TextureLoader();
      loader.load(t.image, function (texture) {
        var currentTrack = findTrack(t.id);
        if (!currentTrack || !currentTrack.enabled || currentTrack.image !== t.image) return;

        var img = texture.image;
        var aspect = img ? (img.width / img.height) : 1;
        var w = (t.sizeX !== undefined ? t.sizeX : t.size) * aspect;
        var h = (t.sizeY !== undefined ? t.sizeY : t.size);
        var geo = new THREE.PlaneGeometry(w, h);

        var mat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 1,
          side: THREE.DoubleSide
        });

        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.x = (t.xPos !== undefined ? t.xPos : 0.0) * 0.5;
        mesh.position.y = t.yPos * 0.5;
        mesh.position.z = (t.zPos !== undefined ? t.zPos : 0.0) * 0.5;
        mesh.userData = { trackId: t.id, aspect: aspect };

        if (pvMeshes[i]) { if (pvGroup) pvGroup.remove(pvMeshes[i]); }
        if (pvGroup) pvGroup.add(mesh);
        pvMeshes[i] = mesh;

        if (gSelectedTrackId === t.id) {
          drawSelectionHelper(mesh, t);
        }
      }, undefined, function (err) {
        console.error('Failed to load preview texture:', t.image, err);
      });
      return;
    }

    var col = parseInt(t.color.replace('#', ''), 16);
    var addMesh = function (geo) {
      if (!geo) return;
      var mat = new THREE.MeshPhongMaterial({ color: col, transparent: true, opacity: 1 });
      var mainMesh = new THREE.Mesh(geo, mat);

      var meshToAdd;
      if (t.shadowEnabled) {
        var trackGroup = new THREE.Group();
        trackGroup.add(mainMesh);

        var shadowColorVal = parseInt((t.shadowColor || '#000000').replace('#', ''), 16);
        var shadowBlur = t.shadowBlur !== undefined ? t.shadowBlur : 0.0;
        var shadowDepth = t.shadowDepth !== undefined ? t.shadowDepth : 0.2;

        var sx = shadowDepth * 0.1;
        var sy = -shadowDepth * 0.1;
        var sz = -0.02;

        if (shadowBlur <= 0) {
          var shadowMat = new THREE.MeshBasicMaterial({ color: shadowColorVal, transparent: true, opacity: 0.8 });
          var shadowMesh = new THREE.Mesh(geo, shadowMat);
          shadowMesh.position.set(sx, sy, sz);
          shadowMesh.userData = { isShadow: true, baseOpacity: 0.8 };
          trackGroup.add(shadowMesh);
        } else {
          var offsets = [
            { x: sx, y: sy, baseOpacity: 0.3 },
            { x: sx - shadowBlur * 0.02, y: sy + shadowBlur * 0.02, baseOpacity: 0.125 },
            { x: sx + shadowBlur * 0.02, y: sy + shadowBlur * 0.02, baseOpacity: 0.125 },
            { x: sx - shadowBlur * 0.02, y: sy - shadowBlur * 0.02, baseOpacity: 0.125 },
            { x: sx + shadowBlur * 0.02, y: sy - shadowBlur * 0.02, baseOpacity: 0.125 }
          ];
          offsets.forEach(function (offset) {
            var shadowMat = new THREE.MeshBasicMaterial({ color: shadowColorVal, transparent: true, opacity: offset.baseOpacity });
            var shadowMesh = new THREE.Mesh(geo, shadowMat);
            shadowMesh.position.set(offset.x, offset.y, sz);
            shadowMesh.userData = { isShadow: true, baseOpacity: offset.baseOpacity };
            trackGroup.add(shadowMesh);
          });
        }
        meshToAdd = trackGroup;
      } else {
        meshToAdd = mainMesh;
      }

      meshToAdd.position.x = (t.xPos !== undefined ? t.xPos : 0.0) * 0.5;
      meshToAdd.position.y = t.yPos * 0.5;
      meshToAdd.position.z = (t.zPos !== undefined ? t.zPos : 0.0) * 0.5;
      meshToAdd.userData = { trackId: t.id };

      if (pvGroup) pvGroup.add(meshToAdd);
      pvMeshes[i] = meshToAdd;

      if (gSelectedTrackId === t.id) {
        drawSelectionHelper(meshToAdd, t);
      }
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

/* ── Resizers and Templates panel logic ─────────────────────────────────────── */
function initResizers() {
  var resizer1 = $id('resizer1');
  var resizer2 = $id('resizer2');
  var templatesPanel = $id('templatesPanel');
  var previewPanel = document.querySelector('.preview-panel');
  var main = document.querySelector('.main');

  var savedW1 = localStorage.getItem('templatesPanelWidth');
  var savedW2 = localStorage.getItem('previewPanelWidth');

  if (savedW1) {
    templatesPanel.style.width = savedW1 + 'px';
  } else {
    templatesPanel.style.width = '240px';
  }

  if (savedW2) {
    previewPanel.style.width = savedW2 + 'px';
  } else {
    previewPanel.style.width = '50%';
  }

  // Resizer 1
  resizer1.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    resizer1.classList.add('dragging');
    var startX = e.clientX;
    var startWidth = templatesPanel.offsetWidth;

    function onPointerMove(moveEvent) {
      var deltaX = moveEvent.clientX - startX;
      var newWidth = Math.max(180, Math.min(450, startWidth + deltaX));
      templatesPanel.style.width = newWidth + 'px';
      localStorage.setItem('templatesPanelWidth', newWidth);
    }

    function onPointerUp() {
      resizer1.classList.remove('dragging');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });

  // Resizer 2
  resizer2.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    resizer2.classList.add('dragging');
    var startX = e.clientX;
    var startWidth = previewPanel.offsetWidth;

    function onPointerMove(moveEvent) {
      var deltaX = startX - moveEvent.clientX;
      var maxW = main.clientWidth - templatesPanel.offsetWidth - 200;
      var newWidth = Math.max(300, Math.min(maxW, startWidth + deltaX));
      previewPanel.style.width = newWidth + 'px';
      localStorage.setItem('previewPanelWidth', newWidth);
      resizePreview();
    }

    function onPointerUp() {
      resizer2.classList.remove('dragging');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });
}

function refreshTemplates() {
  fetch('/api/saves')
    .then(function (r) { return r.json(); })
    .then(function (saves) {
      var list = $id('templatesList');
      if (!list) return;
      list.innerHTML = '';
      if (!saves.length) {
        list.innerHTML = '<li style="color:var(--muted);cursor:default;padding:12px;font-size:12px;">No saved templates</li>';
      } else {
        saves.forEach(function (name) {
          var li = document.createElement('li');
          li.className = 'templates-item';
          if (gFile === name) {
            li.classList.add('active');
          }

          var nameSpan = document.createElement('span');
          nameSpan.className = 'templates-item-name';
          nameSpan.textContent = '🎬 ' + name;
          li.appendChild(nameSpan);

          var deleteBtn = document.createElement('button');
          deleteBtn.className = 'templates-item-delete';
          deleteBtn.innerHTML = '🗑️';
          deleteBtn.title = 'Delete Template';
          deleteBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (confirm("Delete template '" + name + "'?")) {
              deleteTemplate(name);
            }
          });
          li.appendChild(deleteBtn);

          li.addEventListener('click', function () {
            loadScene(name);
          });

          list.appendChild(li);
        });
      }
      var searchInput = $id('templatesSearch');
      if (searchInput && searchInput.value) {
        filterTemplates(searchInput.value);
      }
    });
}

function deleteTemplate(name) {
  fetch('/api/saves/' + encodeURIComponent(name), {
    method: 'DELETE'
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.ok) {
        if (gFile === name) {
          setFilename(null);
        }
        refreshTemplates();
      } else {
        alert('Delete failed');
      }
    })
    .catch(function (err) {
      alert('Error deleting template: ' + err.message);
    });
}

function filterTemplates(query) {
  var q = query.toLowerCase();
  var items = document.querySelectorAll('.templates-item');
  items.forEach(function (item) {
    var nameSpan = item.querySelector('.templates-item-name');
    var name = nameSpan ? nameSpan.textContent.toLowerCase() : '';
    if (name.includes(q)) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
}

/* ── Clipboard paste handler ─────────────────────────────────────────────── */
window.addEventListener('paste', function (e) {
  var items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      var file = items[i].getAsFile();
      if (file) {
        uploadPastedImage(file);
      }
      break;
    }
  }
});

function uploadPastedImage(file) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var base64Data = e.target.result;
    var name = 'pasted_' + Date.now() + '.png';

    var tLabel = $id('tLabel-4');
    if (tLabel) {
      tLabel.textContent = 'Uploading pasted image...';
    }

    fetch('/api/image/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        data: base64Data
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          var track = findTrack(4);
          if (track) {
            track.image = '/images/' + name;
            track.enabled = true;
            renderTracks();
            selectTrack(4);
            schedulePush();
          }
        } else {
          alert('Upload failed: ' + (res.error || 'unknown error'));
          renderTracks();
        }
      })
      .catch(function (err) {
        alert('Upload error: ' + err.message);
        renderTracks();
      });
  };
  reader.readAsDataURL(file);
}

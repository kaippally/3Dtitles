/* ── State ─────────────────────────────────────────────────────────────────── */
var gState = null;
var gFile = null;
var gDirty = false;
var gFonts = [];
var gPushTimer = null;
var gSpinPaused = false;
var gUndoStack = [];
var gRedoStack = [];
var MAX_HISTORY = 10;

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
  updatePreview();
}

function saveUndoState() {
  if (!gState) return;
  var stateClone = JSON.parse(JSON.stringify(gState));
  
  if (gUndoStack.length > 0) {
    if (JSON.stringify(gUndoStack[gUndoStack.length - 1]) === JSON.stringify(stateClone)) {
      return;
    }
  }
  
  gUndoStack.push(stateClone);
  if (gUndoStack.length > MAX_HISTORY) {
    gUndoStack.shift();
  }
  gRedoStack = [];
}

function undo() {
  if (gUndoStack.length === 0) return;
  
  if (gPushTimer !== null) {
    clearTimeout(gPushTimer);
    pushState();
  }
  
  var currentState = JSON.parse(JSON.stringify(gState));
  var previousState = gUndoStack.pop();
  
  gRedoStack.push(currentState);
  if (gRedoStack.length > MAX_HISTORY) {
    gRedoStack.shift();
  }
  
  gState = previousState;
  restoreStateToUI();
}

function redo() {
  if (gRedoStack.length === 0) return;
  
  var currentState = JSON.parse(JSON.stringify(gState));
  var nextState = gRedoStack.pop();
  
  gUndoStack.push(currentState);
  if (gUndoStack.length > MAX_HISTORY) {
    gUndoStack.shift();
  }
  
  gState = nextState;
  restoreStateToUI();
}

function restoreStateToUI() {
  renderTracks();
  updateGlobalUI();
  updatePreview();
  if (gSelectedTrackId !== null) {
    if (!gState.tracks.some(function (t) { return t.id === gSelectedTrackId; })) {
      gSelectedTrackId = null;
    }
  }
  pushState();
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

  var chkShowGrid = $id('chkShowGrid');
  var selGridSize = $id('selGridSize');
  if (chkShowGrid && selGridSize) {
    var savedShowGrid = localStorage.getItem('showPreviewGrid');
    var savedGridSize = localStorage.getItem('previewGridSize');
    
    if (savedShowGrid !== null) {
      chkShowGrid.checked = (savedShowGrid === 'true');
      selGridSize.style.display = chkShowGrid.checked ? 'inline-block' : 'none';
    }
    if (savedGridSize !== null) {
      selGridSize.value = savedGridSize;
    }
    
    chkShowGrid.addEventListener('change', function () {
      localStorage.setItem('showPreviewGrid', this.checked);
      selGridSize.style.display = this.checked ? 'inline-block' : 'none';
      updatePreview();
    });
    
    selGridSize.addEventListener('change', function () {
      localStorage.setItem('previewGridSize', this.value);
      updatePreview();
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
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
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
      // 2D Preview does not have camera rotation to reset.
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

  // Tracks are now sortable by dragging; do not enforce id sorting

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
      gUndoStack = [];
      gRedoStack = [];
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
            gUndoStack = [];
            gRedoStack = [];
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
  gState.tracks.forEach(function (t) { panel.appendChild(buildTrack(t)); });
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

  var isExpanded = localStorage.getItem('track-expanded-' + t.id) !== 'false';
  var displayStyle = isExpanded ? '' : 'display: none;';

  // Drag-and-drop sort events
  wrap.draggable = false;
  wrap.addEventListener('dragstart', function (e) {
    e.dataTransfer.setData('text/plain', t.id);
    wrap.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  wrap.addEventListener('dragend', function (e) {
    wrap.draggable = false;
    wrap.classList.remove('dragging');
    document.querySelectorAll('.track').forEach(function (el) {
      el.classList.remove('drag-over-top');
      el.classList.remove('drag-over-bottom');
    });
  });

  wrap.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var rect = wrap.getBoundingClientRect();
    var relativeY = e.clientY - rect.top;
    var isTop = relativeY < rect.height / 2;
    if (isTop) {
      wrap.classList.add('drag-over-top');
      wrap.classList.remove('drag-over-bottom');
    } else {
      wrap.classList.add('drag-over-bottom');
      wrap.classList.remove('drag-over-top');
    }
  });

  wrap.addEventListener('dragleave', function (e) {
    wrap.classList.remove('drag-over-top');
    wrap.classList.remove('drag-over-bottom');
  });

  wrap.addEventListener('drop', function (e) {
    e.preventDefault();
    wrap.classList.remove('drag-over-top');
    wrap.classList.remove('drag-over-bottom');
    
    var draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(draggedId) || draggedId === t.id) return;
    
    var rect = wrap.getBoundingClientRect();
    var relativeY = e.clientY - rect.top;
    var isTop = relativeY < rect.height / 2;
    
    var fromIndex = gState.tracks.findIndex(function (tr) { return tr.id === draggedId; });
    var toIndex = gState.tracks.findIndex(function (tr) { return tr.id === t.id; });
    
    if (fromIndex >= 0 && toIndex >= 0) {
      var removed = gState.tracks.splice(fromIndex, 1)[0];
      var tracksCopy = gState.tracks.filter(function (tr) { return tr.id !== draggedId; });
      var targetIdxInCopy = tracksCopy.findIndex(function (tr) { return tr.id === t.id; });
      if (isTop) {
        tracksCopy.splice(targetIdxInCopy, 0, removed);
      } else {
        tracksCopy.splice(targetIdxInCopy + 1, 0, removed);
      }
      gState.tracks = tracksCopy;
      
      renderTracks();
      updatePreview();
      schedulePush();
    }
  });

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
      '<span class="drag-handle" style="margin-left: 4px; font-size: 16px; user-select: none; color: var(--muted);" title="Drag to reorder">☰</span>' +
      '</div>' +
      '<div class="track-body" id="tbody-' + t.id + '" style="' + displayStyle + '">' +
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
      if (e.target === tog || e.target.classList.contains('drag-handle')) return;
      var isCollapsed = body.style.display === 'none';
      if (isCollapsed) {
        body.style.display = '';
        localStorage.setItem('track-expanded-' + t.id, 'true');
      } else {
        body.style.display = 'none';
        localStorage.setItem('track-expanded-' + t.id, 'false');
      }
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

    var dragHandle = wrap.querySelector('.drag-handle');
    if (dragHandle) {
      dragHandle.addEventListener('mouseenter', function () {
        wrap.draggable = true;
      });
      dragHandle.addEventListener('mouseleave', function () {
        if (!wrap.classList.contains('dragging')) {
          wrap.draggable = false;
        }
      });
      dragHandle.addEventListener('mousedown', function () {
        wrap.draggable = true;
      });
      dragHandle.addEventListener('mouseup', function () {
        if (!wrap.classList.contains('dragging')) {
          wrap.draggable = false;
        }
      });
    }

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
    '<span class="drag-handle" style="margin-left: 4px; font-size: 16px; user-select: none; color: var(--muted);" title="Drag to reorder">☰</span>' +
    '</div>' +
    '<div class="track-body" id="tbody-' + t.id + '" style="' + displayStyle + '">' +
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
    if (e.target === tog || e.target.classList.contains('drag-handle')) return;
    var isCollapsed = body.style.display === 'none';
    if (isCollapsed) {
      body.style.display = '';
      localStorage.setItem('track-expanded-' + t.id, 'true');
    } else {
      body.style.display = 'none';
      localStorage.setItem('track-expanded-' + t.id, 'false');
    }
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

  var dragHandle = wrap.querySelector('.drag-handle');
  if (dragHandle) {
    dragHandle.addEventListener('mouseenter', function () {
      wrap.draggable = true;
    });
    dragHandle.addEventListener('mouseleave', function () {
      if (!wrap.classList.contains('dragging')) {
        wrap.draggable = false;
      }
    });
    dragHandle.addEventListener('mousedown', function () {
      wrap.draggable = true;
    });
    dragHandle.addEventListener('mouseup', function () {
      if (!wrap.classList.contains('dragging')) {
        wrap.draggable = false;
      }
    });
  }

  return wrap;
}

/* ── Push state to server (debounced 400 ms) ───────────────────────────────── */
function schedulePush() {
  markDirty();
  if (gPushTimer === null) {
    saveUndoState();
  }
  clearTimeout(gPushTimer);
  gPushTimer = setTimeout(pushState, 400);
}

function pushState() {
  gPushTimer = null;
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
      gUndoStack = [];
      gRedoStack = [];
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
var pvCanvas = null;
var pvCtx = null;

var gLoaded2DFonts = {};
var gImageCache = {};
var gImageAspectCache = {};

function get2DFontFamily(fontId) {
  if (fontId === 'helvetiker') return 'sans-serif';
  if (gLoaded2DFonts[fontId]) return gLoaded2DFonts[fontId];
  
  var fObj = gFonts.find(function (f) { return f.id === fontId; });
  if (fObj && fObj.rawUrl) {
    var rawUrl = fObj.rawUrl;
    gLoaded2DFonts[fontId] = 'loading';
    var fontFace = new FontFace(fontId, 'url(' + rawUrl + ')');
    fontFace.load().then(function (loadedFace) {
      document.fonts.add(loadedFace);
      gLoaded2DFonts[fontId] = fontId;
      console.log('2D Font loaded:', fontId);
      updatePreview();
    }).catch(function (err) {
      console.error('Failed loading 2D font:', fontId, err);
      gLoaded2DFonts[fontId] = 'sans-serif';
      updatePreview();
    });
  } else {
    gLoaded2DFonts[fontId] = 'sans-serif';
  }
  return 'sans-serif';
}

function getImage(src) {
  if (!src) return null;
  if (gImageCache[src]) return gImageCache[src];
  
  var img = new Image();
  img.onload = function () {
    gImageCache[src] = img;
    gImageAspectCache[src] = img.width / img.height;
    console.log('Image loaded for 2D preview:', src, 'aspect:', gImageAspectCache[src]);
    updatePreview();
  };
  img.onerror = function () {
    console.error('Failed to load image for 2D preview:', src);
  };
  img.src = src;
  return null;
}

function getTrackBounds(t, ctx) {
  var scale = 130.37;
  var cx = 960 + (t.xPos !== undefined ? t.xPos : 0.0) * 0.5 * scale;
  var cy = 540 - (t.yPos !== undefined ? t.yPos : 0.0) * 0.5 * scale;
  
  var minX = 0, maxX = 0, minY = 0, maxY = 0;
  
  if (t.type === 'image') {
    var aspect = 1.0;
    if (t.image && gImageAspectCache[t.image]) {
      aspect = gImageAspectCache[t.image];
    }
    var w_unit = (t.sizeX !== undefined ? t.sizeX : t.size) * aspect;
    var h_unit = (t.sizeY !== undefined ? t.sizeY : t.size);
    var w_px = w_unit * scale;
    var h_px = h_unit * scale;
    
    minX = -w_px / 2;
    maxX = w_px / 2;
    minY = -h_px / 2;
    maxY = h_px / 2;
  } else {
    var fontSize = t.size * 0.65 * scale;
    var fontFamily = get2DFontFamily(t.font);
    ctx.save();
    ctx.font = fontSize + 'px ' + fontFamily;
    var text = getRenderingText(t);
    var metrics = ctx.measureText(text);
    var w_px = metrics.width;
    var h_px = fontSize;
    ctx.restore();
    
    var align = t.align || 'center';
    if (align === 'left') {
      minX = 0;
      maxX = w_px;
    } else if (align === 'right') {
      minX = -w_px;
      maxX = 0;
    } else {
      minX = -w_px / 2;
      maxX = w_px / 2;
    }
    minY = -h_px / 2;
    maxY = h_px / 2;
  }
  
  return {
    cx: cx,
    cy: cy,
    minX: minX,
    maxX: maxX,
    minY: minY,
    maxY: maxY,
    gMinX: cx + minX,
    gMaxX: cx + maxX,
    gMinY: cy + minY,
    gMaxY: cy + maxY
  };
}

function getClickedHandle(clickX, clickY, bounds) {
  var HANDLE_SIZE = 12;
  if (Math.abs(clickX - bounds.gMinX) <= HANDLE_SIZE && Math.abs(clickY - bounds.gMinY) <= HANDLE_SIZE) return 'TL';
  if (Math.abs(clickX - bounds.gMaxX) <= HANDLE_SIZE && Math.abs(clickY - bounds.gMinY) <= HANDLE_SIZE) return 'TR';
  if (Math.abs(clickX - bounds.gMinX) <= HANDLE_SIZE && Math.abs(clickY - bounds.gMaxY) <= HANDLE_SIZE) return 'BL';
  if (Math.abs(clickX - bounds.gMaxX) <= HANDLE_SIZE && Math.abs(clickY - bounds.gMaxY) <= HANDLE_SIZE) return 'BR';
  return null;
}

function isPointInBounds(clickX, clickY, bounds) {
  return clickX >= bounds.gMinX && clickX <= bounds.gMaxX &&
         clickY >= bounds.gMinY && clickY <= bounds.gMaxY;
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
  pvCanvas = $id('previewCanvas');
  if (!pvCanvas) return;
  
  pvCtx = pvCanvas.getContext('2d');
  pvCanvas.width = 1920;
  pvCanvas.height = 1080;
  
  var dragMode = null;
  var dragTrackId = null;
  var dragHandleName = null;
  var dragStartTrackState = null;
  var dragStartClickPos = null;
  
  pvCanvas.style.cursor = 'grab';
  
  pvCanvas.addEventListener('pointerdown', function (e) {
    var rect = pvCanvas.getBoundingClientRect();
    var clickX = ((e.clientX - rect.left) / rect.width) * 1920;
    var clickY = ((e.clientY - rect.top) / rect.height) * 1080;
    
    if (gSelectedTrackId !== null) {
      var track = findTrack(gSelectedTrackId);
      if (track && track.enabled) {
        var bounds = getTrackBounds(track, pvCtx);
        var handle = getClickedHandle(clickX, clickY, bounds);
        if (handle) {
          dragMode = 'resize';
          dragTrackId = gSelectedTrackId;
          dragHandleName = handle;
          dragStartTrackState = JSON.parse(JSON.stringify(track));
          dragStartClickPos = { x: clickX, y: clickY };
          
          pvCanvas.setPointerCapture(e.pointerId);
          pvCanvas.style.cursor = 'pointer';
          e.stopPropagation();
          return;
        }
      }
    }
    
    for (var idx = 0; idx < gState.tracks.length; idx++) {
      var track = gState.tracks[idx];
      if (track.enabled) {
        var bounds = getTrackBounds(track, pvCtx);
        if (isPointInBounds(clickX, clickY, bounds)) {
          dragMode = 'translate';
          dragTrackId = track.id;
          dragStartTrackState = JSON.parse(JSON.stringify(track));
          dragStartClickPos = { x: clickX, y: clickY };
          
          selectTrack(track.id);
          
          pvCanvas.setPointerCapture(e.pointerId);
          pvCanvas.style.cursor = 'move';
          e.stopPropagation();
          return;
        }
      }
    }
    
    selectTrack(null);
  });
  
  pvCanvas.addEventListener('pointermove', function (e) {
    var rect = pvCanvas.getBoundingClientRect();
    var clickX = ((e.clientX - rect.left) / rect.width) * 1920;
    var clickY = ((e.clientY - rect.top) / rect.height) * 1080;
    
    if (!dragMode) {
      if (gSelectedTrackId !== null) {
        var track = findTrack(gSelectedTrackId);
        if (track && track.enabled) {
          var bounds = getTrackBounds(track, pvCtx);
          var handle = getClickedHandle(clickX, clickY, bounds);
          if (handle) {
            pvCanvas.style.cursor = 'pointer';
            return;
          }
        }
      }
      for (var idx = 0; idx < gState.tracks.length; idx++) {
        var track = gState.tracks[idx];
        if (track.enabled) {
          var bounds = getTrackBounds(track, pvCtx);
          if (isPointInBounds(clickX, clickY, bounds)) {
            pvCanvas.style.cursor = 'move';
            return;
          }
        }
      }
      pvCanvas.style.cursor = 'grab';
      return;
    }
    
    var scale = 130.37;
    
    if (dragMode === 'translate') {
      var track = findTrack(dragTrackId);
      var dx = clickX - dragStartClickPos.x;
      var dy = clickY - dragStartClickPos.y;
      
      track.xPos = dragStartTrackState.xPos + dx * 2.0 / scale;
      track.yPos = dragStartTrackState.yPos - dy * 2.0 / scale;
      
      syncTrackSidebarInputs(track);
      schedulePush();
      updatePreview();
      return;
    }
    
    if (dragMode === 'resize') {
      var track = findTrack(dragTrackId);
      var bounds = getTrackBounds(dragStartTrackState, pvCtx);
      
      var origW = bounds.maxX - bounds.minX;
      var origH = bounds.maxY - bounds.minY;
      
      var x_TL = bounds.gMinX, y_TL = bounds.gMinY;
      var x_TR = bounds.gMaxX, y_TR = bounds.gMinY;
      var x_BL = bounds.gMinX, y_BL = bounds.gMaxY;
      var x_BR = bounds.gMaxX, y_BR = bounds.gMaxY;
      
      var Ax = 0, Ay = 0;
      var Hx = 0, Hy = 0;
      
      if (dragHandleName === 'TL') {
        Ax = x_BR; Ay = y_BR;
        Hx = x_TL; Hy = y_TL;
      } else if (dragHandleName === 'TR') {
        Ax = x_BL; Ay = y_BL;
        Hx = x_TR; Hy = y_TR;
      } else if (dragHandleName === 'BL') {
        Ax = x_TR; Ay = y_TR;
        Hx = x_BL; Hy = y_BL;
      } else if (dragHandleName === 'BR') {
        Ax = x_TL; Ay = y_TL;
        Hx = x_BR; Hy = y_BR;
      }
      
      var Cx = clickX;
      var Cy = clickY;
      
      var newW = Math.abs(Cx - Ax);
      var newH = Math.abs(Cy - Ay);
      
      var keepAspect = (dragStartTrackState.type === 'text') || e.ctrlKey || e.metaKey;
      
      var newHx = Cx;
      var newHy = Cy;
      
      if (keepAspect) {
        var diagX = Hx - Ax;
        var diagY = Hy - Ay;
        var vX = Cx - Ax;
        var vY = Cy - Ay;
        var dot = vX * diagX + vY * diagY;
        var diagLenSq = diagX * diagX + diagY * diagY;
        var tDiag = Math.max(0.01, dot / diagLenSq);
        
        newW = tDiag * origW;
        newH = tDiag * origH;
        
        newHx = Ax + tDiag * diagX;
        newHy = Ay + tDiag * diagY;
      }
      
      var newCenterX = (Ax + newHx) / 2;
      var newCenterY = (Ay + newHy) / 2;
      
      var scaleX = newW / origW;
      
      if (track.type === 'text') {
        track.size = dragStartTrackState.size * scaleX;
        track.sizeX = track.size;
        track.sizeY = track.size;
      } else {
        var aspect = 1.0;
        if (track.image && gImageAspectCache[track.image]) aspect = gImageAspectCache[track.image];
        track.sizeX = newW / (scale * aspect);
        track.sizeY = newH / scale;
        track.size = track.sizeY;
      }
      
      track.xPos = (newCenterX - 960) / (0.5 * scale);
      track.yPos = (540 - newCenterY) / (0.5 * scale);
      
      syncTrackSidebarInputs(track);
      schedulePush();
      updatePreview();
    }
  });
  
  var stopDrag = function (e) {
    if (!dragMode) return;
    pvCanvas.releasePointerCapture(e.pointerId);
    dragMode = null;
    dragTrackId = null;
    dragHandleName = null;
    dragStartTrackState = null;
    dragStartClickPos = null;
    pvCanvas.style.cursor = 'grab';
  };
  
  pvCanvas.addEventListener('pointerup', stopDrag);
  pvCanvas.addEventListener('pointercancel', stopDrag);
  
  pvCanvas.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (!pvCanvas.classList.contains('drag-over')) {
      pvCanvas.classList.add('drag-over');
      updatePreview();
    }
  });
  
  pvCanvas.addEventListener('dragleave', function (e) {
    pvCanvas.classList.remove('drag-over');
    updatePreview();
  });
  
  pvCanvas.addEventListener('drop', function (e) {
    e.preventDefault();
    pvCanvas.classList.remove('drag-over');
    
    var files = e.dataTransfer.files;
    if (files && files.length > 0) {
      var file = files[0];
      if (file.type.match('image.*')) {
        uploadPastedImage(file);
      }
    } else {
      updatePreview();
    }
  });
  
  window.addEventListener('resize', resizePreview);
  resizePreview();
  updatePreview();
}

function resizePreview() {
  if (!pvCanvas) return;
  var container = pvCanvas.parentElement;
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
  
  pvCanvas.style.width = W + 'px';
  pvCanvas.style.height = H + 'px';
}

function updatePreview() {
  if (!pvCtx || !gState) return;
  
  pvCtx.fillStyle = '#111';
  pvCtx.fillRect(0, 0, 1920, 1080);

  // Draw grid if checked
  var chkShowGrid = $id('chkShowGrid');
  if (chkShowGrid && chkShowGrid.checked) {
    var selGridSize = $id('selGridSize');
    var gridSize = parseInt(selGridSize ? selGridSize.value : '50', 10);
    
    pvCtx.save();
    pvCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    pvCtx.lineWidth = 1;
    
    // Vertical lines from center (960) outward
    for (var x = 960; x < 1920; x += gridSize) {
      pvCtx.beginPath();
      pvCtx.moveTo(x, 0);
      pvCtx.lineTo(x, 1080);
      pvCtx.stroke();
    }
    for (var x = 960 - gridSize; x >= 0; x -= gridSize) {
      pvCtx.beginPath();
      pvCtx.moveTo(x, 0);
      pvCtx.lineTo(x, 1080);
      pvCtx.stroke();
    }
    
    // Horizontal lines from center (540) outward
    for (var y = 540; y < 1080; y += gridSize) {
      pvCtx.beginPath();
      pvCtx.moveTo(0, y);
      pvCtx.lineTo(1920, y);
      pvCtx.stroke();
    }
    for (var y = 540 - gridSize; y >= 0; y -= gridSize) {
      pvCtx.beginPath();
      pvCtx.moveTo(0, y);
      pvCtx.lineTo(1920, y);
      pvCtx.stroke();
    }
    
    // Draw central axes slightly more prominent
    pvCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    pvCtx.lineWidth = 1.5;
    
    pvCtx.beginPath();
    pvCtx.moveTo(960, 0);
    pvCtx.lineTo(960, 1080);
    pvCtx.stroke();
    
    pvCtx.beginPath();
    pvCtx.moveTo(0, 540);
    pvCtx.lineTo(1920, 540);
    pvCtx.stroke();
    
    pvCtx.restore();
  }
  
  var scale = 130.37;
  
  gState.tracks.slice().reverse().forEach(function (t) {
    if (!t.enabled) return;
    
    if (t.type === 'image') {
      if (!t.image) return;
      var img = getImage(t.image);
      if (!img) return;
      
      var aspect = img.width / img.height;
      var w_unit = (t.sizeX !== undefined ? t.sizeX : t.size) * aspect;
      var h_unit = (t.sizeY !== undefined ? t.sizeY : t.size);
      var w_px = w_unit * scale;
      var h_px = h_unit * scale;
      
      var cx = 960 + (t.xPos !== undefined ? t.xPos : 0.0) * 0.5 * scale;
      var cy = 540 - (t.yPos !== undefined ? t.yPos : 0.0) * 0.5 * scale;
      
      pvCtx.drawImage(img, cx - w_px / 2, cy - h_px / 2, w_px, h_px);
      return;
    }
    
    var fontSize = t.size * 0.65 * scale;
    var fontFamily = get2DFontFamily(t.font);
    
    pvCtx.font = fontSize + 'px ' + fontFamily;
    pvCtx.textBaseline = 'middle';
    
    var align = t.align || 'center';
    if (align === 'left') {
      pvCtx.textAlign = 'left';
    } else if (align === 'right') {
      pvCtx.textAlign = 'right';
    } else {
      pvCtx.textAlign = 'center';
    }
    
    var text = getRenderingText(t);
    var cx = 960 + (t.xPos !== undefined ? t.xPos : 0.0) * 0.5 * scale;
    var cy = 540 - (t.yPos !== undefined ? t.yPos : 0.0) * 0.5 * scale;
    
    if (t.shadowEnabled) {
      pvCtx.save();
      var shadowColorVal = t.shadowColor || '#000000';
      var shadowBlurVal = t.shadowBlur !== undefined ? t.shadowBlur : 0.0;
      var shadowDepthVal = t.shadowDepth !== undefined ? t.shadowDepth : 0.2;
      
      pvCtx.shadowColor = shadowColorVal;
      pvCtx.shadowBlur = shadowBlurVal * 0.02 * scale;
      pvCtx.shadowOffsetX = shadowDepthVal * 0.1 * scale;
      pvCtx.shadowOffsetY = shadowDepthVal * 0.1 * scale;
      
      pvCtx.fillStyle = t.color;
      pvCtx.fillText(text, cx, cy);
      pvCtx.restore();
    } else {
      pvCtx.fillStyle = t.color;
      pvCtx.fillText(text, cx, cy);
    }
  });
  
  if (gSelectedTrackId !== null) {
    var selectedTrack = findTrack(gSelectedTrackId);
    if (selectedTrack && selectedTrack.enabled) {
      var bounds = getTrackBounds(selectedTrack, pvCtx);
      
      pvCtx.strokeStyle = '#00a2ff';
      pvCtx.lineWidth = 2;
      pvCtx.setLineDash([6, 4]);
      pvCtx.strokeRect(bounds.gMinX, bounds.gMinY, bounds.gMaxX - bounds.gMinX, bounds.gMaxY - bounds.gMinY);
      pvCtx.setLineDash([]);
      
      pvCtx.fillStyle = '#00a2ff';
      var HANDLE_SIZE = 12;
      var half = HANDLE_SIZE / 2;
      
      var corners = [
        { x: bounds.gMinX, y: bounds.gMinY },
        { x: bounds.gMaxX, y: bounds.gMinY },
        { x: bounds.gMinX, y: bounds.gMaxY },
        { x: bounds.gMaxX, y: bounds.gMaxY }
      ];
      
      corners.forEach(function (c) {
        pvCtx.fillRect(c.x - half, c.y - half, HANDLE_SIZE, HANDLE_SIZE);
      });
    }
  }
  
  if (pvCanvas && pvCanvas.classList.contains('drag-over')) {
    pvCtx.strokeStyle = '#58a6ff';
    pvCtx.lineWidth = 6;
    pvCtx.setLineDash([15, 10]);
    pvCtx.strokeRect(10, 10, 1920 - 20, 1080 - 20);
    pvCtx.setLineDash([]);
    
    pvCtx.fillStyle = 'rgba(88, 166, 255, 0.15)';
    pvCtx.fillRect(10, 10, 1920 - 20, 1080 - 20);
    
    pvCtx.fillStyle = '#58a6ff';
    pvCtx.font = 'bold 40px sans-serif';
    pvCtx.textAlign = 'center';
    pvCtx.textBaseline = 'middle';
    pvCtx.fillText('Drop image to replace and save', 960, 540);
  }
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

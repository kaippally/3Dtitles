/**
 * 3D Title OBS Display Overlay Client
 *
 * For Helvetiker (built-in):  uses THREE.FontLoader + TextGeometry (unchanged).
 * For custom fonts (e.g. Malayalam):
 *   POST /api/shape → server runs opentype.js stringToGlyphs() which applies
 *   the font's GSUB tables (conjuncts, ligatures, required forms), returns all
 *   glyph path commands pre-offset and normalised to 1 em = 1 unit (Y-up).
 *   Client builds THREE.ShapePath → toShapes() → ExtrudeGeometry, giving correct
 *   ligature rendering and correct orientation (no upside-down text).
 */
'use strict';

/* ── Three.js globals ─────────────────────────────────────────────────────── */
let socket = null;
let scene, camera, renderer;
let fontLoader;

let activeState = null;
let trackMeshes = {};

/* ── Animation state ──────────────────────────────────────────────────────── */
let animationStartTime = 0;
let isAnimating = false;
const ANIM_IN_DURATION = 1000;
const ANIM_OUT_DURATION = 500;

/* ── Easing functions ─────────────────────────────────────────────────────── */
function easeOutQuad(t) { return t * (2 - t); }
function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  else if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  else if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  else return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
function easeOutElastic(t) {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* ── Three.js init ────────────────────────────────────────────────────────── */
/* ── Audio globals ───────────────────────────────────────────────────────── */
let activeAudios = [];
let activeTimeouts = [];

function stopAllAudio() {
  activeAudios.forEach(audio => {
    try { audio.pause(); } catch (e) {}
  });
  activeAudios = [];
  activeTimeouts.forEach(t => clearTimeout(t));
  activeTimeouts = [];
}

/* ── Three.js init ────────────────────────────────────────────────────────── */
function initThree() {
  const canvas = document.getElementById('displayCanvas');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(5, 5, 5);
  scene.add(dl);
  fontLoader = new THREE.FontLoader();
  window.addEventListener('resize', resizeDisplay);
  resizeDisplay();
  animateLoop();
}
function resizeDisplay() {
  if (!renderer || !camera) return;
  const canvas = document.getElementById('displayCanvas');
  let aspectParts = ['16', '9'];
  if (activeState && activeState.aspectRatio) {
    const parts = activeState.aspectRatio.split('x');
    if (parts.length === 2) {
      aspectParts = parts;
    }
  }
  const targetRatio = parseFloat(aspectParts[0]) / parseFloat(aspectParts[1]);
  const screenRatio = window.innerWidth / window.innerHeight;
  let W, H;
  if (screenRatio > targetRatio) {
    H = window.innerHeight;
    W = H * targetRatio;
  } else {
    W = window.innerWidth;
    H = W / targetRatio;
  }
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H, false);
}

/* ── WebSocket ────────────────────────────────────────────────────────────── */
function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}`);
  socket.onopen = () => console.log('[Socket] Connected');
  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      switch (data.type) {
        case 'init':
        case 'state':
          activeState = data.state;
          rebuildScene();
          resizeDisplay();
          if (data.autoPlay) triggerAnimation();
          break;
        case 'trigger': triggerAnimation(); break;
        case 'reset': resetTimeline(); break;
      }
    } catch (e) { console.error('[Socket] parse error', e); }
  };
  socket.onclose = () => { console.warn('[Socket] lost — reconnecting'); setTimeout(connectSocket, 2000); };
}

/* ── Build mesh for one track ─────────────────────────────────────────────── */
function buildTrackMesh(track, cb) {
  const text = getRenderingText(track);
  loadFontShared(fontLoader, track.font, font => {
    if (!font) { cb(null); return; }
    try {
      const geo = new THREE.TextGeometry(text, getTextGeometryOptions(track, font));
      alignGeometry(geo, track.align || 'center');
      cb(geo);
    } catch (e) {
      console.error('[Display] TextGeometry error', e);
      cb(null);
    }
  });
}

/* ── Rebuild scene meshes ─────────────────────────────────────────────────── */
function rebuildScene() {
  if (!activeState || !activeState.tracks) return;
  Object.values(trackMeshes).forEach(m => m && scene.remove(m));
  trackMeshes = {};

  activeState.tracks.forEach(track => {
    if (!track.enabled) return;
    buildTrackMesh(track, geo => {
      if (!geo) return;
      // Guard: track may have been disabled while fetch was in flight
      const current = activeState.tracks.find(t => t.id === track.id);
      if (!current || !current.enabled) return;

      const colorVal = parseInt(track.color.replace('#', ''), 16);
      const mat = new THREE.MeshPhongMaterial({ color: colorVal, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.userData = {
        id: track.id,
        baseX: (track.xPos !== undefined ? track.xPos : 0.0) * 0.5,
        baseY: track.yPos * 0.5,
        baseZ: (track.zPos !== undefined ? track.zPos : 0.0) * 0.5,
        delay: track.delay || 0,
        duration: track.duration || 0,
        animation: track.animation || 'static',
      };
      scene.add(mesh);
      trackMeshes[track.id] = mesh;
    });
  });
}

/* ── Timeline controls ────────────────────────────────────────────────────── */
function triggerAnimation() {
  console.log('[Timeline] Triggering');
  stopAllAudio();
  animationStartTime = performance.now();
  isAnimating = true;

  if (!activeState || !activeState.tracks) return;

  activeState.tracks.forEach(track => {
    if (!track.enabled) return;

    // Track Audio In
    if (track.audioStart) {
      const delay = track.delay || 0;
      const tIn = setTimeout(() => {
        const audio = new Audio(track.audioStart);
        activeAudios.push(audio);
        audio.play().catch(e => console.warn(`Failed to play start audio for track ${track.id}:`, e));
      }, delay);
      activeTimeouts.push(tIn);
    }

    // Track Audio Out (played when the animation in ends and has fully appeared)
    if (track.audioEnd) {
      const delay = (track.delay || 0) + ANIM_IN_DURATION;
      const tOut = setTimeout(() => {
        const audio = new Audio(track.audioEnd);
        activeAudios.push(audio);
        audio.play().catch(e => console.warn(`Failed to play end audio for track ${track.id}:`, e));
      }, delay);
      activeTimeouts.push(tOut);
    }
  });
}
function resetTimeline() {
  console.log('[Timeline] Reset');
  isAnimating = false;
  stopAllAudio();
  Object.values(trackMeshes).forEach(mesh => {
    if (!mesh) return;
    mesh.visible = false;
    mesh.material.opacity = 0;
    mesh.rotation.set(0, 0, 0);
  });
}

/* ── Render loop ──────────────────────────────────────────────────────────── */
function animateLoop() {
  requestAnimationFrame(animateLoop);
  if (isAnimating && activeState) {
    const now = performance.now();
    Object.values(trackMeshes).forEach(mesh => {
      if (!mesh) return;
      const d = mesh.userData;
      const elapsed = now - (animationStartTime + d.delay);
      if (elapsed < 0) {
        mesh.visible = false; mesh.material.opacity = 0;
      } else {
        mesh.visible = true;
        if (elapsed < ANIM_IN_DURATION) {
          applyAnimationIn(mesh, d.animation, elapsed / ANIM_IN_DURATION, d.baseX, d.baseY, d.baseZ || 0);
        } else if (d.duration === 0 || elapsed < ANIM_IN_DURATION + d.duration) {
          applyAnimationHold(mesh, d.animation, elapsed - ANIM_IN_DURATION, d.baseX, d.baseY, d.baseZ || 0);
        } else if (elapsed < ANIM_IN_DURATION + d.duration + ANIM_OUT_DURATION) {
          const tOut = (elapsed - ANIM_IN_DURATION - d.duration) / ANIM_OUT_DURATION;
          applyAnimationHold(mesh, d.animation, d.duration + (elapsed - ANIM_IN_DURATION - d.duration), d.baseX, d.baseY, d.baseZ || 0);
          mesh.material.opacity = 1.0 - tOut;
        } else {
          mesh.visible = false; mesh.material.opacity = 0;
        }
      }
    });
  }
  renderer.render(scene, camera);
}

/* ── Animation applicators ────────────────────────────────────────────────── */
function applyAnimationIn(mesh, animId, t, baseX, baseY, baseZ) {
  mesh.scale.set(1, 1, 1); mesh.rotation.set(0, 0, 0);
  switch (animId) {
    case 'crashLandTop':
      mesh.position.set(baseX, baseY + 10 * (1 - easeOutBounce(t)), baseZ);
      mesh.material.opacity = Math.min(1.0, t * 5); break;
    case 'zipInRight':
      mesh.position.set(baseX + 15 * (1 - easeOutElastic(t)), baseY, baseZ);
      mesh.material.opacity = Math.min(1.0, t * 4); break;
    case 'zipInSpin':
      mesh.position.set(baseX + 15 * (1 - easeOutBack(t)), baseY, baseZ);
      mesh.rotation.y = (1 - t) * Math.PI * 2;
      mesh.material.opacity = Math.min(1.0, t * 4); break;
    case 'spinContinuous':
      mesh.position.set(baseX, baseY, baseZ);
      mesh.rotation.y = t * Math.PI * 2;
      mesh.material.opacity = t; break;
    case 'spinAndStop':
      mesh.position.set(baseX, baseY, baseZ);
      mesh.rotation.y = (1 - easeOutQuad(t)) * Math.PI * 4;
      mesh.material.opacity = t; break;
    case 'bounce':
      mesh.position.set(baseX, baseY + 3 * (1 - easeOutBounce(t)), baseZ);
      mesh.material.opacity = Math.min(1.0, t * 5); break;
    case 'fadeIn':
      mesh.position.set(baseX, baseY, baseZ);
      mesh.material.opacity = t; break;
    default:
      mesh.position.set(baseX, baseY, baseZ);
      mesh.material.opacity = 1.0; break;
  }
}
function applyAnimationHold(mesh, animId, elapsed, baseX, baseY, baseZ) {
  mesh.material.opacity = 1.0; mesh.scale.set(1, 1, 1);
  switch (animId) {
    case 'zipInSpin':
    case 'spinContinuous':
      mesh.position.set(baseX, baseY, baseZ);
      mesh.rotation.y = (elapsed / 1000) * 1.5; break;
    case 'bounce':
      mesh.position.set(baseX, baseY + Math.abs(Math.sin(elapsed * 0.005)) * 0.4, baseZ);
      mesh.rotation.set(0, 0, 0); break;
    default:
      mesh.position.set(baseX, baseY, baseZ);
      mesh.rotation.set(0, 0, 0); break;
  }
}

let audioUnlocked = false;

function checkAudioAutoplay() {
  const testAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
  testAudio.play().then(() => {
    audioUnlocked = true;
  }).catch(() => {
    const el = document.getElementById('audioUnlock');
    if (el) el.style.display = 'block';
  });

  const btn = document.getElementById('audioUnlock');
  if (btn) {
    btn.addEventListener('click', () => {
      const dummy = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      dummy.play().then(() => {
        audioUnlocked = true;
        btn.style.display = 'none';
      }).catch(e => console.warn('Failed to unlock audio:', e));
    });
  }
}

/* ── Entry point ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initThree();
  connectSocket();
  checkAudioAutoplay();
});


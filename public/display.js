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
let fontCache  = {};   // Helvetiker cache   { url → THREE.Font }
let shapeCache = {};   // shaped-path cache  { fontId|||text → shapeData }
let activeState = null;
let trackMeshes = {};

/* ── Animation state ──────────────────────────────────────────────────────── */
let animationStartTime = 0;
let isAnimating = false;
const ANIM_IN_DURATION  = 1000;
const ANIM_OUT_DURATION =  500;

/* ── Easing functions ─────────────────────────────────────────────────────── */
function easeOutQuad(t)    { return t * (2 - t); }
function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if      (t < 1/d1)       return n1*t*t;
  else if (t < 2/d1)       return n1*(t-=1.5/d1)*t + 0.75;
  else if (t < 2.5/d1)     return n1*(t-=2.25/d1)*t + 0.9375;
  else                      return n1*(t-=2.625/d1)*t + 0.984375;
}
function easeOutElastic(t) {
  const c4 = (2*Math.PI)/3;
  return t===0 ? 0 : t===1 ? 1 : Math.pow(2,-10*t)*Math.sin((t*10-0.75)*c4)+1;
}
function easeOutBack(t) {
  const c1=1.70158, c3=c1+1;
  return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2);
}

/* ── Three.js init ────────────────────────────────────────────────────────── */
function initThree() {
  const canvas = document.getElementById('displayCanvas');
  const W = window.innerWidth, H = window.innerHeight;
  scene    = new THREE.Scene();
  camera   = new THREE.PerspectiveCamera(45, W/H, 0.1, 1000);
  camera.position.set(0, 0, 10);
  renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(5, 5, 5);
  scene.add(dl);
  fontLoader = new THREE.FontLoader();
  window.addEventListener('resize', onWindowResize);
  animateLoop();
}
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ── WebSocket ────────────────────────────────────────────────────────────── */
function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}`);
  socket.onopen    = () => console.log('[Socket] Connected');
  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      switch (data.type) {
        case 'init':
        case 'state':
          activeState = data.state;
          rebuildScene();
          if (data.autoPlay) triggerAnimation();
          break;
        case 'trigger': triggerAnimation(); break;
        case 'reset':   resetTimeline();   break;
      }
    } catch (e) { console.error('[Socket] parse error', e); }
  };
  socket.onclose = () => { console.warn('[Socket] lost — reconnecting'); setTimeout(connectSocket, 2000); };
}

/* ── Font loading: Helvetiker path ────────────────────────────────────────── */
function loadBuiltinFont(track, cb) {
  const url = '/vendor/fonts/helvetiker_regular.typeface.json';
  if (fontCache[url]) { cb(fontCache[url]); return; }
  fontLoader.load(url, f => { fontCache[url] = f; cb(f); }, undefined,
    e => console.error('[FontLoader]', e));
}

/* ── Font loading: custom font path (shape API) ───────────────────────────── */
function fetchShapeData(fontId, text, cb) {
  const key = fontId + '|||' + text;
  if (shapeCache[key]) { cb(shapeCache[key]); return; }
  fetch('/api/shape', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fontId, text }),
  })
    .then(r => r.json())
    .then(data => { shapeCache[key] = data; cb(data); })
    .catch(e  => { console.error('[shape fetch]', e); cb(null); });
}

/* ── Convert shaped path commands → ExtrudeGeometry ─────────────────────── */
function commandsToGeometry(shapeData, track) {
  const { commands, ascender, descender } = shapeData;
  const fontHeight = ascender - descender;
  const scale = (track.size * 0.65) / fontHeight;

  // THREE.ShapePath correctly handles multiple sub-paths and determines
  // which are outer contours vs holes using winding order.
  const sp = new THREE.ShapePath();
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': sp.moveTo(cmd.x*scale, cmd.y*scale); break;
      case 'L': sp.lineTo(cmd.x*scale, cmd.y*scale); break;
      case 'Q': sp.quadraticCurveTo(cmd.x1*scale,cmd.y1*scale, cmd.x*scale,cmd.y*scale); break;
      case 'C': sp.bezierCurveTo(cmd.x1*scale,cmd.y1*scale, cmd.x2*scale,cmd.y2*scale, cmd.x*scale,cmd.y*scale); break;
      case 'Z': if (sp.currentPath) sp.currentPath.closePath(); break;
    }
  }
  // isCCW=true: outer contours wind CCW in Y-up space (TrueType convention)
  const shapes = sp.toShapes(true);
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth:          track.depth * 0.65,
    bevelEnabled:   track.bevel,
    bevelThickness: 0.02,
    bevelSize:      0.015,
    bevelSegments:  3,
    curveSegments:  8,
  });
  geo.center();
  return geo;
}

/* ── Build mesh for one track (chooses path based on font) ───────────────── */
function buildTrackMesh(track, cb) {
  const text = track.text || ' ';

  if (track.font === 'helvetiker') {
    // ── Built-in path: THREE.TextGeometry ──
    loadBuiltinFont(track, font => {
      try {
        const geo = new THREE.TextGeometry(text, {
          font, size: track.size * 0.65, height: track.depth * 0.65,
          curveSegments: 8, bevelEnabled: track.bevel,
          bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 3,
        });
        geo.center();
        cb(geo);
      } catch (e) { console.error('[Display] TextGeometry error', e); cb(null); }
    });
  } else {
    // ── Custom font path: shape API → ExtrudeGeometry ──
    fetchShapeData(track.font, text, data => {
      if (!data || data.useBuiltinFont) { cb(null); return; }
      try { cb(commandsToGeometry(data, track)); }
      catch (e) { console.error('[Display] commandsToGeometry error', e); cb(null); }
    });
  }
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
      const mat  = new THREE.MeshPhongMaterial({ color: colorVal, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.userData = {
        id:        track.id,
        baseY:     track.yPos * 0.5,
        delay:     track.delay    || 0,
        duration:  track.duration || 0,
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
  animationStartTime = performance.now();
  isAnimating = true;
}
function resetTimeline() {
  console.log('[Timeline] Reset');
  isAnimating = false;
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
          applyAnimationIn(mesh, d.animation, elapsed/ANIM_IN_DURATION, d.baseY);
        } else if (d.duration === 0 || elapsed < ANIM_IN_DURATION + d.duration) {
          applyAnimationHold(mesh, d.animation, elapsed - ANIM_IN_DURATION, d.baseY);
        } else if (elapsed < ANIM_IN_DURATION + d.duration + ANIM_OUT_DURATION) {
          const tOut = (elapsed - ANIM_IN_DURATION - d.duration) / ANIM_OUT_DURATION;
          applyAnimationHold(mesh, d.animation, d.duration + (elapsed - ANIM_IN_DURATION - d.duration), d.baseY);
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
function applyAnimationIn(mesh, animId, t, baseY) {
  mesh.scale.set(1,1,1); mesh.rotation.set(0,0,0);
  switch (animId) {
    case 'crashLandTop':
      mesh.position.set(0, baseY + 10*(1-easeOutBounce(t)), 0);
      mesh.material.opacity = Math.min(1.0, t*5); break;
    case 'zipInRight':
      mesh.position.set(15*(1-easeOutElastic(t)), baseY, 0);
      mesh.material.opacity = Math.min(1.0, t*4); break;
    case 'zipInSpin':
      mesh.position.set(15*(1-easeOutBack(t)), baseY, 0);
      mesh.rotation.y = (1-t)*Math.PI*2;
      mesh.material.opacity = Math.min(1.0, t*4); break;
    case 'spinContinuous':
      mesh.position.set(0, baseY, 0);
      mesh.rotation.y = t*Math.PI*2;
      mesh.material.opacity = t; break;
    case 'spinAndStop':
      mesh.position.set(0, baseY, 0);
      mesh.rotation.y = (1-easeOutQuad(t))*Math.PI*4;
      mesh.material.opacity = t; break;
    case 'bounce':
      mesh.position.set(0, baseY + 3*(1-easeOutBounce(t)), 0);
      mesh.material.opacity = Math.min(1.0, t*5); break;
    case 'fadeIn':
      mesh.position.set(0, baseY, 0);
      mesh.material.opacity = t; break;
    default:
      mesh.position.set(0, baseY, 0);
      mesh.material.opacity = 1.0; break;
  }
}
function applyAnimationHold(mesh, animId, elapsed, baseY) {
  mesh.material.opacity = 1.0; mesh.scale.set(1,1,1);
  switch (animId) {
    case 'zipInSpin':
    case 'spinContinuous':
      mesh.position.set(0, baseY, 0);
      mesh.rotation.y = (elapsed/1000)*1.5; break;
    case 'bounce':
      mesh.position.set(0, baseY + Math.abs(Math.sin(elapsed*0.005))*0.4, 0);
      mesh.rotation.set(0,0,0); break;
    default:
      mesh.position.set(0, baseY, 0);
      mesh.rotation.set(0,0,0); break;
  }
}

/* ── Entry point ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initThree();
  connectSocket();
});

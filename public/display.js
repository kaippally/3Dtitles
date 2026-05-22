/**
 * 3D Title OBS Display Overlay Client
 * Establishes a WebSocket connection to synchronise state,
 * and renders 3D text animations using Three.js.
 */
'use strict';

let socket = null;
let scene, camera, renderer;
let fontLoader;
let fontCache = {};
let activeState = null;

// Track mesh objects in scene mapped by track ID
let trackMeshes = {}; 

// Animation states
let animationStartTime = 0;
let isAnimating = false;

// Constant transition durations in ms
const ANIM_IN_DURATION = 1000;
const ANIM_OUT_DURATION = 500;

/* ── Math Easing Functions ────────────────────────────────────────────────── */
function easeOutQuad(t) {
  return t * (2 - t);
}

function easeOutBounce(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
}

function easeOutElastic(t) {
  const c4 = (2 * Math.PI) / 3;
  return t === 0
    ? 0
    : t === 1
    ? 1
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* ── Three.js Initialization ──────────────────────────────────────────────── */
function initThree() {
  const canvas = document.getElementById('displayCanvas');
  const W = window.innerWidth;
  const H = window.innerHeight;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
  camera.position.set(0, 0, 10);

  renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0); // transparent background

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(5, 5, 5);
  scene.add(dl);

  fontLoader = new THREE.FontLoader();

  window.addEventListener('resize', onWindowResize);

  // Start loop
  animateLoop();
}

function onWindowResize() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
}

/* ── WebSocket Connection ─────────────────────────────────────────────────── */
function connectSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}`;
  console.log('[Socket] Connecting to', url);

  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log('[Socket] Connected');
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('[Socket] Message received:', data.type);
      
      switch (data.type) {
        case 'init':
        case 'state':
          activeState = data.state;
          rebuildScene();
          if (data.autoPlay) {
            triggerAnimation();
          }
          break;
        case 'trigger':
          triggerAnimation();
          break;
        case 'reset':
          resetTimeline();
          break;
      }
    } catch (err) {
      console.error('[Socket] Error parsing message:', err);
    }
  };

  socket.onclose = () => {
    console.warn('[Socket] Connection lost. Reconnecting in 2 seconds...');
    setTimeout(connectSocket, 2000);
  };
}

/* ── Font loading helper ──────────────────────────────────────────────────── */
function loadFont(track, cb) {
  const url = track.font === 'helvetiker'
    ? 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json'
    : `/fonts/${track.font}_typeface.json`;

  if (fontCache[url]) {
    cb(fontCache[url]);
    return;
  }

  fontLoader.load(url, 
    (font) => {
      fontCache[url] = font;
      cb(font);
    },
    undefined,
    (err) => {
      console.error(`[FontLoader] Failed to load font: ${url}`, err);
    }
  );
}

/* ── Scene rebuilding ─────────────────────────────────────────────────────── */
function rebuildScene() {
  if (!activeState || !activeState.tracks) return;

  // Clear existing meshes
  Object.keys(trackMeshes).forEach((id) => {
    if (trackMeshes[id]) {
      scene.remove(trackMeshes[id]);
    }
  });
  trackMeshes = {};

  activeState.tracks.forEach((track) => {
    if (!track.enabled) return;

    loadFont(track, (font) => {
      try {
        // Double check track is still active in state
        const currentTrack = activeState.tracks.find(t => t.id === track.id);
        if (!currentTrack || !currentTrack.enabled) return;

        const geo = new THREE.TextGeometry(track.text || ' ', {
          font:          font,
          size:          track.size  * 0.65,
          height:        track.depth * 0.65,
          curveSegments: 8,
          bevelEnabled:  track.bevel,
          bevelThickness: 0.02,
          bevelSize:      0.015,
          bevelSegments:  3,
        });

        geo.center(); // Center local bounds

        const colorVal = parseInt(track.color.replace('#', ''), 16);
        const mat = new THREE.MeshPhongMaterial({
          color: colorVal,
          transparent: true,
          opacity: 0 // Start completely invisible
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false; // Start hidden
        
        // Save base coordinates
        mesh.userData = {
          id: track.id,
          baseY: track.yPos * 0.5,
          delay: track.delay || 0,
          duration: track.duration || 0,
          animation: track.animation || 'static'
        };

        scene.add(mesh);
        trackMeshes[track.id] = mesh;
      } catch (err) {
        console.error('[Display] Error building mesh for track', track.id, err);
      }
    });
  });
}

/* ── Timeline Playback Controls ───────────────────────────────────────────── */
function triggerAnimation() {
  console.log('[Timeline] Triggering animations');
  animationStartTime = performance.now();
  isAnimating = true;
}

function resetTimeline() {
  console.log('[Timeline] Resetting timeline');
  isAnimating = false;
  
  // Set all meshes back to hidden / opacity 0
  Object.keys(trackMeshes).forEach((id) => {
    const mesh = trackMeshes[id];
    if (mesh) {
      mesh.visible = false;
      mesh.material.opacity = 0;
      mesh.rotation.set(0, 0, 0);
    }
  });
}

/* ── Animation Tick and Render Loop ───────────────────────────────────────── */
function animateLoop() {
  requestAnimationFrame(animateLoop);
  
  if (isAnimating && activeState) {
    const now = performance.now();
    
    Object.keys(trackMeshes).forEach((id) => {
      const mesh = trackMeshes[id];
      if (!mesh) return;

      const data = mesh.userData;
      const elapsed = now - (animationStartTime + data.delay);

      if (elapsed < 0) {
        // Delay period
        mesh.visible = false;
        mesh.material.opacity = 0;
      } else {
        mesh.visible = true;

        if (elapsed < ANIM_IN_DURATION) {
          // 1. Animation In Phase
          const t = elapsed / ANIM_IN_DURATION;
          applyAnimationIn(mesh, data.animation, t, data.baseY);
        } else if (data.duration === 0 || elapsed < (ANIM_IN_DURATION + data.duration)) {
          // 2. Hold Phase
          const holdElapsed = elapsed - ANIM_IN_DURATION;
          applyAnimationHold(mesh, data.animation, holdElapsed, data.baseY);
        } else if (elapsed < (ANIM_IN_DURATION + data.duration + ANIM_OUT_DURATION)) {
          // 3. Animation Out Phase (Fade out)
          const outElapsed = elapsed - (ANIM_IN_DURATION + data.duration);
          const tOut = outElapsed / ANIM_OUT_DURATION;
          mesh.material.opacity = 1.0 - tOut;
          
          // Continue holding position/continuous animation rotation during fadeout
          applyAnimationHold(mesh, data.animation, (data.duration + outElapsed), data.baseY);
          mesh.material.opacity = 1.0 - tOut; // Re-apply opacity since hold overrides it to 1.0
        } else {
          // 4. Finished
          mesh.visible = false;
          mesh.material.opacity = 0;
        }
      }
    });
  }

  renderer.render(scene, camera);
}

/* ── Animation Easing Applicators ────────────────────────────────────────── */
function applyAnimationIn(mesh, animId, t, baseY) {
  // Reset basic scales/rotation defaults
  mesh.scale.set(1, 1, 1);
  mesh.rotation.set(0, 0, 0);

  switch (animId) {
    case 'crashLandTop':
      mesh.position.set(0, baseY + 10 * (1 - easeOutBounce(t)), 0);
      mesh.material.opacity = Math.min(1.0, t * 5); // Fast fade in
      break;

    case 'zipInRight':
      mesh.position.set(15 * (1 - easeOutElastic(t)), baseY, 0);
      mesh.material.opacity = Math.min(1.0, t * 4);
      break;

    case 'zipInSpin':
      mesh.position.set(15 * (1 - easeOutBack(t)), baseY, 0);
      mesh.rotation.y = (1 - t) * Math.PI * 2;
      mesh.material.opacity = Math.min(1.0, t * 4);
      break;

    case 'spinContinuous':
      mesh.position.set(0, baseY, 0);
      mesh.rotation.y = t * Math.PI * 2;
      mesh.material.opacity = t;
      break;

    case 'spinAndStop':
      mesh.position.set(0, baseY, 0);
      mesh.rotation.y = (1 - easeOutQuad(t)) * Math.PI * 4;
      mesh.material.opacity = t;
      break;

    case 'bounce':
      mesh.position.set(0, baseY + 3 * (1 - easeOutBounce(t)), 0);
      mesh.material.opacity = Math.min(1.0, t * 5);
      break;

    case 'fadeIn':
      mesh.position.set(0, baseY, 0);
      mesh.material.opacity = t;
      break;

    case 'static':
    default:
      mesh.position.set(0, baseY, 0);
      mesh.material.opacity = 1.0;
      break;
  }
}

function applyAnimationHold(mesh, animId, elapsed, baseY) {
  mesh.material.opacity = 1.0;
  mesh.scale.set(1, 1, 1);

  switch (animId) {
    case 'zipInSpin':
    case 'spinContinuous':
      mesh.position.set(0, baseY, 0);
      mesh.rotation.y = (elapsed / 1000) * 1.5; // Continue spinning continuously
      break;

    case 'bounce':
      mesh.position.set(0, baseY + Math.abs(Math.sin(elapsed * 0.005)) * 0.4, 0); // Gentle idle bouncing
      mesh.rotation.set(0, 0, 0);
      break;

    case 'crashLandTop':
    case 'zipInRight':
    case 'spinAndStop':
    case 'fadeIn':
    case 'static':
    default:
      mesh.position.set(0, baseY, 0);
      mesh.rotation.set(0, 0, 0);
      break;
  }
}

/* ── Entry Point ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initThree();
  connectSocket();
});

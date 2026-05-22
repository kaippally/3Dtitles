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
let fontCache  = {};   // font cache   { url → THREE.Font }
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

/* ── Font loading: loads built-in or custom font JSON ────────────────────── */
function loadFont(fontId, cb) {
  const url = fontId === 'helvetiker'
    ? '/vendor/fonts/helvetiker_regular.typeface.json'
    : `/fonts/${fontId}_typeface.json`;

  if (fontCache[url]) {
    cb(fontCache[url]);
    return;
  }
  fontLoader.load(url, f => {
    fontCache[url] = f;
    cb(f);
  }, undefined, e => {
    console.error('[FontLoader] Error loading font:', fontId, e);
    cb(null);
  });
}

/* ── Build mesh for one track ─────────────────────────────────────────────── */
function buildTrackMesh(track, cb) {
  let text = track.outputText || track.text || ' ';
  if (!track.outputText && track.font && track.font.toLowerCase().includes('manorama')) {
    text = convertUnicodeToCustomASCII(text);
  }
  loadFont(track.font, font => {
    if (!font) { cb(null); return; }
    try {
      const geo = new THREE.TextGeometry(text, {
        font,
        size: track.size * 0.65,
        height: track.depth * 0.65,
        curveSegments: 8,
        bevelEnabled: track.bevel,
        bevelThickness: 0.02,
        bevelSize: 0.015,
        bevelSegments: 3,
      });
      geo.center();
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

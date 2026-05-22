#!/usr/bin/env node
'use strict';

/**
 * 3D Text Animation Timeline Editor & Display
 * Editor:   http://localhost:5003/
 * Display:  http://localhost:5003/display
 *
 * npm install express ws opentype.js
 * node server.js
 */

const express = require('express');
const http    = require('http');
const wsLib   = require('ws');
const path    = require('path');
const fs      = require('fs');

const PORT   = 5003;
const BASE   = __dirname;
const SAVES  = path.join(BASE, 'saves');
const FONTS  = path.join(BASE, 'fonts');
const PUBLIC = path.join(BASE, 'public');
const AUDIO  = path.join(BASE, 'audio');
const IMAGES = path.join(BASE, 'images');

for (const d of [SAVES, FONTS, AUDIO, IMAGES]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const ACTIVE_FILE = path.join(SAVES, 'active.txt');

const app    = express();
const server = http.createServer(app);
const WSS    = new wsLib.WebSocketServer({ server });

app.use(express.json({ limit: '50mb' }));
app.use('/fonts', express.static(FONTS));
app.use('/audio', express.static(AUDIO));
app.use('/images', express.static(IMAGES));

// ── Serve Three.js r128 locally (no internet needed for OBS) ─────────────────
const THREE_BASE    = path.join(BASE, 'node_modules', 'three');
const PUBLIC_VENDOR = path.join(PUBLIC, 'vendor');

app.use('/vendor/three.min.js', (_, res) => {
  const nm    = path.join(THREE_BASE, 'build', 'three.min.js');
  const local = path.join(PUBLIC_VENDOR, 'three.min.js');
  res.sendFile(fs.existsSync(nm) ? nm : local);
});

// FontLoader.js + TextGeometry.js bundled in public/vendor/
app.use('/vendor', express.static(PUBLIC_VENDOR));

// Helvetiker typeface JSON — node_modules first, then public/vendor/fonts/
app.use('/vendor/fonts', (req, res, next) => {
  const nm = path.join(THREE_BASE, 'examples', 'fonts', req.path);
  if (fs.existsSync(nm)) return res.sendFile(nm);
  next();
});

app.use(express.static(PUBLIC));
app.get('/',        (_, res) => res.sendFile(path.join(PUBLIC, 'editor.html')));
app.get('/display', (_, res) => res.sendFile(path.join(PUBLIC, 'display.html')));

// ── Default state ─────────────────────────────────────────────────────────────
let appState = {
  aspectRatio: '1920x1080',
  tracks: [
    { id:1, enabled:true,  type:'text', text:'BREAKING NEWS', outputText:'BREAKING NEWS', font:'helvetiker', color:'#ff4444', animation:'crashLandTop',   size:1.0, depth:0.30, xPos:0.0, yPos: 1.8, zPos:0.0, delay:   0, duration:0, bevel:true, align:'center', audioStart: '', audioEnd: '' },
    { id:2, enabled:false, type:'text', text:'Price Drop',    outputText:'Price Drop',    font:'helvetiker', color:'#ffcc00', animation:'zipInRight',     size:0.8, depth:0.25, xPos:0.0, yPos: 0.0, zPos:0.0, delay: 800, duration:0, bevel:true, align:'center', audioStart: '', audioEnd: '' },
    { id:3, enabled:false, type:'text', text:'At WalMarts',   outputText:'At WalMarts',   font:'helvetiker', color:'#44ff44', animation:'zipInSpin',      size:0.7, depth:0.20, xPos:0.0, yPos:-1.8, zPos:0.0, delay:1600, duration:0, bevel:true, align:'center', audioStart: '', audioEnd: '' },
    { id:4, enabled:false, type:'image', image:'', animation:'static', size:1.0, xPos:0.0, yPos:-1.8, zPos:0.0, delay:0, duration:0, audioStart: '', audioEnd: '' },
  ],
};

function loadActiveTemplateOnStartup() {
  try {
    if (fs.existsSync(ACTIVE_FILE)) {
      const activeName = fs.readFileSync(ACTIVE_FILE, 'utf8').trim();
      if (activeName) {
        const filePath = path.join(SAVES, activeName + '.json');
        try {
          appState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          console.log('[startup] Loaded active template:', activeName);
          return activeName;
        } catch (e) {
          console.warn('[startup] Template unreadable, using defaults:', activeName);
        }
      }
    }
  } catch (e) {
    console.error('[startup] Error loading active template:', e.message);
  }
  return null;
}

let activeTemplateName = loadActiveTemplateOnStartup();

// ── WebSocket ─────────────────────────────────────────────────────────────────
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  WSS.clients.forEach(c => c.readyState === wsLib.OPEN && c.send(msg));
}
WSS.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'init', state: appState }));
});

// ── Font conversion helpers ───────────────────────────────────────────────────
const TYPEFACE_VERSION = 2;   // bump to force regeneration of all cached JSONs

function getFonts() {
  const list = [{ id: 'helvetiker', label: 'Helvetiker Regular (Built-in)', url: null }];
  try {
    for (const f of fs.readdirSync(FONTS)) {
      if (!f.endsWith('_typeface.json')) continue;
      const id = f.slice(0, -14);
      list.push({
        id,
        label: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        url:   '/fonts/' + f,
      });
    }
  } catch (_) {}
  return list;
}

async function convertFonts() {
  let op;
  try { op = require('opentype.js'); } catch (_) {
    console.log('[fonts] opentype.js not installed — skipping conversion');
    return;
  }
  for (const f of fs.readdirSync(FONTS)) {
    if (!/\.(ttf|otf)$/i.test(f)) continue;
    const base = f.slice(0, f.lastIndexOf('.'));
    const out  = path.join(FONTS, base + '_typeface.json');

    // Regenerate if missing OR if generated by an older converter version
    if (fs.existsSync(out)) {
      try {
        const existing = JSON.parse(fs.readFileSync(out, 'utf8'));
        if (existing._v === TYPEFACE_VERSION) continue;   // up to date
        console.log('[fonts] Re-converting (outdated v' + (existing._v || 1) + '): ' + f);
      } catch (_) { /* corrupt JSON — reconvert */ }
    } else {
      console.log('[fonts] Converting: ' + f);
    }

    try {
      const font = op.loadSync(path.join(FONTS, f));
      fs.writeFileSync(out, JSON.stringify(fontToTypeface(font)));
      console.log('[fonts] OK ' + base + '_typeface.json');
    } catch (e) { console.error('[fonts] Error: ' + e.message); }
  }
}

/**
 * Convert an opentype.js Font to a Three.js typeface JSON.
 *
 * KEY FIX vs original: uses g.path.commands (Y-up font coordinates) instead
 * of g.getPath(0, 0, RES) which internally flips Y for screen/canvas space,
 * causing upside-down text in Three.js TextGeometry.
 */
function fontToTypeface(font) {
  const RES = 1000, SC = RES / font.unitsPerEm, R = n => Math.round(n);
  const glyphs = {};

  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    if (!g.unicode) continue;
    const ch   = String.fromCodePoint(g.unicode);
    const cmds = (g.path && g.path.commands) ? g.path.commands : [];
    let o = '';
    for (const c of cmds) {
      if      (c.type === 'M') o += 'm '  + R(c.x  * SC) + ' ' + R(c.y  * SC) + ' ';
      else if (c.type === 'L') o += 'l '  + R(c.x  * SC) + ' ' + R(c.y  * SC) + ' ';
      else if (c.type === 'Q') o += 'q '  + R(c.x1 * SC) + ' ' + R(c.y1 * SC) + ' '
                                          + R(c.x  * SC) + ' ' + R(c.y  * SC) + ' ';
      else if (c.type === 'C') o += 'b '  + R(c.x1 * SC) + ' ' + R(c.y1 * SC) + ' '
                                          + R(c.x2 * SC) + ' ' + R(c.y2 * SC) + ' '
                                          + R(c.x  * SC) + ' ' + R(c.y  * SC) + ' ';
      else if (c.type === 'Z') o += 'z ';
    }
    glyphs[ch] = {
      ha:    R(g.advanceWidth  * SC),
      x_min: R((g.xMin || 0)  * SC),
      x_max: R((g.xMax || 0)  * SC),
      o:     o.trim(),
    };
  }

  const head = font.tables.head || {}, post = font.tables.post || {};
  return {
    _v:      TYPEFACE_VERSION,
    glyphs,
    familyName:         (font.names.fontFamily && font.names.fontFamily.en) || 'Custom',
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
    resolution:                RES,
    original_font_information: font.names,
  };
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/state',  (_, res) => res.json(appState));
app.post('/api/state', (req, res) => {
  appState = req.body;
  const autoPlay = req.query.autoPlay !== 'false';
  broadcast({ type: 'state', state: appState, autoPlay: autoPlay });
  res.json({ ok: true });
});

app.post('/api/trigger', (_, res) => { broadcast({ type: 'trigger' }); res.json({ ok: true }); });
app.post('/api/reset',   (_, res) => { broadcast({ type: 'reset'   }); res.json({ ok: true }); });

app.get('/api/fonts',      async (_, res) => { await convertFonts(); res.json(getFonts()); });
app.get('/api/scan-fonts', async (_, res) => { await convertFonts(); res.json(getFonts()); });

app.get('/api/audio', (_, res) => {
  res.json(fs.readdirSync(AUDIO).filter(f => /\.(mp3|wav|ogg|aac|m4a)$/i.test(f)));
});

app.post('/api/audio/upload', (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) {
    return res.status(400).json({ error: 'Missing name or data' });
  }
  try {
    const base64Data = data.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(path.join(AUDIO, name), buffer);
    res.json({ ok: true });
  } catch (e) {
    console.error('Audio upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/images', (_, res) => {
  res.json(fs.readdirSync(IMAGES).filter(f => /\.(png)$/i.test(f)));
});

app.post('/api/image/upload', (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) {
    return res.status(400).json({ error: 'Missing name or data' });
  }
  try {
    const base64Data = data.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(path.join(IMAGES, name), buffer);
    res.json({ ok: true });
  } catch (e) {
    console.error('Image upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/saves', (_, res) =>
  res.json(fs.readdirSync(SAVES).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))));

app.get('/api/active-template', (_, res) => {
  res.json({ activeTemplate: activeTemplateName || null });
});

app.get('/api/saves/:n', (req, res) => {
  const name = req.params.n;
  const p = path.join(SAVES, name + '.json');
  if (fs.existsSync(p)) {
    try {
      activeTemplateName = name;
      fs.writeFileSync(ACTIVE_FILE, name, 'utf8');
    } catch (e) {
      console.error('Error writing active template:', e);
    }
    res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/saves/:n', (req, res) => {
  try {
    const name = req.params.n;
    if (!name) {
      return res.status(400).json({ error: 'Missing template name' });
    }
    const safeName = path.basename(name);
    const filePath = path.join(SAVES, safeName + '.json');
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
    activeTemplateName = safeName;
    fs.writeFileSync(ACTIVE_FILE, safeName, 'utf8');

    res.json({ ok: true });
  } catch (e) {
    console.error('Error saving template:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/saves/:n', (req, res) => {
  const name = req.params.n;
  try { fs.unlinkSync(path.join(SAVES, name + '.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (activeTemplateName === name) {
    activeTemplateName = null;
    try { fs.unlinkSync(ACTIVE_FILE); } catch (e) {}
  }
  res.json({ ok: true });
});

// ── Ensure Helvetiker JSON is available locally ───────────────────────────────
async function ensureHelvetiker() {
  const dest = path.join(PUBLIC_VENDOR, 'fonts', 'helvetiker_regular.typeface.json');
  if (fs.existsSync(dest)) return;
  const nm = path.join(THREE_BASE, 'examples', 'fonts', 'helvetiker_regular.typeface.json');
  if (fs.existsSync(nm)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(nm, dest);
    console.log('[fonts] Copied Helvetiker from node_modules');
    return;
  }
  console.log('[fonts] Downloading Helvetiker from CDN...');
  try {
    const https = require('https');
    const url   = 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json';
    await new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const file = fs.createWriteStream(dest);
      https.get(url, res => { res.pipe(file); file.on('finish', () => { file.close(); resolve(); }); })
           .on('error', e => { fs.unlink(dest, () => {}); reject(e); });
    });
    console.log('[fonts] Helvetiker downloaded OK');
  } catch (e) {
    console.warn('[fonts] Could not download Helvetiker:', e.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log('\n3D Title Editor');
  console.log('  Editor:  http://localhost:' + PORT + '/');
  console.log('  Display: http://localhost:' + PORT + '/display');
  console.log('  Fonts:   ' + FONTS);
  console.log('  Saves:   ' + SAVES + '\n');
  await ensureHelvetiker();
  await convertFonts();   // auto-reconverts any font whose JSON is outdated
});

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

for (const d of [SAVES, FONTS]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const app    = express();
const server = http.createServer(app);
const WSS    = new wsLib.WebSocketServer({ server });

app.use(express.json({ limit: '50mb' }));
app.use('/fonts', express.static(FONTS));

// Serve Three.js r128 locally so OBS Browser Source works without internet access
const THREE_BASE = path.join(BASE, 'node_modules', 'three');
app.use('/vendor/three.min.js',          (_, res) => res.sendFile(path.join(THREE_BASE, 'build', 'three.min.js')));
app.use('/vendor/FontLoader.js',         (_, res) => res.sendFile(path.join(THREE_BASE, 'examples', 'js', 'loaders', 'FontLoader.js')));
app.use('/vendor/TextGeometry.js',       (_, res) => res.sendFile(path.join(THREE_BASE, 'examples', 'js', 'geometries', 'TextGeometry.js')));
app.use('/vendor/fonts',                 express.static(path.join(THREE_BASE, 'examples', 'fonts')));

app.use(express.static(PUBLIC));          // serves editor.html, editor.js, editor.css, display.html, display.js

app.get('/', (_, res) => res.sendFile(path.join(PUBLIC, 'editor.html')));
app.get('/display', (_, res) => res.sendFile(path.join(PUBLIC, 'display.html')));

// ── Default state ─────────────────────────────────────────────────────────────
let appState = {
  tracks: [
    { id:1, enabled:true,  text:'BREAKING NEWS', font:'helvetiker', color:'#ff4444', animation:'crashLandTop',   size:1.0, depth:0.30, yPos: 1.8, delay:   0, duration:0, bevel:true },
    { id:2, enabled:false, text:'Price Drop',    font:'helvetiker', color:'#ffcc00', animation:'zipInRight',     size:0.8, depth:0.25, yPos: 0.0, delay: 800, duration:0, bevel:true },
    { id:3, enabled:false, text:'At WalMarts',   font:'helvetiker', color:'#44ff44', animation:'zipInSpin',      size:0.7, depth:0.20, yPos:-1.8, delay:1600, duration:0, bevel:true },
  ],
};

// ── WebSocket ─────────────────────────────────────────────────────────────────
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  WSS.clients.forEach(c => c.readyState === wsLib.OPEN && c.send(msg));
}

WSS.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'init', state: appState }));
});

// ── Font helpers ──────────────────────────────────────────────────────────────
function getFonts() {
  const list = [{ id: 'helvetiker', label: 'Helvetiker Regular (Built-in)', url: null }];
  try {
    for (const f of fs.readdirSync(FONTS)) {
      if (!f.endsWith('_typeface.json')) continue;
      const id = f.slice(0, -14);
      list.push({
        id,
        label: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        url: '/fonts/' + f,
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
    if (fs.existsSync(out)) continue;
    console.log('[fonts] Converting: ' + f);
    try {
      const font = op.loadSync(path.join(FONTS, f));
      fs.writeFileSync(out, JSON.stringify(fontToTypeface(font)));
      console.log('[fonts] OK ' + base + '_typeface.json');
    } catch (e) { console.error('[fonts] Error: ' + e.message); }
  }
}

function fontToTypeface(font) {
  const RES = 1000, SC = RES / font.unitsPerEm, R = n => Math.round(n);
  const glyphs = {};
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    if (!g.unicode) continue;
    const ch  = String.fromCodePoint(g.unicode);
    const pth = g.getPath(0, 0, RES);
    let o = '';
    for (const c of pth.commands) {
      if      (c.type === 'M') o += 'm '  + R(c.x)  + ' ' + R(c.y)  + ' ';
      else if (c.type === 'L') o += 'l '  + R(c.x)  + ' ' + R(c.y)  + ' ';
      else if (c.type === 'Q') o += 'q '  + R(c.x1) + ' ' + R(c.y1) + ' ' + R(c.x)  + ' ' + R(c.y)  + ' ';
      else if (c.type === 'C') o += 'b '  + R(c.x1) + ' ' + R(c.y1) + ' ' + R(c.x2) + ' ' + R(c.y2) + ' ' + R(c.x) + ' ' + R(c.y) + ' ';
      else if (c.type === 'Z') o += 'z ';
    }
    glyphs[ch] = { ha: R(g.advanceWidth * SC), x_min: R((g.xMin || 0) * SC), x_max: R((g.xMax || 0) * SC), o: o.trim() };
  }
  const head = font.tables.head || {}, post = font.tables.post || {};
  return {
    glyphs,
    familyName: (font.names.fontFamily && font.names.fontFamily.en) || 'Custom',
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
    resolution: RES,
    original_font_information: font.names,
  };
}

// ── Text shaping (dynamic GSUB — conjuncts, ligatures, required forms) ───────
const _opFontCache = {};

function getOpFont(fontId) {
  if (_opFontCache[fontId]) return _opFontCache[fontId];
  let op;
  try { op = require('opentype.js'); } catch (_) { return null; }
  const fontFile = fs.readdirSync(FONTS).find(f =>
    /\.(ttf|otf)$/i.test(f) && f.slice(0, f.lastIndexOf('.')) === fontId);
  if (!fontFile) return null;
  const font = op.loadSync(path.join(FONTS, fontFile));
  _opFontCache[fontId] = font;
  return font;
}

// POST /api/shape  { fontId, text }
// Returns shaped glyph path commands (GSUB applied — ligatures, conjuncts etc.)
// All coordinates normalised to 1 em = 1 unit (Y-up, matching Three.js Y-axis).
app.post('/api/shape', (req, res) => {
  const { fontId, text } = req.body || {};
  if (!fontId || fontId === 'helvetiker' || !text) {
    return res.json({ useBuiltinFont: true });
  }
  const font = getOpFont(fontId);
  if (!font) return res.status(404).json({ error: 'Font not found: ' + fontId });

  try {
    const SC = 1 / font.unitsPerEm;          // normalise: 1 em → 1 Three.js unit

    // stringToGlyphs applies the font's GSUB tables:
    // replaces character sequences with the correct conjunct / ligature glyphs.
    const glyphs = font.stringToGlyphs(text);
    let cursorX = 0;
    const commands = [];

    glyphs.forEach((g, i) => {
      if (g.path && g.path.commands) {
        for (const c of g.path.commands) {
          if      (c.type === 'M') commands.push({ type:'M', x:(c.x+cursorX)*SC, y:c.y*SC });
          else if (c.type === 'L') commands.push({ type:'L', x:(c.x+cursorX)*SC, y:c.y*SC });
          else if (c.type === 'Q') commands.push({ type:'Q',
            x1:(c.x1+cursorX)*SC, y1:c.y1*SC,
            x :(c.x +cursorX)*SC, y :c.y *SC });
          else if (c.type === 'C') commands.push({ type:'C',
            x1:(c.x1+cursorX)*SC, y1:c.y1*SC,
            x2:(c.x2+cursorX)*SC, y2:c.y2*SC,
            x :(c.x +cursorX)*SC, y :c.y *SC });
          else if (c.type === 'Z') commands.push({ type:'Z' });
        }
      }
      let kern = 0;
      try { kern = (i+1 < glyphs.length) ? (font.getKerningValue(g, glyphs[i+1]) || 0) : 0; }
      catch (_) {}
      cursorX += (g.advanceWidth || 0) + kern;
    });

    res.json({
      commands,
      ascender:   font.ascender  * SC,
      descender:  font.descender * SC,
      totalWidth: cursorX        * SC,
    });
  } catch (e) {
    console.error('[shape]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/state',  (_, res) => res.json(appState));
app.post('/api/state', (req, res) => {
  appState = req.body;
  broadcast({ type: 'state', state: appState, autoPlay: true });
  res.json({ ok: true });
});

app.post('/api/trigger', (_, res) => { broadcast({ type: 'trigger' }); res.json({ ok: true }); });
app.post('/api/reset',   (_, res) => { broadcast({ type: 'reset'   }); res.json({ ok: true }); });

app.get('/api/fonts',      async (_, res) => { await convertFonts(); res.json(getFonts()); });
app.get('/api/scan-fonts', async (_, res) => { await convertFonts(); res.json(getFonts()); });

app.get('/api/saves', (_, res) =>
  res.json(fs.readdirSync(SAVES).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))));

app.get('/api/saves/:n', (req, res) => {
  const p = path.join(SAVES, req.params.n + '.json');
  fs.existsSync(p) ? res.json(JSON.parse(fs.readFileSync(p, 'utf8'))) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/saves/:n', (req, res) => {
  fs.writeFileSync(path.join(SAVES, req.params.n + '.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.delete('/api/saves/:n', (req, res) => {
  const p = path.join(SAVES, req.params.n + '.json');
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log('\n3D Title Editor');
  console.log('  Editor:  http://localhost:' + PORT + '/');
  console.log('  Display: http://localhost:' + PORT + '/display.html');
  console.log('  Fonts:   ' + FONTS);
  console.log('  Saves:   ' + SAVES + '\n');
  await convertFonts();
});

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

// Serve Three.js r128 locally — no internet required in OBS
const THREE_BASE   = path.join(BASE, 'node_modules', 'three');
const PUBLIC_VENDOR = path.join(PUBLIC, 'vendor');

// three.min.js — from node_modules if installed, else public/vendor/
app.use('/vendor/three.min.js', (_, res) => {
  const nm = path.join(THREE_BASE, 'build', 'three.min.js');
  const local = path.join(PUBLIC_VENDOR, 'three.min.js');
  res.sendFile(fs.existsSync(nm) ? nm : local);
});

// FontLoader.js + TextGeometry.js — bundled in public/vendor/ (always available)
app.use('/vendor', express.static(PUBLIC_VENDOR));

// Helvetiker font — from node_modules/three/examples/fonts if installed, else public/vendor/fonts/
app.use('/vendor/fonts', (req, res, next) => {
  const nm = path.join(THREE_BASE, 'examples', 'fonts', req.path);
  if (fs.existsSync(nm)) return res.sendFile(nm);
  next(); // falls through to express.static on PUBLIC_VENDOR above
});

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

// ── Font data cache (opentype + raw buffer for HarfBuzz) ─────────────────────
const _fontDataCache = {};

function getFontData(fontId) {
  if (_fontDataCache[fontId]) return _fontDataCache[fontId];
  let op;
  try { op = require('opentype.js'); } catch (_) { return null; }
  const fontFile = fs.readdirSync(FONTS).find(f =>
    /\.(ttf|otf)$/i.test(f) && f.slice(0, f.lastIndexOf('.')) === fontId);
  if (!fontFile) return null;
  const fontPath = path.join(FONTS, fontFile);
  const opFont   = op.loadSync(fontPath);
  const buffer   = fs.readFileSync(fontPath);
  _fontDataCache[fontId] = { opFont, buffer };
  return _fontDataCache[fontId];
}

// ── HarfBuzz loader (WASM init once, then cached) ────────────────────────────
let _hb = null;

async function loadHB() {
  if (_hb !== null) return _hb;   // null = "tried and failed", object = success
  try {
    let mod = require('harfbuzzjs');
    // harfbuzzjs may export a Promise, a factory fn, or the API directly
    if (typeof mod === 'function')       mod = await mod();
    else if (mod && mod.then)            mod = await mod;
    // Basic sanity check
    if (mod && typeof mod.createBlob === 'function') {
      _hb = mod;
      console.log('[harfbuzz] Loaded — full Indic shaping active');
    } else {
      throw new Error('Unexpected harfbuzzjs export shape');
    }
  } catch (e) {
    _hb = false;   // mark as unavailable so we don't keep retrying
    console.warn('[harfbuzz] Not available — falling back to opentype.js layout():', e.message);
  }
  return _hb;
}

// Pre-warm HarfBuzz at startup so first request is fast
loadHB();

// ── POST /api/shape  { fontId, text } ────────────────────────────────────────
// Pipeline:
//   HarfBuzz (if loaded) → correct glyph IDs + positions (Indic reordering,
//   full GSUB conjuncts, GPOS mark placement)
//   opentype.js → glyph outlines by ID
//   Combined → glyph path commands, Y-up, 1 em = 1 unit
app.post('/api/shape', async (req, res) => {
  const { fontId, text } = req.body || {};
  if (!fontId || fontId === 'helvetiker' || !text) {
    return res.json({ useBuiltinFont: true });
  }
  const fontData = getFontData(fontId);
  if (!fontData) return res.status(404).json({ error: 'Font not found: ' + fontId });

  try {
    const { opFont, buffer } = fontData;
    const SC = 1 / opFont.unitsPerEm;
    let glyphItems;

    const hb = await loadHB();

    if (hb) {
      // ── HarfBuzz path ───────────────────────────────────────────────────────
      // bufferGuessSegmentProperties auto-detects Malayalam Unicode range →
      // sets script=Mlym/Mlm2, direction=LTR, applies full Indic shaping
      // including pre-base matra reordering that opentype.js cannot do.
      let hbBlob, hbFace, hbFont, hbBuf;
      try {
        hbBlob = hb.createBlob(new Uint8Array(buffer));
        hbFace = hb.createFace(hbBlob, 0);
        hbFont = hb.createFont(hbFace);
        hbBuf  = hb.createBuffer();
        hb.bufferAddUTF8(hbBuf, text);
        hb.bufferGuessSegmentProperties(hbBuf);
        hb.shape(hbFont, hbBuf, []);

        const infos = hb.bufferGetGlyphInfos(hbBuf);
        const pos   = hb.bufferGetGlyphPositions(hbBuf);

        glyphItems = infos.map((info, i) => ({
          glyphId:  info.codepoint,   // glyph ID (not Unicode!)
          xAdvance: pos[i].xAdvance,
          xOffset:  pos[i].xOffset,
          yOffset:  pos[i].yOffset,
        }));
      } finally {
        if (hbBuf)  hb.destroyBuffer(hbBuf);
        if (hbFont) hb.destroyFont(hbFont);
        if (hbFace) hb.destroyFace(hbFace);
        if (hbBlob) hb.destroyBlob(hbBlob);
      }

    } else {
      // ── opentype.js layout() fallback ──────────────────────────────────────
      // Better than stringToGlyphs: applies mlm2→mlym→generic GSUB pipeline.
      // Does not do Indic reordering, but handles most substitutions.
      let shaped = null;
      for (const [sc, lang] of [['mlm2','dflt'],['mlym','dflt'],[null,null]]) {
        try {
          shaped = sc ? opFont.layout(text, undefined, sc, lang) : opFont.layout(text);
          if (shaped && (shaped.glyphs || []).length) break;
        } catch (_) {}
      }
      glyphItems = (shaped && shaped.glyphs) ? shaped.glyphs.map(item => {
        const g   = item.glyph || item;
        const p   = item.pos   || {};
        return {
          glyphId:  g.index != null ? g.index : null,
          glyph:    g,
          xAdvance: p.xAdvance != null ? p.xAdvance : (g.advanceWidth || 0),
          xOffset:  p.xOffset  || 0,
          yOffset:  p.yOffset  || 0,
        };
      }) : opFont.stringToGlyphs(text).map(g => ({
        glyphId: g.index != null ? g.index : null,
        glyph:   g,
        xAdvance: g.advanceWidth || 0,
        xOffset: 0, yOffset: 0,
      }));
    }

    // ── Build absolute path commands (Y-up font coords) ───────────────────────
    let cursorX = 0;
    const commands = [];

    for (const item of glyphItems) {
      // Resolve glyph: by ID (HarfBuzz path) or stored object (fallback)
      const g  = (item.glyphId != null)
                   ? opFont.glyphs.get(item.glyphId)
                   : item.glyph;
      const bx = cursorX + item.xOffset;
      const by = item.yOffset;

      if (g && g.path && g.path.commands) {
        for (const c of g.path.commands) {
          if      (c.type === 'M') commands.push({ type:'M', x:(c.x+bx)*SC, y:(c.y+by)*SC });
          else if (c.type === 'L') commands.push({ type:'L', x:(c.x+bx)*SC, y:(c.y+by)*SC });
          else if (c.type === 'Q') commands.push({ type:'Q',
            x1:(c.x1+bx)*SC, y1:(c.y1+by)*SC,
            x :(c.x +bx)*SC, y :(c.y +by)*SC });
          else if (c.type === 'C') commands.push({ type:'C',
            x1:(c.x1+bx)*SC, y1:(c.y1+by)*SC,
            x2:(c.x2+bx)*SC, y2:(c.y2+by)*SC,
            x :(c.x +bx)*SC, y :(c.y +by)*SC });
          else if (c.type === 'Z') commands.push({ type:'Z' });
        }
      }
      cursorX += item.xAdvance;
    }

    res.json({
      commands,
      ascender:   opFont.ascender  * SC,
      descender:  opFont.descender * SC,
      totalWidth: cursorX          * SC,
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

// ── Ensure Helvetiker font is available locally ────────────────────────────────
async function ensureHelvetiker() {
  const dest = path.join(PUBLIC, 'vendor', 'fonts', 'helvetiker_regular.typeface.json');
  if (fs.existsSync(dest)) return;
  // Try node_modules first
  const nm = path.join(THREE_BASE, 'examples', 'fonts', 'helvetiker_regular.typeface.json');
  if (fs.existsSync(nm)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(nm, dest);
    console.log('[fonts] Copied Helvetiker from node_modules');
    return;
  }
  // Download from CDN as last resort
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
  await convertFonts();
});

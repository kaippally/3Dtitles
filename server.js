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
app.use(express.static(PUBLIC));          // serves editor.html, editor.js, editor.css, display.html, display.js

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

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/state',  (_, res) => res.json(appState));
app.post('/api/state', (req, res) => {
  appState = req.body;
  broadcast({ type: 'state', state: appState, autoPlay: true });
  res.json({ ok: true });
});

app.post('/api/trigger', (_, res) => { broadcast({ type: 'trigger' }); res.json({ ok: true }); });
app.post('/api/reset',   (_, res) => { broadcast({ type: 'reset'   }); res.json({ ok: true }); });

app.get('/api/fonts',      (_, res) => res.json(getFonts()));
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

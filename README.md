# 3D Title Editor

A single Node.js app for creating 3D text animation overlays — OBS-ready.

| URL | Purpose |
|-----|---------|
| `http://localhost:5003/` | Timeline editor |
| `http://localhost:5003/display` | OBS Browser Source |

---

## Quick Start

```bash
cd "3D Titles"
npm install
node server.js
```

Open the editor in your browser, add the display URL as an OBS Browser Source (1920×1080, transparent background).

---

## Animation Presets

| Preset | Description |
|--------|-------------|
| **Crash Land (Top)** | Drops from above with a bounce landing |
| **Zip In (Right)** | Slides in from the right with elastic ease |
| **Zip In + Spin** | Slides in, then spins continuously |
| **Spin Continuously** | Fades in and rotates forever |
| **Spin & Stop** | Spins fast then decelerates to rest |
| **Bounce** | Drops in and gently bounces in place |
| **Fade In** | Simple opacity fade-in |
| **Static** | Appears instantly, no motion |

---

## Stacking 3 Tracks (Example)

| Track | Text | Animation | Delay |
|-------|------|-----------|-------|
| 1 | `BREAKING NEWS` | Crash Land (Top) | 0 ms |
| 2 | `Price Drop` | Zip In (Right) | 800 ms |
| 3 | `At WalMarts` | Zip In + Spin | 1600 ms |

Hit **▶ Trigger** — all three animate in sequence.

---

## Malayalam & Custom Fonts

Three.js TextGeometry uses its own typeface JSON format and does **not** load TTF/WOFF directly. This server converts fonts automatically.

### Steps

1. Download **Noto Serif Malayalam** (or any TTF/OTF):
   - https://fonts.google.com/noto/specimen/Noto+Serif+Malayalam
2. Place the `.ttf` file in the `fonts/` folder.
3. Click **↻ Fonts** in the editor (or restart the server).
4. The server converts it to `NotoSerifMalayalam_typeface.json` using `opentype.js`.
5. The font now appears in the Font dropdown.

### Important Note on Malayalam Rendering

Native Three.js TextGeometry renders glyphs one character at a time and **does not perform complex text shaping** (conjuncts, ligatures, vowel signs). This means Malayalam conjunct forms may not render correctly — individual Unicode code points will be drawn separately.

For display titles where individual words/phrases are designed carefully (e.g. `കേരള` without complex conjuncts), the output is usable. For full complex-script shaping, a canvas-texture approach would be needed instead.

---

## Folder Structure

```
3D Titles/
├── server.js        ← the entire app
├── package.json
├── README.md
├── saves/           ← saved scene JSON files
└── fonts/           ← drop TTF/OTF fonts here
    └── (your_font)_typeface.json   ← auto-generated
```

---

## OBS Setup

1. Add **Browser Source** in OBS.
2. URL: `http://localhost:5003/display`
3. Width: `1920`, Height: `1080`
4. ✅ Enable **"Shutdown source when not visible"** (optional)
5. Keep **"Use custom frame rate"** unchecked.
6. The background is fully transparent — place it over your video feed.

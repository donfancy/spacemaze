// Browser-Einstiegspunkt: verbindet Canvas, Renderer, Game-Loop und Eingabe.
// Laeuft ausschliesslich im requestAnimationFrame-Takt (Ziel: 60 FPS, Full-Redraw).

import { Renderer } from './render/renderer.js';
import { Game } from './core/game.js';
import { createAudioOutput } from './sound/audio.js';
import { DebugConsole } from './debug/debugConsole.js';

const canvas = document.getElementById('screen');
const renderer = new Renderer(canvas);

const debug = new DebugConsole();
const debugEnabled = new URLSearchParams(location.search).has('debug');

// --- Canvas-Groesse an Fenster + Pixeldichte anpassen ---------------------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // 2 reicht; mehr kostet nur Fuellrate
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener('resize', resize);
resize();

// --- Spiel + Eingabe ------------------------------------------------------------
const audio = createAudioOutput();
const game = new Game({ debug: debugEnabled ? debug : null, audio });

// Einzelzeichen (Buchstaben) normalisieren wir auf Grossbuchstaben.
const normKey = (e) => (e.key.length === 1 ? e.key.toUpperCase() : e.key);

window.addEventListener('keydown', (e) => {
  const key = normKey(e);
  audio.unlock();              // Autoplay-Policy: Sound braucht eine User-Geste
  if (key === 'M') audio.toggleMuted(); // globaler Stumm-Schalter
  game.keys.add(key);          // gehaltene Taste (kontinuierliche Steuerung)
  game.handleKey(key);         // diskrete Aktion (S, Q, ...)
  if (key.startsWith('Arrow')) e.preventDefault(); // kein Seiten-Scrollen
});

window.addEventListener('keyup', (e) => {
  game.keys.delete(normKey(e));
});

// --- Debug-Overlay unten rechts -------------------------------------------------
function renderDebug() {
  const lines = debug.lines();
  const w = renderer.width;
  const h = renderer.height;
  const size = 13;
  const lineH = size * 1.7;
  // Von unten nach oben stapeln, rechtsbuendig.
  for (let i = 0; i < lines.length; i++) {
    const y = h - 12 - i * lineH;
    renderer.drawText(lines[lines.length - 1 - i], {
      x: w - 12,
      y,
      size,
      align: 'right',
      baseline: 'bottom',
      intensity: 0.6,
      glow: 4,
      lineWidth: 1.5,
    });
  }
}

// --- Hauptschleife --------------------------------------------------------------
let last = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;
let fps = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // nach Tab-Wechsel/Ruckler begrenzen

  game.update(dt);

  renderer.beginFrame();
  game.render(renderer);

  // FPS gemittelt ueber ~0,5s.
  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }

  if (debugEnabled) {
    debug.set('STATE', game.stateKey);
    debug.set('FPS', fps);
    debug.set('TRANS', game.transition.active ? game.transition.toState : '-');
    debug.set('TIME', game.time.toFixed(1));
    renderDebug();
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

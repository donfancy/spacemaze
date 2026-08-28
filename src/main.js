// Browser-Einstiegspunkt: verbindet Canvas, Renderer, Game-Loop und Eingabe.
// Laeuft ausschliesslich im requestAnimationFrame-Takt (Ziel: 60 FPS, Full-Redraw).

import { Renderer } from './render/renderer.js';
import { Game } from './core/game.js';
import { resolveEngine, ENGINE_1980, ENGINE_2026 } from './core/engine.js';
import { createAudioOutput } from './sound/audio.js';
import { DebugConsole } from './debug/debugConsole.js';

const canvas = document.getElementById('screen');
const renderer = new Renderer(canvas);

const debug = new DebugConsole();
const debugEnabled = new URLSearchParams(location.search).has('debug');

// --- Rendering-Engine (PLAN2026.md): 1980 = 2D-Canvas, 2026 = Three.js ----------
// Das 2026-Backend wird NUR bei Bedarf geladen (dynamischer Import) und wie
// audio in game injiziert -- der Core importiert nie Three.js. Der Startscreen-
// Schalter (Stufe 3) aendert game.engine LIVE: applyEngine() laedt das Backend
// nach und blendet Canvas/Backend um; die Wahl landet in localStorage
// (?engine= in der URL hat beim Laden Vorrang, siehe resolveEngine).
const ENGINE_KEY = 'spacemaze.engine';
let stored = null;
try { stored = localStorage.getItem(ENGINE_KEY); } catch { /* privat-Modus o.ae. */ }
const engine = resolveEngine(location.search, stored);
let backend = null;
let backendLoading = null;

// Aktiv ist 2026 nur mit fertig geladenem Backend -- bis dahin zeichnet 1980
// weiter (game.render faellt von selbst zurueck).
function is2026Active(g) {
  return g.engine === ENGINE_2026 && backend !== null;
}

function applyEngine(g) {
  if (g.engine === ENGINE_2026 && !backend && !backendLoading) {
    backendLoading = import('./render2026/backend.js').then(({ createBackend2026 }) => {
      backend = createBackend2026(document.body);
      backend.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2));
      g.renderBackend = backend;
      applyEngine(g); // jetzt wirklich umblenden
    }).catch((err) => {
      // Import gescheitert (offline, Vendor fehlt): zurueck auf 1980 und den
      // Schalter freigeben -- sonst bliebe die rejected Promise fuer immer
      // stehen und "2026" waere stumm tot.
      console.error('2026-Backend laedt nicht -- bleibe bei 1980:', err);
      backendLoading = null;
      g.engine = ENGINE_1980;
      applyEngine(g);
    });
  }
  const active = is2026Active(g);
  canvas.style.display = active ? 'none' : '';
  backend?.setVisible(active);
}

// --- Canvas-Groesse an Fenster + Pixeldichte anpassen ---------------------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // 2 reicht; mehr kostet nur Fuellrate
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
  backend?.resize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener('resize', resize);
resize();

// --- Spiel + Eingabe ------------------------------------------------------------
const audio = createAudioOutput();
const game = new Game({ debug: debugEnabled ? debug : null, audio, engine, renderBackend: backend });
let lastEngine = game.engine;
applyEngine(game); // initiale Wahl anwenden (laedt ggf. das 2026-Backend)

// Debug-Haken fuer die CDP-Sichtpruefung (PLAN2026.md): headless laeuft die
// Uhr gedehnt, die Test-Skripte pollen deshalb Zustand + Spielzeit.
window.spacemaze = game;

// Einzelzeichen (Buchstaben) normalisieren wir auf Grossbuchstaben.
const normKey = (e) => (e.key.length === 1 ? e.key.toUpperCase() : e.key);

window.addEventListener('keydown', (e) => {
  const key = normKey(e);
  audio.unlock();              // Autoplay-Policy: Sound braucht eine User-Geste
  if (key === 'M') {
    audio.toggleMuted();       // globaler Stumm-Schalter -- faellt nicht ins Spiel durch
    return;
  }
  game.keys.add(key);          // gehaltene Taste (kontinuierliche Steuerung)
  game.handleKey(key);         // diskrete Aktion (S, Q, ...)
  if (key.startsWith('Arrow') || key === ' ') e.preventDefault(); // kein Seiten-Scrollen (Pfeile, Space = Feuer)
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

  // Live-Engine-Schalter (Startscreen, Stufe 3): Wahl gemerkt + umgeblendet.
  if (game.engine !== lastEngine) {
    lastEngine = game.engine;
    try { localStorage.setItem(ENGINE_KEY, game.engine); } catch { /* egal */ }
    applyEngine(game);
  }

  const active2026 = is2026Active(game);
  if (!active2026) renderer.beginFrame(); // 2026 zeichnet auf dem eigenen Canvas
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
    debug.set('TIME', game.time.toFixed(1));
    if (!active2026) renderDebug(); // Debug-Overlay lebt auf dem 1980-Canvas
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

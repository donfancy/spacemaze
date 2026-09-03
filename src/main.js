// Browser-Einstiegspunkt: verbindet Canvas, Renderer, Game-Loop und Eingabe.
// Laeuft ausschliesslich im requestAnimationFrame-Takt (Ziel: 60 FPS, Full-Redraw).

import { Renderer } from './render/renderer.js';
import { Game } from './core/game.js';
import { resolveEngine, ENGINE_1980, ENGINE_2026 } from './core/engine.js';
import { createAudioOutput } from './sound/audio.js';
import { DebugConsole } from './debug/debugConsole.js';
import { State } from './core/states.js';
import { levelColor, levelConfig } from './core/levels.js';
import { selectorArrows } from './core/hud.js';
import { hasRecording } from './core/recorder.js';
import { PHOSPHOR_GREEN } from './render/colors.js';
import { screenLayout, deckModel, KEY_MIRROR } from './input/layout.js';
import {
  createTouch, touchDown, touchMove, touchUp, touchCancel, heldKeys, padState, firePressed,
} from './input/touch.js';
import { drawDeck } from './input/touchDraw.js';

const canvas = document.getElementById('screen');
const renderer = new Renderer(canvas);
// Overlay-Canvas des Touch-Decks (input/layout.js): ein zweiter Vektor-
// Renderer ueber BEIDEN Engines -- im Hochformat das Bedienpult unter der
// Welt, im Querformat durchsichtig darueber. Ohne Touch unsichtbar.
const touchCanvas = document.getElementById('touch');
const touchRenderer = new Renderer(touchCanvas);

const debug = new DebugConsole();
const debugEnabled = new URLSearchParams(location.search).has('debug');

// --- Rendering-Engine (PLAN2026.md): 1980 = 2D-Canvas, 2026 = Three.js ----------
// Das 2026-Backend wird NUR bei Bedarf geladen (dynamischer Import) und wie
// audio in game injiziert -- der Core importiert nie Three.js. Der Startscreen-
// Schalter (Stufe 3) aendert game.engine LIVE: applyEngine() laedt das Backend
// nach und blendet Canvas/Backend um; die Wahl landet in localStorage
// (?engine= in der URL hat beim Laden Vorrang, siehe resolveEngine).
const ENGINE_KEY = 'mazestorm.engine';
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
      backend.resize(layout.view.w, layout.view.h, Math.min(window.devicePixelRatio || 1, 2), layout.view);
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

// --- Touch/Mobile (1.9.2026, Boris' "Mini-Automat") ----------------------------
// Touch-Modus: ?touch=1/0 erzwingt (Sichtpruefung per CDP), sonst grober
// Zeiger (Handy/Tablet) -- und spaetestens die erste echte Beruehrung
// schaltet ihn ein. Tastatur bleibt immer parallel nutzbar.
const params = new URLSearchParams(location.search);
let touchMode = params.has('touch') ? params.get('touch') !== '0'
  : !!window.matchMedia?.('(pointer: coarse)').matches;
const MIRROR_KEY = 'mazestorm.touchMirror';
let mirror = false; // Pad rechts / FIRE links (Chip SWAP im Deck)
try { mirror = localStorage.getItem(MIRROR_KEY) === '1'; } catch { /* egal */ }

// Sichere Raender (Notch, Home-Indikator) per CSS-env auslesen: ein
// unsichtbares Element traegt sie als Padding.
const insetProbe = document.createElement('div');
insetProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;' +
  'pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
  'env(safe-area-inset-bottom) env(safe-area-inset-left);';
document.body.appendChild(insetProbe);
function readInsets() {
  const cs = getComputedStyle(insetProbe);
  const px = (v) => parseFloat(v) || 0;
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}

// --- Canvas-Groesse an Fenster + Pixeldichte anpassen ---------------------------
// Die Aufteilung (Welt-Ausschnitt + Deck) rechnet input/layout.js; hier
// werden nur die Elemente hingelegt.
let layout = screenLayout({ width: window.innerWidth, height: window.innerHeight });
function place(el, r) {
  el.style.left = r.x + 'px';
  el.style.top = r.y + 'px';
  el.style.width = r.w + 'px';
  el.style.height = r.h + 'px';
}
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // 2 reicht; mehr kostet nur Fuellrate
  const w = window.innerWidth;
  const h = window.innerHeight;
  layout = screenLayout({ width: w, height: h, touch: touchMode, insets: readInsets() });
  place(canvas, layout.view);
  renderer.resize(layout.view.w, layout.view.h, dpr);
  backend?.resize(layout.view.w, layout.view.h, dpr, layout.view);
  touchCanvas.style.display = layout.deck ? 'block' : 'none';
  if (layout.deck) {
    place(touchCanvas, { x: 0, y: 0, w, h });
    touchRenderer.resize(w, h, dpr);
  }
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
window.mazestorm = game;
window.mazestormTouch = () => model; // Trefferzonen des Decks (CDP-Sichtpruefung)

// Einzelzeichen (Buchstaben) normalisieren wir auf Grossbuchstaben.
const normKey = (e) => (e.key.length === 1 ? e.key.toUpperCase() : e.key);

window.addEventListener('keydown', (e) => {
  const key = normKey(e);
  audio.unlock();              // Autoplay-Policy: Sound braucht eine User-Geste
  if (key === 'M') {
    audio.toggleMuted();       // globaler Stumm-Schalter -- faellt nicht ins Spiel durch
    return;
  }
  // Attract-Mode: die Demo-Tasten gehoeren dem Autopiloten -- User-Tasten
  // landen NICHT in game.keys (handleKey routet S/Pfeile auf die Auswahl).
  if (!game.demo) game.keys.add(key); // gehaltene Taste (kontinuierliche Steuerung)
  game.handleKey(key);         // diskrete Aktion (S, X, ...)
  if (key.startsWith('Arrow') || key === ' ') e.preventDefault(); // kein Seiten-Scrollen (Pfeile, Space = Feuer)
});

window.addEventListener('keyup', (e) => {
  game.keys.delete(normKey(e));
});

// --- Touch-Eingabe: Finger -> Tasten (input/touch.js) ---------------------------
// Getippte Tasten (Chips, Wisch, Tipp) laufen NUR durch handleKey (wie ein
// kurzer Tastendruck), gehaltene (Pad-Pfeile, Feuer) spiegeln keydown/keyup
// in game.keys -- in der Demo wie am Keyboard nicht (die Tasten gehoeren
// dem Autopiloten).
const touch = createTouch();
let model = null;        // Bedien-Modell des letzten Frames (Trefferzonen)
let touchHeld = new Set();
function pressKey(key) {
  if (key === KEY_MIRROR) {
    mirror = !mirror;
    try { localStorage.setItem(MIRROR_KEY, mirror ? '1' : '0'); } catch { /* egal */ }
    return;
  }
  if (key === 'M') { audio.toggleMuted(); return; }
  game.handleKey(key);
}
function syncHeld() {
  const now = heldKeys(touch);
  for (const k of now) {
    if (touchHeld.has(k)) continue;
    if (!game.demo) game.keys.add(k);
    game.handleKey(k);
  }
  for (const k of touchHeld) if (!now.has(k)) game.keys.delete(k);
  touchHeld = now;
}
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !touchMode) { touchMode = true; resize(); }
  if (!touchMode) return;
  audio.unlock(); // Autoplay-Policy: auch die Beruehrung ist eine User-Geste
  for (const k of touchDown(touch, model, e.pointerId, e.clientX, e.clientY, e.timeStamp / 1000)) pressKey(k);
  syncHeld();
  e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
  if (!touchMode) return;
  touchMove(touch, e.pointerId, e.clientX, e.clientY);
  syncHeld();
});
window.addEventListener('pointerup', (e) => {
  if (!touchMode) return;
  for (const k of touchUp(touch, model, e.pointerId, e.timeStamp / 1000)) pressKey(k);
  syncHeld();
});
window.addEventListener('pointercancel', (e) => {
  touchCancel(touch, e.pointerId);
  syncHeld();
});
// iOS/Android: kein Scrollen, Zoomen, Pull-to-Refresh auf dem "Bildschirm".
const swallow = (e) => { if (e.cancelable) e.preventDefault(); };
window.addEventListener('touchstart', swallow, { passive: false });
window.addEventListener('touchmove', swallow, { passive: false });

// Zustand fuers Bedien-Modell (reine Daten aus dem Spiel).
function touchUi() {
  const cfg = levelConfig(game.level);
  const view = game.current.viewState?.();
  const playing = game.stateKey === State.PLAYING ? view : null;
  return {
    state: game.stateKey,
    demo: game.demo,
    info: game.stateKey === State.STARTSCREEN && !!view?.info,
    shoot: !!cfg?.shoot,
    drive: !!cfg?.drive,
    active: playing ? !playing.crash && !playing.reached : true,
    reached: game.reachedGoal,
    gameOver: game.gameOver,
    hasReplay: hasRecording(game.recording),
    cams: game.engine === ENGINE_2026,
    engine: game.engine,
    arrows: selectorArrows(game),
    mirror,
  };
}

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

  // Touch-Deck ueber/unter der Welt (input/layout.js + touchDraw.js), in der
  // Farbe des Levels wie alle Beschriftung (Startscreen gruen).
  if (layout.deck) {
    model = deckModel(layout, touchUi());
    touchRenderer.color = game.stateKey === State.STARTSCREEN ? PHOSPHOR_GREEN : levelColor(game.level);
    touchRenderer.clearFrame();
    drawDeck(touchRenderer, model, padState(touch), firePressed(touch));
  } else {
    model = null;
  }

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

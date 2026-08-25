// Tests der Engine-Naht (PLAN2026.md, Stufe 0): die Wahl aus dem URL-Query
// (core/engine.js, pur) und der Render-Dispatch in game.render() -- die
// 2026-Engine haengt als injiziertes Backend dran, exakt wie audio; der
// Core beruehrt Three.js nie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEngine, ENGINES, ENGINE_1980, ENGINE_2026 } from '../src/core/engine.js';
import { Game, GameEvent } from '../src/core/game.js';
import { State } from '../src/core/states.js';

test('parseEngine: Standard ist 1980, ?engine=2026 schaltet um', () => {
  assert.equal(parseEngine(''), ENGINE_1980);
  assert.equal(parseEngine('?debug'), ENGINE_1980);
  assert.equal(parseEngine('?engine=1980'), ENGINE_1980);
  assert.equal(parseEngine('?engine=2026'), ENGINE_2026);
  assert.equal(parseEngine('?debug&engine=2026'), ENGINE_2026);
});

test('parseEngine: unbekannte Werte fallen sicher auf 1980 zurueck', () => {
  assert.equal(parseEngine('?engine=2027'), ENGINE_1980);
  assert.equal(parseEngine('?engine='), ENGINE_1980);
  assert.equal(parseEngine('?engine=Quatsch'), ENGINE_1980);
  assert.equal(ENGINES.length, 2);
});

// Renderer-Attrappe: zaehlt, ob die 1980-Zeichnung angefasst wurde.
function fakeRenderer() {
  return {
    width: 800, height: 600, calls: 0,
    beginFrame() {}, fillBlack() { this.calls++; },
    drawText() { this.calls++; }, drawPolylines() { this.calls++; },
    renderScene() { this.calls++; },
    worldToScreen() { return { x: 400, y: 300 }; },
    pushSway() {}, popSway() {}, pushShatter() {}, popShatter() {}, flash() {},
  };
}

test('Game: Engine-Standard ist 1980, klassische Zeichnung laeuft', () => {
  const game = new Game({});
  assert.equal(game.engine, ENGINE_1980);
  const r = fakeRenderer();
  game.render(r);
  assert.ok(r.calls > 0, 'Startscreen muss auf dem 1980-Renderer zeichnen');
});

test('Game: engine 2026 mit Backend -> NUR das Backend zeichnet', () => {
  const backend = { frames: [], render(g) { this.frames.push(g.stateKey); } };
  const game = new Game({ engine: ENGINE_2026, renderBackend: backend });
  const r = fakeRenderer();
  game.render(r);
  game.render(r);
  assert.deepEqual(backend.frames, ['STARTSCREEN', 'STARTSCREEN']);
  assert.equal(r.calls, 0, '1980-Renderer darf nicht angefasst werden');
  assert.equal(r.color, undefined, 'auch die Farb-Zuweisung bleibt aus');
});

test('Game: engine 2026 OHNE Backend faellt sicher auf 1980 zurueck', () => {
  const game = new Game({ engine: ENGINE_2026 });
  const r = fakeRenderer();
  game.render(r);
  assert.ok(r.calls > 0, 'ohne Backend muss die klassische Zeichnung laufen');
});

// Simuliert Spielzeit in ~16ms-Schritten (wie game.test.js, ohne Rendern --
// die Lese-Schnittstelle haengt nur an update()).
function advance(game, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) game.update(dt);
}

// Stufe 1: die Playing-Szene gibt ihren privaten Zeichen-Zustand ueber eine
// kleine Lese-Schnittstelle frei -- daraus zeichnet die 2026-Engine.
test('Playing: viewState() gibt die Ego-Lage fuer die 2026-Engine frei', () => {
  const g = new Game();
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0); // -> MazeGen -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  const view = g.current.viewState();
  assert.equal(view.maze, g.maze, 'dasselbe Maze-Objekt wie der Core');
  assert.ok(view.cell > 0 && view.unit > 0, 'Massstaebe vorhanden');
  assert.equal(view.px, g.playerState.px);
  assert.equal(view.pz, g.playerState.pz);
  assert.equal(view.yaw, g.playerState.yaw);
  assert.equal(view.reached, false);
  assert.equal(view.bump, null, 'noch keine Wand beruehrt');
});

test('Playing: Wand-Auftreffen landet als Flanke in viewState().bump', () => {
  const g = new Game();
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0);
  assert.equal(g.stateKey, State.PLAYING);

  // Stur geradeaus laufen: spaetestens an der Labyrinth-Grenze steht eine
  // Wand frontal im Weg (Blick ist beim Start achsparallel).
  g.keys.add('W');
  let view = null;
  for (let t = 0; t < 15 && !view?.bump; t += 1 / 60) {
    g.update(1 / 60);
    view = g.current.viewState();
  }
  g.keys.delete('W');

  const b = view.bump;
  assert.ok(b, 'Wand-Beruehrung wurde aufgezeichnet');
  assert.ok(b.axis === 'x' || b.axis === 'z');
  assert.ok(Math.abs(b.side) === 1, 'side ist die Anlauf-Richtung');
  assert.ok(b.impact > 0 && b.impact <= 1, 'Wucht als Anteil des Gehtempos');
  assert.ok(b.at <= view.sceneT, 'Zeitstempel liegt in der Szenenzeit');
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z), 'Ort des Auftreffens');
});

// Stufe 2: im Fahrt-Modus kommen drive/roll/pitch dazu, und die Kollisions-
// Flanke traegt den exakten Wand-Auftreffpunkt (fuer Blitz + Funken).
test('Playing (Fahrt, Level 6): viewState mit drive/roll/pitch und Auftreffpunkt', () => {
  const g = new Game();
  g.level = 6;
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0); // -> MazeGen -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  let view = g.current.viewState();
  assert.equal(view.drive, true);
  assert.ok(Number.isFinite(view.roll) && Number.isFinite(view.pitch));

  // Das Auto faehrt von selbst -- ohne Lenkung prallt es spaetestens an der
  // ersten Kurve ab (Feder-Impuls); auf die Flanke warten.
  for (let t = 0; t < 20 && !view.bump; t += 1 / 60) {
    g.update(1 / 60);
    view = g.current.viewState();
  }
  const b = view.bump;
  assert.ok(b, 'Fahrt-Aufprall wurde aufgezeichnet');
  assert.ok(Array.isArray(b.point) && b.point.every(Number.isFinite),
    'Fahrt-Flanke traegt den Wand-Auftreffpunkt');
  assert.ok(b.impact >= 0.3, 'unter minImpact gibt es keine Flanke');

  // Der Aufprall stoesst die Oszillatoren an: der Roll schwingt danach echt.
  let maxRoll = 0;
  for (let t = 0; t < 0.4; t += 1 / 60) {
    g.update(1 / 60);
    maxRoll = Math.max(maxRoll, Math.abs(g.current.viewState().roll));
  }
  assert.ok(maxRoll > 1e-4, 'rollOsc/bank erreichen die 2026-Kamera');
});

test('Game: Backend sieht auch Szenenwechsel und Transition-Zustand', () => {
  const seen = [];
  const backend = { render(g) { seen.push([g.stateKey, g.transition.active]); } };
  const game = new Game({ engine: ENGINE_2026, renderBackend: backend });
  game.render(fakeRenderer());
  game.dispatch(GameEvent.START);           // startet den Fade zum MazeGen
  game.update(0.4);                         // Halbzeit ueberschritten: Zustand gewechselt
  game.render(fakeRenderer());
  assert.equal(seen[0][0], 'STARTSCREEN');
  assert.equal(seen[1][0], 'MAZE_GEN');
  assert.equal(seen[1][1], true, 'Transition muss fuer den Fade sichtbar sein');
});

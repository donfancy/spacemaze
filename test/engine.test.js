// Tests der Engine-Naht (PLAN2026.md, Stufe 0): die Wahl aus dem URL-Query
// (core/engine.js, pur) und der Render-Dispatch in game.render() -- die
// 2026-Engine haengt als injiziertes Backend dran, exakt wie audio; der
// Core beruehrt Three.js nie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEngine, ENGINES, ENGINE_1980, ENGINE_2026 } from '../src/core/engine.js';
import { Game, GameEvent } from '../src/core/game.js';

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

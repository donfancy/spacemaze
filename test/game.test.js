// Integrationstest des Zustands-Durchlaufs OHNE Browser: ein Fake-Renderer
// ersetzt das Canvas, sodass die komplette Verdrahtung (Game + Szenen + animierte
// Uebergaenge) headless laeuft. Genau das soll auch beim spaeteren Refactoring
// stabil bleiben.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { State, GameEvent } from '../src/core/states.js';

// Renderer-Attrappe: bietet alle vom Spiel genutzten Methoden als No-Op an.
function fakeRenderer() {
  return {
    width: 800,
    height: 600,
    calls: 0,
    beginFrame() {},
    fillBlack() {},
    drawText() { this.calls++; },
    drawPolylines() { this.calls++; },
    renderScene() { this.calls++; },
  };
}

// Simuliert `seconds` Spielzeit in realistischen ~16ms-Schritten inkl. Rendern.
function advance(game, renderer, seconds, dt = 1 / 60) {
  let elapsed = 0;
  while (elapsed < seconds) {
    game.update(dt);
    renderer.beginFrame();
    game.render(renderer);
    elapsed += dt;
  }
}

test('Spiel startet im Startscreen und rendert', () => {
  const g = new Game();
  const r = fakeRenderer();
  assert.equal(g.stateKey, State.STARTSCREEN);
  advance(g, r, 0.1);
  assert.ok(r.calls > 0, 'Startscreen sollte zeichnen');
});

test('S loest animierten Uebergang zur Labyrinth-Erzeugung aus', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('X'); // irrelevante Taste -> nichts passiert
  assert.ok(!g.transition.active);

  g.handleKey('S');
  assert.ok(g.transition.active, 'Uebergang sollte starten');
  assert.equal(g.transition.toState, State.MAZE_GEN);

  // Waehrend des Uebergangs werden weitere Tasten ignoriert.
  g.handleKey('S');

  advance(g, r, 0.8); // Uebergang (0,7s) abschliessen
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.ok(!g.transition.active);
});

test('voller Zyklus Start -> MazeGen -> Playing -> Start', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('S');
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.MAZE_GEN);

  // MazeGen schaltet nach ~2s automatisch weiter.
  advance(g, r, 2.2);
  advance(g, r, 0.8); // Uebergang nach Playing
  assert.equal(g.stateKey, State.PLAYING);

  // Playing rendert die 3D-Szene.
  r.calls = 0;
  advance(g, r, 0.1);
  assert.ok(r.calls > 0);

  // Q verlaesst das Spiel zurueck zum Startscreen.
  g.handleKey('Q');
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.STARTSCREEN);
});

test('dispatch ignoriert undefinierte Uebergaenge', () => {
  const g = new Game();
  assert.equal(g.dispatch(GameEvent.EXIT), false); // im Startscreen nicht erlaubt
  assert.ok(!g.transition.active);
});

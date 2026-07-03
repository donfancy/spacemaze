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
    worldToScreen() { return { x: 400, y: 300 }; },
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

test('S leitet die Andock-Sequenz ein; erst danach Uebergang zur Labyrinth-Erzeugung', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('X'); // irrelevante Taste -> nichts passiert
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.STARTSCREEN);
  assert.ok(!g.transition.active);

  g.handleKey('S');
  // Waehrend des Andockens (~1,6s) bleibt der Zustand Startscreen, kein Uebergang.
  advance(g, r, 0.3);
  assert.equal(g.stateKey, State.STARTSCREEN);
  assert.ok(!g.transition.active);

  // Nach dem Andocken folgt der Uebergang zur Labyrinth-Erzeugung.
  advance(g, r, 2.6);
  assert.equal(g.stateKey, State.MAZE_GEN);
});

test('voller Zyklus Start -> (Andocken) -> MazeGen -> Playing -> Start', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('S');
  advance(g, r, 1.8); // Andocken (~1,6s) -> nahtlos (ohne Fade) MazeGen
  assert.equal(g.stateKey, State.MAZE_GEN);

  // MazeGen inszeniert Marker + Wachstum (~4,3s) -> Reinfallen.
  advance(g, r, 4.5);
  assert.equal(g.stateKey, State.FALLING);

  // Reinfall-Schwenk (~1,7s) -> Spielablauf.
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.PLAYING);

  // Playing rendert die 3D-Szene.
  r.calls = 0;
  advance(g, r, 0.1);
  assert.ok(r.calls > 0);

  // Q -> Rueckschwenk (nahtlos) -> Karte.
  g.handleKey('Q');
  advance(g, r, 0.1);
  assert.equal(g.stateKey, State.RISING);
  advance(g, r, 2.0);
  assert.equal(g.stateKey, State.MAP);

  // Q auf der Karte -> zurueck zum Startscreen.
  g.handleKey('Q');
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.STARTSCREEN);
});

test('Zustands-Zyklus direkt via dispatch (ohne Andocken)', () => {
  const g = new Game();
  const r = fakeRenderer();
  assert.equal(g.stateKey, State.STARTSCREEN);

  g.dispatch(GameEvent.START);
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.MAZE_GEN);

  advance(g, r, 4.5); // MazeGen -> Falling
  assert.equal(g.stateKey, State.FALLING);
  advance(g, r, 2.0); // Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);

  g.dispatch(GameEvent.EXIT);
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.RISING);
  advance(g, r, 2.0); // Rising -> Map
  assert.equal(g.stateKey, State.MAP);

  g.dispatch(GameEvent.EXIT);
  advance(g, r, 0.8);
  assert.equal(g.stateKey, State.STARTSCREEN);
});

test('Pfeiltasten waehlen das Level im Startscreen, begrenzt auf 1..5', () => {
  const g = new Game();
  assert.equal(g.level, 1);

  g.handleKey('ArrowDown'); // unter Level 1 geht es nicht
  assert.equal(g.level, 1);

  g.handleKey('ArrowRight');
  g.handleKey('ArrowUp');
  assert.equal(g.level, 3);

  for (let i = 0; i < 10; i++) g.handleKey('ArrowUp'); // oben begrenzt
  assert.equal(g.level, 5);
  g.handleKey('ArrowLeft');
  assert.equal(g.level, 4);
});

test('gewaehltes Level bestimmt die Maze-Groesse (Level 3 -> n=13)', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('ArrowUp');
  g.handleKey('ArrowUp'); // Level 3
  g.handleKey('S');
  advance(g, r, 1.8); // Andocken -> MazeGen erzeugt das Labyrinth
  assert.equal(g.stateKey, State.MAZE_GEN);
  assert.equal(g.maze.n, 13);
});

test('Pfeiltasten aendern das Level nur im Startscreen (nicht waehrend des Spiels)', () => {
  const g = new Game();
  const r = fakeRenderer();

  g.handleKey('S');
  advance(g, r, 1.8);
  assert.equal(g.stateKey, State.MAZE_GEN);
  g.handleKey('ArrowUp');
  assert.equal(g.level, 1);

  advance(g, r, 4.5 + 2.0); // -> Falling -> Playing
  assert.equal(g.stateKey, State.PLAYING);
  g.handleKey('ArrowUp');
  assert.equal(g.level, 1);
});

test('dispatch ignoriert undefinierte Uebergaenge', () => {
  const g = new Game();
  assert.equal(g.dispatch(GameEvent.EXIT), false); // im Startscreen nicht erlaubt
  assert.ok(!g.transition.active);
});

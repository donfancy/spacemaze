// Tests fuer den SUPERZAPPER (world/zapper.js): Zielauswahl im Sichtfeld
// (Kegel + Sichtlinie; Lauerer, Spikes, Pulsare bleiben), Explosionen von
// nah nach fern, gezappte Feinde sind sofort harmlos und unverwundbar --
// und die Spielregel "einer pro Leben" ueber die Spiel-Orchestrierung.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL, OPEN } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { createRng } from '../src/util/rng.js';
import { ZAPPER, zapTargets, startZap, zapStep, zapped } from '../src/world/zapper.js';
import { createEnemies, enemyHit, enemyFire } from '../src/world/enemies.js';
import { createSpinners, spinnerShotHit, spinnerPlayerHit, spinnerFire, spinnerPos } from '../src/world/spinners.js';
import { createFlippers, flipperShotHit, flipperPlayerHit, flipperDiagonal } from '../src/world/flippers.js';
import { QUARTER } from '../src/world/foePlacement.js';
import { Game, GameEvent } from '../src/core/game.js';
import { State } from '../src/core/states.js';

const THIN = { wall: 1, corridor: 5 };
const CELL = 5;

// Langer Gang in Reihe 1 (x=1..11) mit einem Seitengang bei x=1 (S/G).
function corridorMaze() {
  const n = 13;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 11; x++) grid[1][x] = OPEN;
  for (let y = 1; y <= 5; y++) grid[y][1] = OPEN;
  return { n, grid, start: [1, 5], goal: [1, 3], seed: 42, metric: createMetric(THIN) };
}

// Zellmitte (Metrik Wand 1 / Gang 5, unit 1).
const center = (g) => Math.floor(g / 2) * 6 + (g % 2 === 1 ? 3.5 : 0.5);

test('zapTargets: nur aktive Feinde im Blickkegel mit Sichtlinie, nah -> fern; Lauerer/Pulsare/Spikes bleiben', () => {
  const maze = corridorMaze();
  const unit = 1;
  const enemies = createEnemies(maze, { count: 2 }, { unit, cell: CELL, rng: createRng(3) });
  const [hunter, lurker] = enemies;
  hunter.mode = 'hunt';
  hunter.x = center(7); hunter.z = center(1);
  const spinners = createSpinners(maze, { count: 1 }, { unit, cell: CELL, rng: createRng(3) });
  const s = spinners[0];
  s.active = true; s.offset = 2; s.spike = 12;
  const flippers = createFlippers(maze, { count: 1 }, { unit, cell: CELL, rng: createRng(3) });
  const f = flippers[0];
  f.along = center(9);
  // Spieler bei x=3 im Gang, Blick nach +x (yaw -PI/2: forward = (1, 0)).
  const pose = { px: center(3), pz: center(1), yaw: -Math.PI / 2 };
  const targets = zapTargets(maze, pose, { enemies, spinners, flippers }, { unit });
  const kinds = targets.map((t) => t.kind);
  assert.ok(kinds.includes('enemy') && kinds.includes('flipper') && kinds.includes('spinner'),
    `Jaeger, Flipper und Spinner-Koerper sind Ziele (${kinds})`);
  assert.ok(!targets.some((t) => t.foe === lurker), 'der Lauerer auf der Krone nicht');
  for (let i = 1; i < targets.length; i++) assert.ok(targets[i].dist >= targets[i - 1].dist, 'nah -> fern');
  assert.equal(targets[0].foe, hunter, 'der Jaeger bei x=7 ist am naechsten');
  // Hinter dem Ruecken (Blick nach -x): der Jaeger faellt raus.
  const back = zapTargets(maze, { ...pose, yaw: Math.PI / 2 }, { enemies, spinners, flippers }, { unit });
  assert.ok(!back.some((t) => t.foe === hunter), 'hinter dem Ruecken kein Ziel');
  // Ohne Sichtlinie (Spieler im Seitengang um die Ecke, Blick nach +x): nichts.
  const corner = zapTargets(maze, { px: center(1), pz: center(5), yaw: -Math.PI / 2 }, { enemies, spinners, flippers }, { unit });
  assert.equal(corner.length, 0, 'durch die Wand wird nicht gezappt');
  // Schon gezappte Feinde sind keine Ziele mehr.
  hunter.zapAt = 1;
  assert.ok(!zapTargets(maze, pose, { enemies, spinners, flippers }, { unit }).some((t) => t.foe === hunter));
});

test('startZap/zapStep: Explosionen nah -> fern mit stagger, bis dahin entschaerft und unverwundbar', () => {
  const maze = corridorMaze();
  const unit = 1;
  const radius = 0.25 * CELL;
  const enemies = createEnemies(maze, { count: 1 }, { unit, cell: CELL, rng: createRng(3) });
  const e = enemies[0];
  e.mode = 'hunt'; e.x = center(5); e.z = center(1);
  const flippers = createFlippers(maze, { count: 1 }, { unit, cell: CELL, rng: createRng(3) });
  const f = flippers[0];
  f.along = center(7); f.mode = 'hold'; f.angle = QUARTER; f.hold = 10;
  const spinners = createSpinners(maze, { count: 1 }, { unit, cell: CELL, rng: createRng(3) });
  const s = spinners[0];
  s.active = true; s.offset = 6; s.spike = 6; // exponiert an der Spitze
  const pose = { px: center(3), pz: center(1), yaw: -Math.PI / 2 };
  const targets = zapTargets(maze, pose, { enemies, spinners, flippers }, { unit });
  assert.equal(targets.length, 3);
  const queue = startZap(targets, 10);
  assert.deepEqual(queue.map((q) => q.at), [10, 10 + ZAPPER.stagger, 10 + 2 * ZAPPER.stagger]);
  assert.ok([e, f, s].every(zapped));
  assert.ok([e, f, s].every((x) => x.alive), 'noch lebendig (sichtbar) bis zur Explosion');
  // Entschaerft: kein Rammen, kein Feuer, keine toedliche Ebene, kein Koerper-Treffer ...
  assert.equal(enemyHit(enemies, e.x, e.z, CELL), null);
  assert.equal(enemyFire(enemies, [], 1, () => 0, { px: center(9), pz: center(1) }, CELL).length, 0);
  assert.equal(flipperPlayerHit(flippers, f.along, f.cross, radius, CELL), null);
  const [sx, sz] = spinnerPos(s);
  assert.equal(spinnerPlayerHit(spinners, sx + radius, sz, radius, CELL), null, 'gezappter Koerper harmlos');
  assert.equal(spinnerFire(spinners, [], 1, () => 0, { px: center(11), pz: center(1), yaw: Math.PI / 2 }, CELL).length, 0);
  // ... und unverwundbar (Schuesse gehen durch): Flipper seitlich, Spinner-Koerper.
  const q = f.cross + (0.5 - 0.16) * CELL;
  assert.equal(flipperShotHit(flippers, f.along, q, CELL), null);
  assert.equal(flipperDiagonal(f), false);
  assert.equal(spinnerShotHit(spinners, sx, sz, CELL)?.type ?? null, 'spike', 'am Koerper nur noch der Spike');
  // Der SPIKE bleibt eine Sperre (er wird nicht gezappt).
  const tip = s.spike;
  const at = (t) => ({ px: s.wall + s.dir * t, pz: s.cross });
  const b = at(tip + radius - 0.2);
  assert.ok(spinnerPlayerHit(spinners, b.px, b.pz, radius, CELL, at(tip + radius + 1))?.impale, 'Spitze spiesst weiter auf');
  // Explosionen der Reihe nach.
  assert.deepEqual(zapStep(queue, 10).map((d) => d.foe), [e]);
  assert.equal(e.alive, false);
  assert.ok(f.alive && s.alive);
  assert.deepEqual(zapStep(queue, 10 + ZAPPER.stagger + 1e-9).map((d) => d.foe), [f]);
  assert.deepEqual(zapStep(queue, 11).map((d) => d.foe), [s]);
  assert.equal(queue.length, 0);
  assert.ok(![e, f, s].some((x) => x.alive));
  assert.ok(s.spike > 0, 'der Spike steht noch');
});

// Spiel-Orchestrierung: einer pro Anlauf.
function advance(game, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) game.update(dt);
}

test('Superzapper im Spiel: Z zappt einmal pro Anlauf, Feind-Schuesse erloeschen, Retry laedt nach, Resume nicht', () => {
  const g = new Game();
  g.level = 11;
  g.dispatch(GameEvent.START);
  advance(g, 0.8 + 4.5 + 2.0);
  assert.equal(g.stateKey, State.PLAYING);
  assert.equal(g.zapper, true, 'frischer Anlauf: Zapper geladen');
  const view0 = g.current.viewState();
  assert.equal(view0.zapper, true, 'viewState traegt die Verfuegbarkeit (HUD)');

  // Alle anderen Feinde stilllegen (das zufaellige Maze soll den Spieler
  // nicht nebenbei erschiessen), einen Jaeger direkt vor den Spieler
  // stellen (im Blick, mit Sichtlinie).
  for (const e of g.enemies) e.alive = false;
  const foe = g.enemies[0];
  foe.alive = true;
  const p = g.playerState;
  foe.mode = 'hunt';
  foe.min = -Infinity; foe.max = Infinity; // (die Jagd klemmt ihn sonst in seine Alley zurueck)
  foe.x = p.px - Math.sin(p.yaw) * 1.5 * view0.cell;
  foe.z = p.pz - Math.cos(p.yaw) * 1.5 * view0.cell;
  g.current.viewState().foeShots.push({ axis: 'x', dir: 1, wall: 0, cross: 0, runLen: 99, t: 1, prevT: 1, phase: 1 });
  g.handleKey('Z');
  assert.equal(g.zapper, false, 'verbraucht');
  assert.ok(zapped(foe), 'der Jaeger ist gezappt');
  assert.equal(g.current.viewState().foeShots.length, 0, 'Feind-Schuesse sofort weg');
  const view1 = g.current.viewState();
  assert.ok(view1.zap && view1.zap.t >= 0, 'Blitz laeuft');
  advance(g, 0.5);
  assert.equal(foe.alive, false, 'nach dem Versatz explodiert');
  assert.equal(g.gameOver, false, 'der gezappte Jaeger hat den Spieler nicht gerammt');
  // Zweites Z: nichts mehr.
  const other = g.enemies[1];
  other.alive = true;
  other.mode = 'hunt';
  other.min = -Infinity; other.max = Infinity;
  other.x = foe.x; other.z = foe.z;
  g.handleKey('Y');
  assert.equal(zapped(other), false, 'kein zweiter Zap in diesem Anlauf');
  other.alive = false; // (sonst rammt er gleich)

  // Zur Karte und zurueck (Resume): verbraucht bleibt verbraucht.
  g.handleKey('X');
  advance(g, 3);
  assert.equal(g.stateKey, State.MAP);
  g.handleKey('S');
  advance(g, 2.5);
  assert.equal(g.stateKey, State.PLAYING);
  assert.equal(g.zapper, false, 'Resume: derselbe Anlauf, kein Nachladen');
  // Crash -> Retry: neues Leben, Zapper geladen.
  const ram = g.enemies.find((e) => e.alive) ?? g.enemies[0];
  ram.alive = true; ram.mode = 'hunt'; ram.zapAt = null;
  ram.min = -Infinity; ram.max = Infinity;
  ram.x = g.playerState.px; ram.z = g.playerState.pz;
  advance(g, 0.1);
  assert.equal(g.gameOver, true);
  advance(g, 1.4 + 1.0);
  assert.equal(g.stateKey, State.MAP);
  g.handleKey('S');
  advance(g, 2.5);
  assert.equal(g.stateKey, State.PLAYING);
  assert.equal(g.zapper, true, 'Retry = neues Leben: Zapper nachgeladen');
});

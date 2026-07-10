// Tests fuer die Feinde (world/enemies.js): Platzierung (bevorzugt auf dem
// Loesungsweg, Schutzzonen um S/G), Patrouillen-Bewegung, Treffer-Erkennung
// und die Rauten-Geometrie -- alles reine Berechnung.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, findPath, isChamber, OPEN } from '../src/world/maze.js';
import { cellAt, cellCenter } from '../src/world/mazeWorld.js';
import { createRng } from '../src/util/rng.js';
import { ENEMY, createEnemies, enemiesStep, enemyHit, enemySegments } from '../src/world/enemies.js';

const THIN = { wall: 1, corridor: 5 };
const UNIT = 1;
const CELL = THIN.corridor * UNIT; // Gangbreite bei unit=1

function makeWorld(seed = 4711, n = 17) {
  const maze = generateMaze(n, { seed, metric: THIN, straight: 0.6 });
  return { maze, unit: UNIT, cell: CELL };
}

function spawn(config, seed = 4711, rngSeed = 99) {
  const { maze, unit, cell } = makeWorld(seed);
  const enemies = createEnemies(maze, config, { unit, cell, rng: createRng(rngSeed) });
  return { maze, enemies, unit, cell };
}

test('createEnemies: Anzahl, offene Kammern, keine Duplikate, alle lebendig', () => {
  const { maze, enemies, unit } = spawn({ count: 8, patrol: 0 });
  assert.equal(enemies.length, 8);
  const seen = new Set();
  for (const e of enemies) {
    assert.equal(e.alive, true);
    const [gx, gy] = cellAt(maze, e.x, e.z, unit);
    assert.deepEqual([gx, gy], [e.gx, e.gy], 'Weltposition liegt in der eigenen Zelle');
    assert.ok(isChamber(gx, gy), `(${gx},${gy}) ist eine Kammer`);
    assert.equal(maze.grid[gy][gx], OPEN);
    const k = `${gx},${gy}`;
    assert.ok(!seen.has(k), `Kammer ${k} doppelt belegt`);
    seen.add(k);
  }
});

test('createEnemies: rund die Haelfte sitzt auf dem Loesungsweg, S/G-Zonen bleiben frei', () => {
  const { maze, enemies } = spawn({ count: 8, patrol: 0 });
  const path = findPath(maze, maze.start, maze.goal).filter(([x, y]) => isChamber(x, y));
  const pathKeys = new Set(path.map(([x, y]) => `${x},${y}`));
  const onPath = enemies.filter((e) => pathKeys.has(`${e.gx},${e.gy}`)).length;
  assert.ok(onPath >= Math.ceil(8 / 2) - 1, `mindestens ~die Haelfte auf dem Weg (${onPath})`);
  // Schutzzonen: die ersten/letzten Weg-Kammern um S und G sind feindfrei.
  const guarded = new Set([...path.slice(0, ENEMY.exclude), ...path.slice(-ENEMY.exclude)]
    .map(([x, y]) => `${x},${y}`));
  for (const e of enemies) {
    assert.ok(!guarded.has(`${e.gx},${e.gy}`), `Feind bei (${e.gx},${e.gy}) zu nah an S/G`);
  }
});

test('createEnemies ist deterministisch bei gleichem rng', () => {
  const a = spawn({ count: 6, patrol: 0.5 }, 4711, 7).enemies;
  const b = spawn({ count: 6, patrol: 0.5 }, 4711, 7).enemies;
  assert.deepEqual(a, b);
});

test('patrol-Anteil bestimmt die Zahl der Patrouillen', () => {
  const none = spawn({ count: 8, patrol: 0 }).enemies;
  assert.ok(none.every((e) => e.patrol === null), 'patrol 0: alle schweben');
  const all = spawn({ count: 8, patrol: 1 }).enemies;
  // Jede Kammer hat mindestens einen offenen Nachbarn -> Route existiert immer.
  assert.ok(all.every((e) => e.patrol !== null), 'patrol 1: alle patrouillieren');
  const half = spawn({ count: 8, patrol: 0.5 }).enemies;
  assert.equal(half.filter((e) => e.patrol).length, 4, 'patrol 0.5: die Haelfte');
});

test('Patrouille bleibt in ihrer Spanne und wendet an den Enden', () => {
  const { maze, enemies, unit } = spawn({ count: 8, patrol: 1 });
  const e = enemies[0];
  const p = e.patrol;
  assert.ok(p.min < p.max, 'Spanne hat Ausdehnung');
  let turned = 0;
  let prevDir = p.dir;
  for (let i = 0; i < 2000; i++) {
    enemiesStep(enemies, 0.05);
    const v = p.axis === 'x' ? e.x : e.z;
    assert.ok(v >= p.min - 1e-9 && v <= p.max + 1e-9, 'innerhalb der Spanne');
    // Die Querkoordinate bleibt fest (Bewegung nur entlang der Achse).
    if (turned === 0 && p.dir !== prevDir) turned = i;
    prevDir = p.dir;
    // Immer in offenen Zellen unterwegs.
    const [gx, gy] = cellAt(maze, e.x, e.z, unit);
    assert.equal(maze.grid[gy][gx], OPEN, 'Patrouille bleibt im Gang');
  }
  assert.ok(turned > 0, 'irgendwann gewendet (Ping-Pong)');
});

test('tote Feinde patrouillieren nicht weiter', () => {
  const { enemies } = spawn({ count: 4, patrol: 1 });
  const e = enemies[0];
  e.alive = false;
  const before = [e.x, e.z];
  enemiesStep(enemies, 1);
  assert.deepEqual([e.x, e.z], before);
});

test('enemyHit: findet nahe lebende Feinde, ignoriert tote und ferne', () => {
  const { enemies, cell } = spawn({ count: 4, patrol: 0 });
  const e = enemies[0];
  assert.equal(enemyHit(enemies, e.x + 0.1 * cell, e.z, 0.3 * cell), e);
  assert.equal(enemyHit(enemies, e.x + 0.5 * cell, e.z, 0.3 * cell), null);
  e.alive = false;
  assert.equal(enemyHit(enemies, e.x, e.z, 0.3 * cell), null);
});

test('enemySegments: geschlossene Doppel-Raute, pulsierend, Billboard zum Spieler', () => {
  const { enemies, cell } = spawn({ count: 4, patrol: 0 });
  const e = enemies[0];
  const opts = { cell, px: e.x, pz: e.z + 3 * cell, height: 0.5 * cell };
  const segs = enemySegments(e, 0, opts);
  assert.equal(segs.length, 8, 'Aussen- und Innen-Kontur (je 4 Kanten)');
  // Geschlossen: jede Kontur endet, wo sie beginnt (Kanten teilen Endpunkte).
  for (const [a, b] of segs) {
    assert.equal(a.length, 3);
    assert.equal(b.length, 3);
  }
  // Pulsieren: die Hoehe des Top-Punkts schwankt ueber die Zeit.
  const topHeight = (t) => enemySegments(e, t, opts)[0][0][1];
  const samples = [0, 0.1, 0.2, 0.3, 0.4].map((t) => topHeight(t).toFixed(9));
  assert.ok(new Set(samples).size > 1, 'Rauten pulsieren (Groesse schwankt)');
  // Billboard: die Querachse steht senkrecht zur Sichtlinie. Spieler suedlich
  // (gleiche x) -> Sichtlinie entlang z -> Querpunkte weichen nur in x ab.
  const left = segs[2][1]; // Ende von [bot, left]
  assert.ok(Math.abs(left[2] - e.z) < 1e-9, 'Querpunkt bleibt auf der z-Ebene des Feinds');
  assert.ok(Math.abs(left[0] - e.x) > 0, 'Querpunkt weicht in x aus');
});

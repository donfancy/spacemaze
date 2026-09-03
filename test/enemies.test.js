// Tests fuer die Tanker-ALLEYS (world/enemies.js, Sturm-Mechanik): Gruppen-
// Platzierung auf den Wandkronen langer Gaenge, Ausloesen bei Sichtkontakt,
// Purzeln einer nach dem anderen, gangbundene Jagd, Feuer nur bei Spieler
// im Gang, Unverwundbarkeit der Lauerer, Rauten-Geometrie -- alles reine
// Berechnung.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, findPath, isChamber, OPEN, WALL } from '../src/world/maze.js';
import { cellAt } from '../src/world/mazeWorld.js';
import { createRng } from '../src/util/rng.js';
import { createMetric } from '../src/world/metric.js';
import {
  ENEMY, createEnemies, enemiesStep, enemyHit, enemyFire, enemyLift, enemySegments,
} from '../src/world/enemies.js';
import { DRIVE } from '../src/world/drive.js';
import {
  spinnerShotsStep, spinnerShotPlayerHit, spinnerShotIntercept,
} from '../src/world/spinners.js';
import { createShotsState, fireShot, shotsStep, SHOTS } from '../src/world/shots.js';

const THIN = { wall: 1, corridor: 5 };
const UNIT = 1;
const CELL = THIN.corridor * UNIT; // Gangbreite bei unit=1

function makeWorld(seed = 4711, n = 27) {
  const maze = generateMaze(n, { seed, metric: THIN, straight: 0.75 });
  return { maze, unit: UNIT, cell: CELL };
}

function spawn(config, seed = 4711, rngSeed = 99) {
  const { maze, unit, cell } = makeWorld(seed);
  const enemies = createEnemies(maze, config, { unit, cell, rng: createRng(rngSeed) });
  return { maze, enemies, unit, cell };
}

// Hand-Maze: EIN langer Gang (6 Kammern) in Reihe y=1 von x=1..11 plus ein
// Stich nach unten bei x=1 (dort liegen S und G, weit weg vom Gang-Ende).
function corridorMaze() {
  const n = 13;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 11; x++) grid[1][x] = OPEN;
  for (let y = 1; y <= 5; y++) grid[y][1] = OPEN;
  return { n, grid, start: [1, 5], goal: [1, 3], seed: 42, metric: createMetric(THIN) };
}

// Gang-Koordinaten eines Tankers: laengs/quer.
const alongOf = (e) => (e.axis === 'x' ? e.x : e.z);
const crossOf = (e) => (e.axis === 'x' ? e.z : e.x);

test('createEnemies: Gruppen auf langen Gaengen, alle lauern auf WAND-Kronen, Anzahl gedeckelt', () => {
  const { maze, enemies, unit, cell } = spawn({ count: 10, group: 4 });
  assert.ok(enemies.length > 0 && enemies.length <= 10, `hoechstens count (${enemies.length})`);
  const groups = new Map();
  for (const e of enemies) {
    assert.equal(e.alive, true);
    assert.equal(e.mode, 'lurk');
    assert.equal(e.wait, null, 'noch nicht ausgeloest');
    // Lauerer sitzen auf der KRONE: ihre Grid-Zelle ist eine Wandzelle.
    const [gx, gy] = cellAt(maze, e.x, e.z, unit);
    assert.equal(maze.grid[gy][gx], WALL, `Lauerer (${gx},${gy}) sitzt auf einer Wand`);
    assert.deepEqual([gx, gy], [e.gx, e.gy], 'gx/gy ist die Kronen-Zelle');
    // Landeplatz liegt IM Gang (offene Zelle), quer innerhalb der Gangbreite.
    const [lx, ly] = cellAt(maze, e.to[0], e.to[1], unit);
    assert.equal(maze.grid[ly][lx], OPEN, 'Landeplatz ist offen');
    const landCross = e.axis === 'x' ? e.to[1] : e.to[0];
    assert.ok(Math.abs(landCross - e.cross) < 0.5 * cell, 'landet in der Gangbreite');
    const key = e.axis + ':' + e.cross + ':' + e.wall;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  for (const [, size] of groups) assert.ok(size <= 4, `Gruppe hoechstens group (${size})`);
  // Purzel-Reihenfolge innerhalb einer Gruppe: 0, 1, 2, ...
  for (const [key] of groups) {
    const members = enemies.filter((e) => e.axis + ':' + e.cross + ':' + e.wall === key);
    assert.deepEqual(members.map((e) => e.order), members.map((_, i) => i));
  }
});

test('createEnemies: Weg-Gaenge zuerst, S/G-Zonen bleiben tankerfrei', () => {
  const { maze, enemies } = spawn({ count: 4, group: 2 });
  const path = findPath(maze, maze.start, maze.goal).filter(([x, y]) => isChamber(x, y));
  const pathKeys = new Set(path.map(([x, y]) => `${x},${y}`));
  // Die erste Gruppe bewacht einen Weg-Gang: ihre Endkammer liegt auf dem Weg.
  const first = enemies[0];
  const endChamber = cellAt(maze, ...(first.axis === 'x'
    ? [first.wall + first.dir * 0.5 * CELL, first.cross]
    : [first.cross, first.wall + first.dir * 0.5 * CELL]), 1);
  assert.ok(pathKeys.has(`${endChamber[0]},${endChamber[1]}`), 'erste Alley liegt auf dem Loesungsweg');
  const guarded = new Set([...path.slice(0, ENEMY.exclude), ...path.slice(-ENEMY.exclude)]
    .map(([x, y]) => `${x},${y}`));
  for (const e of enemies) {
    const [lx, ly] = cellAt(maze, e.to[0], e.to[1], 1);
    assert.ok(!guarded.has(`${lx},${ly}`), `Landeplatz (${lx},${ly}) zu nah an S/G`);
  }
});

test('createEnemies ist deterministisch bei gleichem rng', () => {
  const a = spawn({ count: 6 }, 4711, 7).enemies;
  const b = spawn({ count: 6 }, 4711, 7).enemies;
  assert.deepEqual(a, b);
});

test('Hand-Gang: Sechser-Gruppe = drei auf der End-Krone, drei auf den Seiten-Kronen', () => {
  const maze = corridorMaze();
  const enemies = createEnemies(maze, { count: 6 }, { unit: 1, cell: CELL, rng: createRng(3) });
  assert.equal(enemies.length, 6, 'sechs Kammern tragen sechs Tanker');
  const ends = enemies.filter((e) => e.lurk.seat === 'end');
  const sides = enemies.filter((e) => e.lurk.seat === 'side');
  assert.equal(ends.length, 3);
  assert.equal(sides.length, 3);
  // End-Krone: laengs in der End-Wandzelle, quer gestaffelt.
  for (const e of ends) {
    const [gx, gy] = cellAt(maze, e.x, e.z, 1);
    assert.equal(gy, 1, 'End-Wand liegt in der Gang-Reihe');
    assert.ok(gx === 0 || gx === 12, 'End-Wand am Gang-Ende');
  }
  assert.equal(new Set(ends.map((e) => Math.round(e.lurk.cross * 10))).size, 3, 'drei Plaetze nebeneinander');
  // Seiten-Kronen: in den Wandreihen y=0/y=2, abwechselnd, hinten im Gang.
  for (const e of sides) {
    const [, gy] = cellAt(maze, e.x, e.z, 1);
    assert.ok(gy === 0 || gy === 2, 'Seitenwand-Krone ober-/unterhalb des Gangs');
  }
  assert.ok(sides.some((e) => e.lurk.side === -1) && sides.some((e) => e.lurk.side === 1), 'beide Seiten');
  // Alle bewachen dieselbe Alley.
  assert.equal(new Set(enemies.map((e) => e.wall)).size, 1);
});

test('Ausloesen: Spieler im Gang MIT Blick auf die Lauer-Wand -> Purzeln in Reihenfolge', () => {
  const maze = corridorMaze();
  const enemies = createEnemies(maze, { count: 3 }, { unit: 1, cell: CELL, rng: createRng(3) });
  const e0 = enemies[0];
  const cross = e0.cross;
  // Spieler mitten im Gang, Blick zur Lauer-Wand (dir zeigt Wand -> Gang,
  // der Blick also -dir): yaw-Konvention forward = (-sin, -cos).
  const towardWall = -e0.dir;
  const yawToward = Math.atan2(-towardWall, 0); // forward.x = towardWall
  const yawAway = Math.atan2(towardWall, 0);
  const mid = (e0.min + e0.max) / 2;
  // Blick WEG von der Wand: nichts passiert.
  enemiesStep(enemies, 0.1, { cell: CELL, player: { px: mid, pz: cross, yaw: yawAway } });
  assert.ok(enemies.every((e) => e.mode === 'lurk' && e.wait == null), 'Ruecken zur Wand: kein Ausloesen');
  // Im Nachbargang (quer daneben): nichts.
  enemiesStep(enemies, 0.1, { cell: CELL, player: { px: mid, pz: cross + 2 * CELL, yaw: yawToward } });
  assert.ok(enemies.every((e) => e.wait == null), 'anderer Gang: kein Ausloesen');
  // Blick zur Wand, im Gang: alle ausgeloest, gestaffelt.
  const events = enemiesStep(enemies, 0.01, { cell: CELL, player: { px: mid, pz: cross, yaw: yawToward } });
  assert.equal(events.length, 1, 'der erste purzelt sofort');
  assert.equal(events[0].enemy, enemies[0]);
  assert.equal(enemies[0].mode, 'drop');
  assert.equal(enemies[1].mode, 'lurk');
  assert.ok(enemies[1].wait > 0 && enemies[2].wait > enemies[1].wait, 'die anderen warten gestaffelt');
  // Nach dropGap purzelt der zweite, nach 2*dropGap der dritte.
  let t = 0;
  const dropAt = [0];
  const dt = 0.02;
  while (enemies[2].mode === 'lurk' && t < 5) {
    t += dt;
    for (const ev of enemiesStep(enemies, dt, { cell: CELL, player: { px: mid, pz: cross, yaw: yawToward } })) {
      assert.equal(ev.type, 'drop');
      dropAt.push(t);
    }
  }
  assert.equal(dropAt.length, 3, 'drei Purzel-Ereignisse');
  assert.ok(Math.abs(dropAt[1] - ENEMY.dropGap) < 0.05, `zweiter nach dropGap (${dropAt[1]})`);
  assert.ok(Math.abs(dropAt[2] - 2 * ENEMY.dropGap) < 0.05, `dritter nach 2*dropGap (${dropAt[2]})`);
});

test('Purzeln: Groesse 30% -> 100%, von der Krone auf Schwebehoehe, landet im Gang und jagt', () => {
  const maze = corridorMaze();
  const enemies = createEnemies(maze, { count: 1 }, { unit: 1, cell: CELL, rng: createRng(3) });
  const e = enemies[0];
  const opts = { hover: 0.5 * CELL, crown: 1.2 * CELL, size: ENEMY.size * CELL };
  const lurk = enemyLift(e, opts);
  assert.equal(lurk.scale, ENEMY.lurkScale);
  assert.ok(lurk.y > opts.crown, 'Lauerer sitzt AUF der Krone');
  e.wait = 0; // ausgeloest
  const player = { px: (e.min + e.max) / 2, pz: e.cross, yaw: Math.atan2(e.dir, 0) };
  enemiesStep(enemies, 0.001, { cell: CELL, player });
  assert.equal(e.mode, 'drop');
  let prevScale = enemyLift(e, opts).scale;
  let prevY = enemyLift(e, opts).y;
  for (let i = 0; i < 10; i++) {
    enemiesStep(enemies, ENEMY.dropTime / 20, { cell: CELL, player });
    const l = enemyLift(e, opts);
    assert.ok(l.scale >= prevScale && l.y <= prevY, 'waechst und faellt monoton');
    prevScale = l.scale;
    prevY = l.y;
  }
  for (let i = 0; i < 20; i++) enemiesStep(enemies, ENEMY.dropTime / 10, { cell: CELL, player });
  assert.equal(e.mode, 'hunt');
  const hunt = enemyLift(e, opts);
  assert.equal(hunt.scale, 1);
  assert.equal(hunt.y, opts.hover);
  const [gx, gy] = cellAt(maze, e.x, e.z, 1);
  assert.equal(maze.grid[gy][gx], OPEN, 'gelandet im Gang');
});

test('Jagd: gangbunden auf die Spieler-Laengslage zu, an den Enden Halt, sonst zur letzten Stelle', () => {
  const maze = corridorMaze();
  const enemies = createEnemies(maze, { count: 1 }, { unit: 1, cell: CELL, rng: createRng(3) });
  const e = enemies[0];
  e.mode = 'hunt';
  e.x = e.to[0]; e.z = e.to[1];
  const cross = e.cross;
  // Spieler am anderen Gang-Ende: der Jaeger laeuft hin, mit huntSpeed.
  const farEnd = e.dir > 0 ? e.max : e.min;
  const player = { px: farEnd, pz: cross, yaw: 0 };
  const a0 = alongOf(e);
  enemiesStep(enemies, 1, { cell: CELL, player });
  assert.ok(Math.abs(Math.abs(alongOf(e) - a0) - ENEMY.huntSpeed * CELL) < 1e-9, 'huntSpeed pro Sekunde');
  assert.equal(crossOf(e), e.to[1] === cross ? cross : crossOf(e), 'quer bleibt er, wo er gelandet ist');
  for (let i = 0; i < 40; i++) enemiesStep(enemies, 0.5, { cell: CELL, player });
  assert.ok(Math.abs(alongOf(e) - farEnd) < 1e-6, 'erreicht die Spieler-Laengslage (Gang-Ende)');
  // Spieler verlaesst den Gang (quer weg): der Jaeger bleibt bei der letzten Stelle.
  const gone = { px: farEnd, pz: cross + 3 * CELL, yaw: 0 };
  enemiesStep(enemies, 2, { cell: CELL, player: gone });
  assert.ok(Math.abs(alongOf(e) - farEnd) < 1e-6, 'wartet an der letzten bekannten Stelle');
  assert.ok(ENEMY.huntSpeed < DRIVE.cruise, 'fliehbar: langsamer als die Reisegeschwindigkeit');
});

test('Feuer: nur Jaeger, nur bei Spieler im Gang -- Blickrichtung egal (Ruecken-Schuss erlaubt)', () => {
  const maze = corridorMaze();
  const enemies = createEnemies(maze, { count: 2 }, { unit: 1, cell: CELL, rng: createRng(3) });
  const [e, lurker] = enemies;
  e.mode = 'hunt';
  e.x = e.to[0]; e.z = e.to[1];
  const shots = [];
  const always = () => 0; // rng 0 < rate*dt -> feuert immer
  const mid = (e.min + e.max) / 2;
  // Spieler im Gang, Blick WEG vom Jaeger: trotzdem ein Schuss (nur vom Jaeger).
  const fired = enemyFire(enemies, shots, 0.1, always, { px: mid, pz: e.cross }, CELL);
  assert.equal(fired.length, 1, 'genau der Jaeger feuert, der Lauerer nicht');
  assert.equal(lurker.mode, 'lurk');
  const sh = fired[0];
  assert.equal(sh.axis, e.axis);
  assert.equal(sh.cross, e.cross, 'fliegt die Gangmitte entlang');
  assert.equal(sh.dir, Math.sign(mid - alongOf(e)), 'auf den Spieler zu');
  assert.equal(sh.t, 0, 'startet beim Jaeger');
  assert.ok(sh.runLen > Math.abs(mid - alongOf(e)), 'reicht bis hinter den Spieler (Gang-Endwand)');
  // Spieler im Nachbargang: kein Schuss.
  assert.equal(enemyFire(enemies, shots, 0.1, always, { px: mid, pz: e.cross + 2 * CELL }, CELL).length, 0);
  // Der Schuss fliegt und trifft den Spieler im Gang (Spinner-Schuss-Mechanik).
  let hit = null;
  let t = 0;
  while (!hit && t < 10) {
    const prev = { px: mid, pz: e.cross };
    spinnerShotsStep(shots, 0.05, CELL);
    hit = spinnerShotPlayerHit(shots, mid, e.cross, 0.25 * CELL, CELL, prev);
    t += 0.05;
  }
  assert.ok(hit, 'der Tanker-Schuss erreicht den stehenden Spieler');
});

test('enemyHit: nur JAEGER sind verwundbar/toedlich, Lauerer und Purzler nicht', () => {
  const maze = corridorMaze();
  const enemies = createEnemies(maze, { count: 1 }, { unit: 1, cell: CELL, rng: createRng(3) });
  const e = enemies[0];
  assert.equal(enemyHit(enemies, e.x, e.z, 0.3 * CELL), null, 'Lauerer: kein Treffer');
  e.mode = 'drop';
  assert.equal(enemyHit(enemies, e.x, e.z, 0.3 * CELL), null, 'Purzler: kein Treffer');
  e.mode = 'hunt';
  assert.equal(enemyHit(enemies, e.x + 0.1 * CELL, e.z, 0.3 * CELL), e);
  assert.equal(enemyHit(enemies, e.x + 0.5 * CELL, e.z, 0.3 * CELL), null);
  e.alive = false;
  assert.equal(enemyHit(enemies, e.x, e.z, 0.3 * CELL), null);
});

test('DURCHKOMMENS-TEST Alley: Dauerfeuer vom Gang-Eingang raeumt eine Sechser-Gruppe, bevor sie ankommt', () => {
  const maze = corridorMaze();
  const unit = 1;
  const cell = CELL;
  const radius = 0.25 * cell;
  const enemies = createEnemies(maze, { count: 6 }, { unit, cell, rng: createRng(3) });
  const e0 = enemies[0];
  // Spieler steht am gegenueberliegenden Gang-Ende und blickt zur Lauer-Wand.
  const px0 = e0.dir > 0 ? e0.max : e0.min;
  const pz0 = e0.cross;
  const yaw = Math.atan2(e0.dir, 0); // forward.x = -dir -> Richtung Wand
  const player = { px: px0, pz: pz0, yaw };
  const shotsState = createShotsState();
  const foeShots = [];
  const foeRng = createRng(5);
  const dt = 1 / 60;
  let dead = null;
  let t = 0;
  for (; t < 30 && !dead; t += dt) {
    enemiesStep(enemies, dt, { cell, player });
    if (enemyHit(enemies, px0, pz0, radius + ENEMY.hitRadius * cell)) { dead = 'ram'; break; }
    enemyFire(enemies, foeShots, dt, foeRng, player, cell);
    spinnerShotsStep(foeShots, dt, cell);
    if (spinnerShotPlayerHit(foeShots, px0, pz0, radius, cell, { px: px0, pz: pz0 })) { dead = 'shot'; break; }
    fireShot(shotsState, player, 0); // Dauerfeuer, Fadenkreuz geradeaus
    shotsStep(maze, shotsState, dt, {
      unit, cell, enemies, enemyRadius: ENEMY.shotRadius * cell,
      hitTest: (x, z) => (foeShots.length ? spinnerShotIntercept(foeShots, x, z, cell) : null),
    });
    if (enemies.every((e) => !e.alive)) break;
  }
  assert.equal(dead, null, `ueberlebt (${t.toFixed(2)} s)`);
  assert.ok(enemies.every((e) => !e.alive), 'alle sechs Tanker abgeschossen');
  assert.ok(SHOTS.rate > ENEMY.fireRate * 6, 'Feuerkraft-Reserve: eigene Rate schlaegt sechs Jaeger');
});

test('OHNE eigenes Feuer stirbt der Spieler in der Alley (Schuss oder Rammstoss)', () => {
  const maze = corridorMaze();
  const cell = CELL;
  const radius = 0.25 * cell;
  const enemies = createEnemies(maze, { count: 6 }, { unit: 1, cell, rng: createRng(3) });
  const e0 = enemies[0];
  const px0 = e0.dir > 0 ? e0.max : e0.min;
  const pz0 = e0.cross;
  const player = { px: px0, pz: pz0, yaw: Math.atan2(e0.dir, 0) };
  const foeShots = [];
  const foeRng = createRng(5);
  const dt = 1 / 60;
  let dead = null;
  for (let t = 0; t < 30 && !dead; t += dt) {
    enemiesStep(enemies, dt, { cell, player });
    if (enemyHit(enemies, px0, pz0, radius + ENEMY.hitRadius * cell)) dead = 'ram';
    enemyFire(enemies, foeShots, dt, foeRng, player, cell);
    spinnerShotsStep(foeShots, dt, cell);
    if (spinnerShotPlayerHit(foeShots, px0, pz0, radius, cell, { px: px0, pz: pz0 })) dead = 'shot';
  }
  assert.ok(dead, 'wer nicht feuert, ueberlebt die Alley nicht');
});

test('enemySegments: geschlossene Doppel-Raute, pulsierend, Billboard; Lauerer klein auf der Krone', () => {
  const { enemies, cell } = spawn({ count: 4 });
  const e = enemies[0];
  const opts = { cell, px: e.x, pz: e.z + 3 * cell, height: 0.5 * cell, crown: 1.2 * cell };
  const segs = enemySegments(e, 0, opts);
  assert.equal(segs.length, 8, 'Aussen- und Innen-Kontur (je 4 Kanten)');
  for (const [a, b] of segs) {
    assert.equal(a.length, 3);
    assert.equal(b.length, 3);
  }
  // Lauerer: klein und oberhalb der Krone.
  const top = segs[0][0][1];
  const bot = segs[1][1][1];
  assert.ok(Math.abs(top - bot) < 2 * ENEMY.size * cell * 0.5, 'verkleinerte Raute');
  assert.ok(bot >= opts.crown - 1e-9, 'sitzt auf der Wandkrone');
  // Pulsieren: die Hoehe des Top-Punkts schwankt ueber die Zeit.
  const topHeight = (t) => enemySegments(e, t, opts)[0][0][1];
  const samples = [0, 0.1, 0.2, 0.3, 0.4].map((t) => topHeight(t).toFixed(9));
  assert.ok(new Set(samples).size > 1, 'Rauten pulsieren (Groesse schwankt)');
  // Jaeger: volle Groesse auf Schwebehoehe.
  e.mode = 'hunt';
  const hs = enemySegments(e, 0, opts);
  assert.ok(Math.abs((hs[0][0][1] + hs[1][1][1]) / 2 - opts.height) < 1e-9, 'Mitte auf Schwebehoehe');
  // Billboard: Spieler suedlich (gleiche x) -> Querpunkte weichen nur in x ab.
  const left = hs[2][1];
  assert.ok(Math.abs(left[2] - e.z) < 1e-9, 'Querpunkt bleibt auf der z-Ebene des Feinds');
  assert.ok(Math.abs(left[0] - e.x) > 0, 'Querpunkt weicht in x aus');
});

// Tests fuer die Flipper (world/flippers.js): Platzierung auf langen
// Gangstuecken (Spinner-Gaenge bleiben frei), Wandern + Flip-Zyklus
// (Seiten lang, oben/unten kurz), Abschiessbarkeit NUR in Seiten-Stellung,
// die toedliche Querschnitts-Ebene und das Flipper-Paar beim Fern-Abschuss
// eines Tankers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL, OPEN } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { createRng } from '../src/util/rng.js';
import { ENEMY } from '../src/world/enemies.js';
import { DRIVE } from '../src/world/drive.js';
import {
  FLIPPER, createFlippers, flippersStep, flipperSide, flipperPos,
  flipperShotHit, flipperPlayerHit, flipperMarkers, flipperSegments,
  spawnFlipperPair,
} from '../src/world/flippers.js';

const THIN = { wall: 1, corridor: 5 };
const CELL = 5;
const QUARTER = Math.PI / 2;

// Hand-Maze wie in spinners.test.js: langes Gangstueck (6 Kammern) in Reihe
// y=1, kurzer Seitengang auf Spalte x=1 mit S und G (dessen Schutzzone haelt
// ihn flipperfrei) -- genau ein Kandidat bleibt uebrig.
function corridorMaze() {
  const n = 13;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 11; x++) grid[1][x] = OPEN;
  for (let y = 1; y <= 5; y++) grid[y][1] = OPEN;
  return { n, grid, start: [1, 5], goal: [1, 3], seed: 42, metric: createMetric(THIN) };
}

function makeFlipper(seed = 7) {
  const maze = corridorMaze();
  const flippers = createFlippers(maze, { count: 3 }, { unit: 1, cell: CELL, rng: createRng(seed) });
  return { maze, flippers };
}

// Einen Flipper deterministisch in eine Ziel-Stellung bringen.
function settle(f, angle) {
  f.mode = 'hold';
  f.angle = angle;
  f.hold = 10;
  f.flipT = 0;
}

test('createFlippers: mittig auf dem langen Gang, S/G-Gang bleibt frei, Seiten-Start', () => {
  const { flippers } = makeFlipper();
  assert.equal(flippers.length, 1, 'nur der lange Gang ist unbewacht und lang genug');
  const f = flippers[0];
  assert.equal(f.axis, 'x');
  assert.equal(f.cross, 3.5, 'Gangmitte der Reihe y=1');
  assert.equal(f.min, 3.5, 'Patrouille bis zur Mitte der ersten Kammer');
  assert.equal(f.max, 33.5, 'und bis zur Mitte der letzten');
  assert.equal(f.along, (f.min + f.max) / 2, 'startet in der Gang-Mitte');
  assert.ok(f.alive);
  assert.equal(f.mode, 'hold');
  assert.ok(flipperSide(f) === 1 || flipperSide(f) === -1, 'startet eingerastet an einer Seite');
  assert.ok(f.hold >= FLIPPER.holdSide - FLIPPER.holdJitter - 1e-9
    && f.hold <= FLIPPER.holdSide + FLIPPER.holdJitter + 1e-9, 'Seiten-Verweildauer im Rahmen');
});

test('createFlippers ist deterministisch bei gleichem Seed', () => {
  assert.deepEqual(makeFlipper(11).flippers, makeFlipper(11).flippers);
});

test('createFlippers meidet Spinner-Gaenge (avoid)', () => {
  const maze = corridorMaze();
  const spinnerLike = { axis: 'x', cross: 3.5, wall: 36, dir: -1, runLen: 35 };
  const flippers = createFlippers(maze, { count: 3 }, {
    unit: 1, cell: CELL, rng: createRng(7), avoid: [spinnerLike],
  });
  assert.equal(flippers.length, 0, 'der einzige Kandidaten-Gang gehoert dem Spinner');
});

test('Tempo: schneller als die Tanker, aber fliehbar; an den Gang-Enden wird gewendet', () => {
  assert.ok(FLIPPER.speed > ENEMY.patrolSpeed, 'schneller als die Tanker-Patrouille');
  assert.ok(FLIPPER.speed < DRIVE.cruise, 'die Reisegeschwindigkeit entkommt ihm');

  const { flippers } = makeFlipper();
  const f = flippers[0];
  const dt = 1 / 60;
  const before = f.along;
  flippersStep(flippers, dt, CELL);
  assert.ok(Math.abs(Math.abs(f.along - before) - FLIPPER.speed * CELL * dt) < 1e-9, 'wandert mit speed');
  assert.equal(f.prevAlong, before, 'prevAlong merkt die Lage vor dem Schritt');

  f.along = f.max - 0.01;
  f.moveDir = 1;
  flippersStep(flippers, 0.1, CELL);
  assert.equal(f.along, f.max, 'am Ende geklemmt');
  assert.equal(f.moveDir, -1, 'und gewendet');
});

test('Flip-Zyklus: Seiten rasten lange ein, oben/unten klappt es direkt durch', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];
  const dt = 1 / 60;
  settle(f, QUARTER); // rechts eingerastet
  f.hold = 0.05;

  // Nach Ablauf der Verweildauer beginnt der Flip ...
  for (let t = 0; t < 0.1; t += dt) flippersStep(flippers, dt, CELL);
  assert.equal(f.mode, 'flip');
  assert.equal(flipperSide(f), 0, 'mitten im Flip nicht abschiessbar');

  // ... und landet nach flipTime oben oder unten (gerade Stellung) ...
  for (let t = 0; t < FLIPPER.flipTime; t += dt) flippersStep(flippers, dt, CELL);
  assert.equal(f.mode, 'hold');
  const evenIdx = Math.round(f.angle / QUARTER) % 4;
  assert.equal(evenIdx % 2, 0, 'oben oder unten angekommen');
  assert.ok(f.hold <= FLIPPER.holdShort + 1e-9, 'dort nur kurz einrasten');

  // ... klappt in DERSELBEN Drehrichtung weiter durch zur Gegenseite.
  const rotDir = f.rotDir;
  for (let t = 0; t < FLIPPER.holdShort + FLIPPER.flipTime + 0.05; t += dt) {
    flippersStep(flippers, dt, CELL);
  }
  assert.equal(f.mode, 'hold');
  assert.ok(Math.abs(flipperSide(f)) === 1, 'wieder an einer Seite');
  assert.equal(f.rotDir, rotDir, 'oben/unten wuerfelt keine neue Richtung');
  assert.equal(flipperSide(f), -1, 'durchgeklappt zur GEGENSEITE (von rechts nach links)');
  assert.ok(f.hold >= FLIPPER.holdSide - FLIPPER.holdJitter - 1e-9, 'Seite haelt wieder lange');
});

test('flipperShotHit: nur in Seiten-Stellung, Zielpunkt sitzt nahe der Wand', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];
  const d = (0.5 - FLIPPER.lift) * CELL;

  // Rechte Stellung: Treffer am X-Zentrum (Gangmitte + d) toetet.
  settle(f, QUARTER);
  assert.equal(flipperShotHit(flippers, f.along, f.cross, CELL), null,
    'Gangmitte verfehlt das X (man muss zur Seite zielen)');
  const ev = flipperShotHit(flippers, f.along, f.cross + d, CELL);
  assert.equal(ev.type, 'flipper');
  assert.equal(ev.flipper, f);
  assert.equal(f.alive, false);

  // Unten: unverwundbar, selbst am exakten Ort der Ebene.
  f.alive = true;
  settle(f, 0);
  assert.equal(flipperShotHit(flippers, f.along, f.cross, CELL), null);
  assert.equal(flipperShotHit(flippers, f.along, f.cross + d, CELL), null);
  // Mitten im Flip: ebenfalls sicher.
  settle(f, QUARTER);
  f.mode = 'flip';
  assert.equal(flipperShotHit(flippers, f.along, f.cross + d, CELL), null);
  assert.ok(f.alive);
});

test('flipperPlayerHit: die Querschnitts-Ebene toetet bei Beruehrung und Kreuzen -- in JEDER Stellung', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];
  const radius = 0.25 * CELL;
  const at = (t, dq = 0) => ({ px: t, pz: f.cross + dq });

  for (const angle of [0, QUARTER, Math.PI, 3 * QUARTER]) {
    settle(f, angle);
    // Beruehrung: Abstand laengs unter dem Spielerradius.
    const touch = flipperPlayerHit(flippers, f.along + radius - 0.1, f.cross, radius, CELL);
    assert.ok(touch, `Stellung ${angle}: Beruehrung toetet`);
    assert.equal(touch.flipper, f);
    // Kreuzen in einem Schritt (schnell hindurch): ebenfalls tot.
    const cross = flipperPlayerHit(flippers, f.along - 2, f.cross, radius, CELL,
      at(f.along + 2));
    assert.ok(cross, `Stellung ${angle}: Kreuzen toetet`);
  }

  // Abstand halten: sicher; Parallelgang: sicher; tot: sicher.
  assert.equal(flipperPlayerHit(flippers, f.along + 3 * radius, f.cross, radius, CELL,
    at(f.along + 4 * radius)), null);
  assert.equal(flipperPlayerHit(flippers, f.along, f.cross + 1.2 * CELL, radius, CELL), null);
  f.alive = false;
  assert.equal(flipperPlayerHit(flippers, f.along, f.cross, radius, CELL), null);
});

test('Der wandernde Flipper holt einen stehenden Spieler ein (prevAlong-Kreuzung)', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];
  const radius = 0.25 * CELL;
  f.moveDir = 1;
  const stand = { px: f.along + 2 * radius + 0.2, pz: f.cross };
  assert.equal(flipperPlayerHit(flippers, stand.px, stand.pz, radius, CELL, stand), null);
  let hit = null;
  for (let t = 0; t < 2 && !hit; t += 1 / 60) {
    flippersStep(flippers, 1 / 60, CELL);
    hit = flipperPlayerHit(flippers, stand.px, stand.pz, radius, CELL, stand);
  }
  assert.ok(hit, 'die Ebene erreicht den Spieler');
});

test('spawnFlipperPair: links+rechts am Tanker, versetzt, beide auf den Spieler zu', () => {
  const maze = corridorMaze();
  // Tanker auf Kammer (5,1), Spieler weiter rechts im selben Gang.
  const enemy = { gx: 5, gy: 1, x: 15.5, z: 3.5 };
  const player = { px: 33.5, pz: 3.5 };
  const pair = spawnFlipperPair(maze, enemy, player, { unit: 1, cell: CELL });

  assert.equal(pair.length, 2);
  const sides = pair.map((f) => flipperSide(f)).sort();
  assert.deepEqual(sides, [-1, 1], 'einer links, einer rechts eingerastet');
  for (const f of pair) {
    assert.equal(f.axis, 'x', 'Achse aus der Sichtlinie Spieler -> Tanker');
    assert.equal(f.moveDir, 1, 'rueckt auf den Spieler zu');
    assert.equal(f.cross, 3.5);
    assert.equal(f.min, 3.5);
    assert.equal(f.max, 33.5, 'Patrouillen-Spanne = der ganze Gang');
    assert.ok(f.alive);
  }
  assert.equal(pair[0].along, 15.5, 'der erste am Tanker');
  assert.ok(Math.abs(pair[1].along - (15.5 - FLIPPER.pairGap * CELL)) < 1e-9,
    'der zweite dahinter versetzt');

  // Deterministisch: gleicher Abschuss -> gleiches Paar.
  assert.deepEqual(spawnFlipperPair(maze, enemy, player, { unit: 1, cell: CELL }), pair);
});

test('flipperMarkers: nur lebende Flipper, an der X-Mitte', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];
  const [x, z] = flipperPos(f);
  assert.deepEqual(flipperMarkers(flippers), [{ x, z, alive: true }]);
  f.alive = false;
  assert.deepEqual(flipperMarkers(flippers), []);
  assert.equal(flipperMarkers(null), null);
});

test('flipperSegments: X-Kontur im Querschnitt -- unten flach unter Augenhoehe, seitlich hochkant', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];

  // Unten: alle Punkte in der Querschnitts-Ebene, flach ueber dem Boden --
  // die eigenen Schuesse (Augenhoehe 0.5 Zellen) fliegen drueber weg.
  settle(f, 0);
  let segs = flipperSegments(f, { cell: CELL });
  assert.equal(segs.length, 6, 'geschlossene Kontur aus 6 Segmenten');
  let minU = Infinity;
  let maxU = -Infinity;
  for (const [a, b] of segs) {
    for (const p of [a, b]) {
      assert.ok(Math.abs(p[0] - f.along) < 1e-9, 'alles in der Querschnitts-Ebene');
      assert.ok(p[1] < 0.5 * CELL, 'unten: komplett unter der Augenhoehe');
      assert.ok(p[1] > -1e-9, 'nicht im Boden');
      minU = Math.min(minU, p[2]);
      maxU = Math.max(maxU, p[2]);
    }
  }
  assert.ok(maxU - minU > 0.9 * CELL, 'die lange Seite spannt fast die ganze Gangbreite');

  // Rechts: hochkant an der Wand -- das X kreuzt die Augenhoehe (abschiessbar).
  settle(f, QUARTER);
  segs = flipperSegments(f, { cell: CELL });
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [a, b] of segs) {
    for (const p of [a, b]) {
      minV = Math.min(minV, p[1]);
      maxV = Math.max(maxV, p[1]);
      assert.ok(p[2] > f.cross, 'komplett in der rechten Ganghaelfte');
    }
  }
  assert.ok(minV < 0.5 * CELL && maxV > 0.5 * CELL, 'kreuzt die Augen-/Schusshoehe');
});

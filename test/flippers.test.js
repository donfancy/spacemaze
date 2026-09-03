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
import { DRIVE } from '../src/world/drive.js';
import { createShotsState, fireShot, shotsStep, SHOTS } from '../src/world/shots.js';
import {
  FLIPPER, createFlippers, flippersStep, flipperSide, flipperPos, flipperDiagonal,
  flipperShotHit, flipperPlayerHit, flipperMarkers, flipperSegments,
  flipperTriangles, spawnFlipperPair,
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

test('flipperShotHit: die Trennwand schuetzt -- Substep-Punkte IN der Wand treffen nicht', () => {
  // Der Schuss-Substep prueft den Treffer VOR der Wand-Kollision: ein Schuss
  // aus dem Nachbargang kann bis 0.5 Einheiten in der Trennwand stecken und
  // kaeme dem Seiten-Trefferpunkt (5.2) auf 1.1 < shotRadius 1.5 nahe.
  const { flippers } = makeFlipper();
  const f = flippers[0]; // Gang y=1: cross 3.5, Gangkante bei 6, Wand 6..7
  settle(f, QUARTER);    // rechts eingerastet, Trefferpunkt bei z = 5.2

  assert.equal(flipperShotHit(flippers, f.along, 6.3, CELL), null,
    'Punkt in der Trennwand (Nachbargang-Schuss) trifft nicht');
  assert.ok(f.alive);
  const ev = flipperShotHit(flippers, f.along, 5.9, CELL);
  assert.ok(ev, 'Punkt im eigenen Gang nahe der Wand trifft weiterhin');
  assert.equal(f.alive, false);
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

test('flipperPlayerHit: auch MITTEN im Flip ist die Ebene toedlich (Spec: jede Stellung)', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];
  const radius = 0.25 * CELL;
  f.mode = 'flip';
  f.angle = QUARTER / 2; // 45 Grad, zwischen zwei Rast-Stellungen
  const hit = flipperPlayerHit(flippers, f.along + radius - 0.1, f.cross, radius, CELL);
  assert.ok(hit, 'Beruehrung mitten im Flip toetet');
  assert.equal(hit.flipper, f);
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

test('spawnFlipperPair: patrouillierter Tanker -- das Paar spawnt im Gang der AKTUELLEN Lage', () => {
  const maze = corridorMaze();
  // Geburtszelle (5,1) im x-Gang, aber der Tanker steht gerade auf der
  // Kreuzung (1,1); der Spieler schiesst ihn von unten durch den z-Gang
  // (Spalte x=1) ab. Die Spanne muss aus der aktuellen Zelle kommen --
  // von der Geburtszelle aus laege sie im falschen Gang (cross 15.5).
  const enemy = { gx: 5, gy: 1, x: 3.5, z: 3.5 };
  const player = { px: 3.5, pz: 9.5 };
  const pair = spawnFlipperPair(maze, enemy, player, { unit: 1, cell: CELL });

  assert.equal(pair.length, 2);
  for (const f of pair) {
    assert.equal(f.axis, 'z', 'Achse aus der Sichtlinie durch den z-Gang');
    assert.equal(f.cross, 3.5, 'Gangmitte der Spalte x=1 (aktuelle Lage)');
    assert.equal(f.min, 3.5, 'Spanne vom Kreuzungs-Ende ...');
    assert.equal(f.max, 15.5, '... bis zur letzten Kammer des z-Gangs');
    assert.equal(f.moveDir, 1, 'rueckt auf den Spieler zu');
  }
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

// Stufe-5-Politur (2026): gefuellte X-Flaeche als vier "Schmetterlings-
// Fluegel"-Dreiecke um die Kreuzungsmitte -- die selbstschneidende Kontur
// laesst sich nicht normal triangulieren.
test('flipperTriangles: vier Dreiecke in der Querschnitts-Ebene, deckungsgleich mit der Kontur', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];
  const tris = flipperTriangles(f, { cell: CELL });
  assert.equal(tris.length, 4);
  const segs = flipperSegments(f, { cell: CELL });
  for (const tri of tris) {
    assert.equal(tri.length, 3);
    for (const p of tri) {
      assert.ok(p.length === 3 && p.every(Number.isFinite));
      // Querschnitts-Ebene: die Gang-Laengs-Koordinate ist konstant f.along.
      const along = f.axis === 'x' ? p[0] : p[2];
      assert.ok(Math.abs(along - f.along) < 1e-9, 'liegt in der Flipper-Ebene');
    }
  }
  // Die Fluegel teilen sich die Kreuzungsmitte (erster Punkt aller Dreiecke)
  // und enden in den Kontur-Ecken (jede Dreiecks-Ecke liegt auf der Kontur).
  assert.deepEqual(tris[0][0], tris[2][0], 'gemeinsame Kreuzungsmitte');
  const corner = tris[0][1];
  assert.ok(segs.some(([a, b]) => [a, b].some(
    (p) => Math.hypot(p[0] - corner[0], p[1] - corner[1], p[2] - corner[2]) < 1e-9,
  )), 'Fluegel-Ecken sind Kontur-Ecken');
});

// --- STURM-Branch: Zwangs-Flip + Rettungsschuss ------------------------------

test('Zwangs-Flip: spaetestens flipDist vor dem Spieler klappt er -- aus jeder Stellung, einmal pro Annaeherung', () => {
  const dt = 1 / 60;
  for (const angle of [QUARTER, 0]) { // seitlich eingerastet bzw. unten
    const { flippers } = makeFlipper();
    const f = flippers[0];
    settle(f, angle);
    f.hold = 10; // von sich aus klappt er lange nicht
    f.moveDir = 1;
    const player = { px: f.along + 3 * CELL, pz: f.cross };
    let flipAt = null;
    for (let t = 0; t < 4 && flipAt == null; t += dt) {
      flippersStep(flippers, dt, CELL, player);
      if (f.mode === 'flip') flipAt = Math.abs(player.px - f.along);
    }
    assert.ok(flipAt != null, `Stellung ${angle}: der Zwangs-Flip kommt`);
    assert.ok(flipAt <= FLIPPER.flipDist * CELL + 1e-9 && flipAt > (FLIPPER.flipDist - 0.1) * CELL,
      `Stellung ${angle}: genau bei flipDist (${(flipAt / CELL).toFixed(2)} Gangbreiten)`);
    assert.equal(f.forced, true);
    // Einmal pro Annaeherung: nach dem Flip rastet er wieder ein und bleibt
    // (trotz Naehe) in Ruhe, bis seine eigene Verweildauer ablaeuft.
    for (let t = 0; t < FLIPPER.flipTime + 0.02; t += dt) flippersStep(flippers, dt, CELL, player);
    assert.equal(f.mode, 'hold');
    const holdAfter = f.hold;
    flippersStep(flippers, dt, CELL, player);
    assert.equal(f.mode, 'hold', 'kein Dauer-Zwangsklappen');
    assert.ok(f.hold < holdAfter, 'die normale Verweildauer laeuft');
  }
  // Spieler im Nachbargang: kein Zwangs-Flip.
  const { flippers } = makeFlipper();
  const f = flippers[0];
  settle(f, QUARTER);
  f.hold = 10;
  for (let t = 0; t < 1; t += dt) {
    flippersStep(flippers, dt, CELL, { px: f.along + 0.5 * CELL, pz: f.cross + 2 * CELL });
  }
  assert.equal(f.mode, 'hold', 'fremder Gang loest nichts aus');
});

test('Diagonal-Kill: im Fenster um 45 Grad trifft der gerade Schuss, ausserhalb und eingerastet nicht', () => {
  const { flippers } = makeFlipper();
  const f = flippers[0];
  f.mode = 'flip';
  f.angle = QUARTER / 2; // exakt diagonal
  assert.equal(flipperDiagonal(f), true);
  // Nur der eigene Gang zaehlt.
  assert.equal(flipperShotHit(flippers, f.along, f.cross + 2 * CELL, CELL), null, 'Nachbargang: nichts');
  assert.equal(flipperShotHit(flippers, f.along + 0.2 * CELL, f.cross, CELL), null,
    'noch vor der Ebene: kein Treffer (Kreuzen, kein Radius)');
  const hit = flipperShotHit(flippers, f.along + 0.03 * CELL, f.cross, CELL);
  assert.ok(hit && hit.diagonal, 'gerader Schuss durch die Diagonale trifft');
  assert.equal(f.alive, false);
  // Mit Vor-Lage zaehlt das exakte KREUZEN der Ebene, auch ueber einen weiten Substep.
  f.alive = true;
  const crossed = flipperShotHit(flippers, f.along - 0.3 * CELL, f.cross, CELL, { x: f.along + 0.3 * CELL, z: f.cross });
  assert.ok(crossed && crossed.diagonal, 'Vorzeichenwechsel = Kreuzen = Treffer');
  f.alive = true;
  assert.equal(flipperShotHit(flippers, f.along + 0.2 * CELL, f.cross, CELL, { x: f.along + 0.4 * CELL, z: f.cross }), null,
    'noch diesseits der Ebene: kein Treffer');
  // Rand des Fensters: knapp innerhalb ja, knapp ausserhalb nein.
  f.alive = true;
  f.angle = QUARTER / 2 + FLIPPER.diagWindow - 0.01;
  assert.ok(flipperDiagonal(f));
  f.angle = QUARTER / 2 + FLIPPER.diagWindow + 0.01;
  assert.equal(flipperDiagonal(f), false);
  assert.equal(flipperShotHit(flippers, f.along, f.cross, CELL), null, 'ausserhalb des Fensters: vorbei');
  // Auch die anderen Diagonalen (135, 225, 315 Grad) sind Fenster.
  f.angle = 3 * QUARTER / 2;
  assert.ok(flipperDiagonal(f));
  // Eingerastet (hold) ist nie diagonal -- dort gilt nur der Seitenpunkt.
  settle(f, QUARTER);
  assert.equal(flipperDiagonal(f), false);
  assert.equal(flipperShotHit(flippers, f.along, f.cross, CELL), null, 'Gangmitte verfehlt den Seitenpunkt');
});

// Volle Rettungsschuss-Simulation: stehender Spieler im Hand-Gang, ein
// Flipper rueckt seitlich eingerastet heran (klappt von sich aus nicht),
// der Zwangs-Flip kommt bei flipDist. `fire(t, flipT)` entscheidet pro
// Frame, ob gefeuert wird (flipT = Zeit seit Klappbeginn oder null).
// Liefert true, wenn der Flipper stirbt, bevor seine Ebene den Spieler
// erreicht.
function rescueRun(fire, phase = 0) {
  const maze = corridorMaze();
  const { flippers } = makeFlipper();
  const f = flippers[0];
  settle(f, QUARTER);
  f.hold = 10;
  f.moveDir = 1;
  const player = { px: f.along + 3 * CELL, pz: f.cross, yaw: Math.PI / 2 }; // Blick -x, auf den Flipper
  const shotsState = createShotsState();
  shotsState.cooldown = phase;
  const radius = 0.25 * CELL;
  const dt = 1 / 60;
  let flipStart = null;
  for (let t = 0; t < 6; t += dt) {
    const prev = { px: player.px, pz: player.pz };
    flippersStep(flippers, dt, CELL, player);
    if (f.alive && f.mode === 'flip' && flipStart == null) flipStart = t;
    if (fire(t, flipStart == null ? null : t - flipStart)) fireShot(shotsState, player, 0);
    shotsStep(maze, shotsState, dt, { unit: 1, cell: CELL, hitTest: (x, z, shot) => flipperShotHit(flippers, x, z, CELL, shot) });
    if (!f.alive) return true;
    if (flipperPlayerHit(flippers, player.px, player.pz, radius, CELL, prev)) return false;
  }
  return false;
}

test('RETTUNGSSCHUSS: ein gezielter Schuss beim Klappbeginn trifft sicher, ohne Feuer stirbt man', () => {
  let fired = false;
  const timed = rescueRun((t, flipT) => {
    if (flipT != null && !fired) { fired = true; return true; }
    return false;
  });
  assert.equal(timed, true, 'der Schuss im richtigen Moment rettet');
  assert.equal(rescueRun(() => false), false, 'wer nicht schiesst, stirbt an der Ebene');
  // Ein Schuss deutlich VOR dem Klappen (Flipper noch eingerastet) verpufft an der Wand.
  let early = false;
  const tooEarly = rescueRun((t, flipT) => {
    if (flipT == null && t > 0.5 && !early) { early = true; return true; }
    return false;
  });
  assert.equal(tooEarly, false, 'zu frueh gefeuert: die Diagonale kommt erst spaeter');
});

test('RETTUNGSSCHUSS-STATISTIK: Dauerfeuer mit zufaelliger Phase rettet nur etwa jedes zweite Mal', () => {
  const N = 40;
  let hits = 0;
  for (let i = 0; i < N; i++) {
    const phase = (i / N) / SHOTS.rate; // Cooldown-Phase gleichverteilt ueber eine Schuss-Periode
    if (rescueRun(() => true, phase)) hits++;
  }
  const rate = hits / N;
  assert.ok(rate >= 0.25 && rate <= 0.75, `Dauerfeuer ist Glueckssache: ${(rate * 100).toFixed(0)} % (25..75 erwartet)`);
});

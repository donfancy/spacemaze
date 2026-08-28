// Tests fuer die Pulsare (world/pulsars.js): Platzierung auf langen
// Gangstuecken (Spinner- UND Flipper-Gaenge bleiben frei), der Klapp-Zyklus
// mit langen Verweildauern in ALLEN Stellungen, das Pulsieren, das
// AUSWEICHEN vor eigenen Schuessen (rechtzeitig nach unten/oben) und die
// Beruehrungs-Regeln: oben/unten sperrt die ganze Gangbreite, seitlich
// kommt man mit Rueberziehen vorbei (Durchkommens-Garantie), nach einer
// Beruehrung ist der Pulsar entschaerft, bis der Spieler Abstand hat.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL, OPEN } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { createRng } from '../src/util/rng.js';
import { DRIVE } from '../src/world/drive.js';
import { SHOTS } from '../src/world/shots.js';
import {
  PULSAR, createPulsars, pulsarsStep, pulsarSide, pulsarPos, pulsarSpread,
  pulsarPlayerTouch, pulsarMarkers, pulsarSegments,
} from '../src/world/pulsars.js';

const THIN = { wall: 1, corridor: 5 };
const CELL = 5;
const QUARTER = Math.PI / 2;

// Hand-Maze wie in flippers.test.js: langes Gangstueck (6 Kammern) in Reihe
// y=1, kurzer Seitengang auf Spalte x=1 mit S und G (dessen Schutzzone haelt
// ihn pulsarfrei) -- genau ein Kandidat bleibt uebrig.
function corridorMaze() {
  const n = 13;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 11; x++) grid[1][x] = OPEN;
  for (let y = 1; y <= 5; y++) grid[y][1] = OPEN;
  return { n, grid, start: [1, 5], goal: [1, 3], seed: 42, metric: createMetric(THIN) };
}

function makePulsar(seed = 7) {
  const maze = corridorMaze();
  const pulsars = createPulsars(maze, { count: 3 }, { unit: 1, cell: CELL, rng: createRng(seed) });
  return { maze, pulsars };
}

// Einen Pulsar deterministisch in eine Ziel-Stellung bringen.
function settle(p, angle) {
  p.mode = 'hold';
  p.angle = angle;
  p.hold = 10;
  p.flipT = 0;
}

test('createPulsars: fest in der Mitte des langen Gangs, S/G-Gang bleibt frei', () => {
  const { pulsars } = makePulsar();
  assert.equal(pulsars.length, 1, 'nur der lange Gang ist unbewacht und lang genug');
  const p = pulsars[0];
  assert.equal(p.axis, 'x');
  assert.equal(p.cross, 3.5, 'Gangmitte der Reihe y=1');
  assert.equal(p.along, (3.5 + 33.5) / 2, 'sitzt fest in der Gang-Mitte');
  assert.ok(p.armed && p.alive);
  assert.equal(p.mode, 'hold');
  assert.equal(p.angle % QUARTER, 0, 'startet eingerastet in einer der vier Stellungen');
  assert.ok(p.hold >= PULSAR.holdMin - 1e-9 && p.hold <= PULSAR.holdMax + 1e-9);
});

test('createPulsars ist deterministisch bei gleichem Seed', () => {
  assert.deepEqual(makePulsar(11).pulsars, makePulsar(11).pulsars);
});

test('createPulsars meidet Spinner- UND Flipper-Gaenge (avoid, beide Formen)', () => {
  const maze = corridorMaze();
  const spinnerLike = { axis: 'x', cross: 3.5, wall: 36, dir: -1, runLen: 35 };
  const flipperLike = { axis: 'x', cross: 3.5, min: 3.5, max: 33.5 };
  for (const avoid of [[spinnerLike], [flipperLike]]) {
    const pulsars = createPulsars(maze, { count: 3 }, {
      unit: 1, cell: CELL, rng: createRng(7), avoid,
    });
    assert.equal(pulsars.length, 0, 'der einzige Kandidaten-Gang ist belegt');
  }
});

test('Klapp-Zyklus: in JEDER Stellung lange einrasten, 90-Grad-Schritte', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  const seen = new Set();
  let flips = 0;
  const dt = 1 / 60;
  for (let t = 0; t < 60 && flips < 12; t += dt) {
    const wasHold = p.mode === 'hold';
    pulsarsStep(pulsars, dt, CELL);
    if (wasHold && p.mode === 'flip') flips++;
    if (p.mode === 'hold') {
      seen.add(((Math.round(p.angle / QUARTER) % 4) + 4) % 4);
      assert.equal(p.angle % QUARTER, 0, 'eingerastet immer im 90-Grad-Raster');
    }
  }
  assert.ok(flips >= 12, 'es wird regelmaessig geklappt');
  assert.ok(seen.size >= 3, 'im Lauf der Zeit werden (fast) alle Stellungen besucht');
  // Anders als beim Flipper: auch unten/oben wird LANGE verweilt.
  settle(p, 0);
  pulsarsStep(pulsars, 0.001, CELL);
  p.hold = PULSAR.holdMin; // frisch gewuerfelt waere er >= holdMin
  let held = 0;
  while (p.mode === 'hold' && held < 10) { pulsarsStep(pulsars, dt, CELL); held += dt; }
  assert.ok(held >= PULSAR.holdMin - 2 * dt, 'unten wird nicht sofort weitergeklappt');
});

test('Pulsieren: die Zackenstrecke atmet zwischen spreadMin und spreadMax', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < 3; t += 0.01) {
    const s = pulsarSpread(p, t);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
    assert.ok(s >= PULSAR.spreadMin - 1e-9 && s <= PULSAR.spreadMax + 1e-9);
  }
  assert.ok(lo < PULSAR.spreadMin + 0.02, 'zieht sich fast ganz zusammen');
  assert.ok(hi > PULSAR.spreadMax - 0.02, 'dehnt sich fast ganz aus');
});

test('Ausweichen: ein Schuss im Gang klappt die Seiten-Stellung RECHTZEITIG weg', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  settle(p, QUARTER); // rechts eingerastet -- auf Schusshoehe
  // Schuss startet dodgeRange + etwas Anflug entfernt und fliegt den Gang
  // entlang auf den Pulsar zu (SHOTS.speed, echte Konstante).
  const shot = { x: p.along - (PULSAR.dodgeRange + 0.5) * CELL, z: p.cross, dx: 1, dz: 0 };
  const dt = 1 / 120;
  let dodged = false;
  for (let t = 0; t < 2 && shot.x < p.along; t += dt) {
    pulsarsStep(pulsars, dt, CELL, [shot]);
    shot.x += SHOTS.speed * CELL * dt;
    const k = ((Math.round(p.angle / QUARTER) % 4) + 4) % 4;
    if (p.mode === 'hold' && k % 2 === 0) dodged = true;
    if (shot.x >= p.along) {
      assert.ok(p.mode === 'hold' && k % 2 === 0,
        'beim Eintreffen des Schusses ist der Pulsar unten oder oben eingerastet');
    }
  }
  assert.ok(dodged, 'der Pulsar ist ausgewichen');
});

test('Kein Ausweichen vor einem Schuss, der sich ENTFERNT (Richtungs-Check)', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  settle(p, QUARTER); // rechts eingerastet -- auf Schusshoehe
  const shot = { x: p.along - CELL, z: p.cross, dx: -1, dz: 0 }; // nah, aber er fliegt WEG
  for (let i = 0; i < 30; i++) pulsarsStep(pulsars, 1 / 120, CELL, [shot]);
  assert.equal(pulsarSide(p), 1, 'bleibt seitlich eingerastet -- keine Bedrohung');
});

test('Landet ein Flip unter Beschuss SEITLICH, klappt er in derselben Richtung durch', () => {
  const scenario = (withShot) => {
    const { pulsars } = makePulsar();
    const p = pulsars[0];
    // Flip von unten nach rechts, einen Tick vor dem Einrasten -- waehrend
    // sich ein eigener Schuss naehert (innerhalb dodgeRange, auf ihn zu).
    p.mode = 'flip';
    p.from = 0;
    p.delta = QUARTER;
    p.rotDir = 1;
    p.flipT = 0.25 - 1e-4; // PULSAR.flipTime
    const shots = withShot ? [{ x: p.along - CELL, z: p.cross, dx: 1, dz: 0 }] : null;
    pulsarsStep(pulsars, 1 / 60, CELL, shots);
    return p;
  };
  const threatened = scenario(true);
  assert.equal(threatened.mode, 'flip', 'unter Beschuss: nicht seitlich einrasten');
  assert.equal(threatened.from, QUARTER, 'der Folge-Flip startet an der Seiten-Stellung');
  assert.equal(threatened.rotDir, 1, 'in DERSELBEN Drehrichtung durchklappen');
  const calm = scenario(false);
  assert.equal(calm.mode, 'hold', 'ohne Beschuss rastet derselbe Flip normal ein');
  assert.equal(pulsarSide(calm), 1);
});

test('Beruehrung oben/unten: die Ebene sperrt die GANZE Gangbreite', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  const radius = 0.25 * CELL;
  for (const angle of [0, 2 * QUARTER]) {
    settle(p, angle);
    p.armed = true;
    // Auch maximal zur Seite gezogen: Kreuzen loest aus.
    const touch = pulsarPlayerTouch(pulsars, p.along + 0.1, p.cross - 0.24 * CELL, radius, CELL,
      { px: p.along - 2 * radius, pz: p.cross - 0.24 * CELL });
    assert.ok(touch, 'oben/unten gibt es kein Vorbei');
    assert.equal(touch.pulsar, p);
    assert.deepEqual([touch.x, touch.z], pulsarPos(p));
  }
});

test('Durchkommens-Garantie: seitlich eingerastet + ruebergezogen = freie Fahrt', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  settle(p, QUARTER); // rechts (+quer): Schlupfloch auf der linken Seite
  const radius = 0.25 * CELL;
  const dt = 1 / 60;
  // Simulierte Durchfahrt mit ECHTER Reisegeschwindigkeit, Spieler halb
  // zur Gegenseite gezogen (mehr als passMargin, weniger als Wandabstand).
  let px = p.along - 3 * CELL;
  const pz = p.cross - 0.15 * CELL;
  for (let t = 0; t < 5 && px < p.along + 3 * CELL; t += dt) {
    const prev = { px, pz };
    px += DRIVE.cruise * CELL * dt;
    p.hold = 10; // eingerastet lassen (das Zeitfenster selbst ist Gameplay)
    const touch = pulsarPlayerTouch(pulsars, px, pz, radius, CELL, prev);
    assert.equal(touch, null, 'ruebergezogen passiert nichts');
  }
  assert.ok(px >= p.along + 3 * CELL, 'der Spieler ist durch');
  // Gegentest: mittig (nicht ruebergezogen) loest die Beruehrung aus.
  settle(p, QUARTER);
  const touch = pulsarPlayerTouch(pulsars, p.along, p.cross, radius, CELL,
    { px: p.along - CELL, pz: p.cross });
  assert.ok(touch, 'mittig beruehrt die Ebene');
  // Und zur FALSCHEN Seite (zum Pulsar hin) gezogen ebenso.
  settle(p, QUARTER);
  p.armed = true;
  assert.ok(pulsarPlayerTouch(pulsars, p.along, p.cross + 0.2 * CELL, radius, CELL,
    { px: p.along - CELL, pz: p.cross + 0.2 * CELL }), 'zur Pulsar-Seite hin hilft nichts');
});

test('Entschaerfung: nach der Beruehrung erst wieder scharf mit Abstand (rearmDist)', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  settle(p, 0);
  const radius = 0.25 * CELL;
  const hit = pulsarPlayerTouch(pulsars, p.along, p.cross, radius, CELL,
    { px: p.along - CELL, pz: p.cross });
  assert.ok(hit && !p.armed, 'Beruehrung entschaerft');
  // Direkt danach (Durchfahrt waehrend der Rotation): nichts loest aus.
  assert.equal(pulsarPlayerTouch(pulsars, p.along + 0.3 * CELL, p.cross, radius, CELL,
    { px: p.along - 0.3 * CELL, pz: p.cross }), null);
  // Abstand gewinnen -> wieder scharf -> erneutes Kreuzen loest aus.
  assert.equal(pulsarPlayerTouch(pulsars, p.along + (PULSAR.rearmDist + 0.1) * CELL, p.cross,
    radius, CELL, { px: p.along + PULSAR.rearmDist * CELL, pz: p.cross }), null);
  assert.ok(p.armed, 'mit Abstand wieder scharf');
  assert.ok(pulsarPlayerTouch(pulsars, p.along, p.cross, radius, CELL,
    { px: p.along + CELL, pz: p.cross }), 'die Rueckfahrt loest erneut aus');
});

test('Nachbargang: quer ausserhalb der Gangbreite passiert nichts', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  settle(p, 0);
  assert.equal(pulsarPlayerTouch(pulsars, p.along, p.cross + 0.6 * CELL, 0.25 * CELL, CELL,
    { px: p.along - CELL, pz: p.cross + 0.6 * CELL }), null);
});

test('pulsarSide: nur seitlich eingerastet, mitten im Flip nie', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  settle(p, QUARTER);
  assert.equal(pulsarSide(p), 1);
  settle(p, 3 * QUARTER);
  assert.equal(pulsarSide(p), -1);
  settle(p, 0);
  assert.equal(pulsarSide(p), 0);
  settle(p, 2 * QUARTER);
  assert.equal(pulsarSide(p), 0);
  p.mode = 'flip';
  p.angle = QUARTER;
  assert.equal(pulsarSide(p), 0, 'im Flip gibt es kein Schlupfloch');
});

test('pulsarSegments: Zackenlinie spannt die Gangbreite, bleibt im Querschnitt', () => {
  const { pulsars } = makePulsar();
  const p = pulsars[0];
  settle(p, 0); // unten: Linie parallel zum Boden, quer zum Gang (x-Achse)
  const segs = pulsarSegments(p, 0.3, { cell: CELL });
  assert.equal(segs.length, 2 + 2 * PULSAR.teeth, 'flach + Zacken + flach als Kette');
  const zs = segs.flat().map((pt) => pt[2]);
  const xs = segs.flat().map((pt) => pt[0]);
  const vs = segs.flat().map((pt) => pt[1]);
  assert.ok(Math.min(...zs) <= p.cross - 0.5 * CELL + 1e-9
    && Math.max(...zs) >= p.cross + 0.5 * CELL - 1e-9, 'von Gangkante zu Gangkante');
  assert.ok(xs.every((x) => Math.abs(x - p.along) < 1e-9), 'alles im Querschnitt bei along');
  assert.ok(vs.every((v) => v >= 0 && v <= CELL), 'Hoehen innerhalb des Gangs');
  // Seitlich steht die Linie hochkant: die Hoehe ueberstreicht den Gang.
  settle(p, QUARTER);
  const seitlich = pulsarSegments(p, 0.3, { cell: CELL });
  const vs2 = seitlich.flat().map((pt) => pt[1]);
  assert.ok(Math.min(...vs2) <= 1e-6 && Math.max(...vs2) >= CELL - 1e-6, 'hochkant');
});

test('pulsarMarkers: feste Position, Form wie die anderen Feind-Marker', () => {
  const { pulsars } = makePulsar();
  const [x, z] = pulsarPos(pulsars[0]);
  assert.deepEqual(pulsarMarkers(pulsars), [{ x, z, alive: true }]);
  assert.equal(pulsarMarkers(null), null);
});

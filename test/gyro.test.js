// Tests fuer den Gyro (world/gyro.js): die Blickachsen-Rotation nach einer
// Pulsar-Beruehrung -- Betrag 270/360/450 Grad, Dreiecks-Tempoprofil (rasch
// beschleunigt, rasch gebremst), exaktes Einrasten im 90-Grad-Raster -- und
// das "logische" Tasten-Mapping unter der Verdrehung.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/util/rng.js';
import { GYRO, createGyro, startSpin, gyroStep, gyroTurn, gyroDirs, shortestRoll } from '../src/world/gyro.js';

const QUARTER = Math.PI / 2;
const EPS = 1e-9;

// rng-Stub mit festen Ziehungen: [Betrag-Wahl, Richtungs-Wahl, ...].
function fixedRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('startSpin: Betrag 270/360/450 Grad, Richtung aus dem rng, Dauer aus dem Profil', () => {
  for (const [pick, theta] of [[0, 1.5 * Math.PI], [0.4, 2 * Math.PI], [0.9, 2.5 * Math.PI]]) {
    for (const [dirPick, dir] of [[0.2, -1], [0.8, 1]]) {
      const g = createGyro();
      const dur = startSpin(g, fixedRng([pick, dirPick]));
      assert.ok(g.spinning);
      assert.ok(Math.abs(g.delta - dir * theta) < EPS, `Betrag ${theta}, Richtung ${dir}`);
      assert.ok(Math.abs(dur - 2 * Math.sqrt(theta / GYRO.accel)) < EPS, 'Dauer aus dem Dreiecksprofil');
    }
  }
});

test('gyroStep: rasch beschleunigt, rasch gebremst, rastet EXAKT im Raster ein', () => {
  const g = createGyro();
  startSpin(g, fixedRng([0.4, 0.9])); // 360 Grad, positiv
  const dt = 1 / 240;
  let prevRoll = 0;
  let prevRate = 0;
  let peak = 0;
  let accelPhaseRising = true;
  while (g.spinning) {
    gyroStep(g, dt);
    if (!g.spinning) break; // der Snap-Schritt normalisiert den Roll (mod 360)
    const rate = (g.roll - prevRoll) / dt;
    assert.ok(rate >= -EPS, 'der Roll laeuft monoton in Drehrichtung');
    if (accelPhaseRising && rate < prevRate - EPS) accelPhaseRising = false; // Scheitel
    else if (!accelPhaseRising) assert.ok(rate <= prevRate + 1e-6, 'nach dem Scheitel nur noch bremsen');
    peak = Math.max(peak, rate);
    prevRoll = g.roll;
    prevRate = rate;
  }
  assert.ok(!accelPhaseRising, 'es gab eine Beschleunigungs- und eine Bremsphase');
  assert.ok(peak > 2 * (2 * Math.PI) / g.dur * 0.9, 'Spitzentempo ~doppelt so hoch wie der Schnitt');
  assert.equal(g.roll % QUARTER, 0, 'exakt im 90-Grad-Raster eingerastet');
  assert.equal(g.roll, 0, '360 Grad enden aufrecht (normalisiert)');
  assert.equal(g.orient, 0);
});

test('270/450 Grad enden quer; Rotationen akkumulieren (auch 180 ist erreichbar)', () => {
  const run = (g, pick, dirPick) => {
    startSpin(g, fixedRng([pick, dirPick]));
    for (let i = 0; i < 10000 && g.spinning; i++) gyroStep(g, 1 / 120);
    return g;
  };
  const g1 = run(createGyro(), 0, 0.9);   // +270 Grad
  assert.equal(g1.orient, 3, '+270 Grad rasten bei 270 ein (netto -90)');
  const g2 = run(createGyro(), 0.9, 0.9); // +450 -> Netto +90
  assert.equal(g2.orient, 1, '+450 Grad rasten bei 90 ein');
  run(g2, 0.9, 0.9);                      // nochmal +450: 90 + 450 = 540 -> 180
  assert.equal(g2.orient, 2, 'zwei Rotationen summieren sich -- kopfueber ist erreichbar');
  assert.equal(g2.roll, Math.PI);
});

test('gyroTurn: das Mapping folgt der Verdrehung ("druecke den Pfeil zur Zielseite")', () => {
  const only = (k) => ({ left: false, right: false, up: false, down: false, [k]: true });
  // aufrecht: links lenkt links.
  assert.equal(gyroTurn(0, only('left')), 1);
  assert.equal(gyroTurn(0, only('right')), -1);
  assert.equal(gyroTurn(0, only('up')), 0);
  // 90 Grad Roll: Welt-links erscheint UNTEN -> runter lenkt links.
  assert.equal(gyroTurn(1, only('down')), 1);
  assert.equal(gyroTurn(1, only('up')), -1);
  assert.equal(gyroTurn(1, only('left')), 0, 'links/rechts sind quer dazu wirkungslos');
  // 180 Grad: links/rechts vertauscht.
  assert.equal(gyroTurn(2, only('right')), 1);
  assert.equal(gyroTurn(2, only('left')), -1);
  // 270 Grad: rauf lenkt links.
  assert.equal(gyroTurn(3, only('up')), 1);
  assert.equal(gyroTurn(3, only('down')), -1);
  // Gegentasten heben sich auf.
  assert.equal(gyroTurn(1, { left: false, right: false, up: true, down: true }), 0);
});

test('gyroDirs: das GANZE Tastenkreuz rotiert gemeinsam mit der Verdrehung', () => {
  // Aufrecht: Identitaet.
  assert.deepEqual(gyroDirs(0, { left: true, up: true }),
    { left: true, right: false, up: true, down: false });
  // 90 Grad: gelenkt wird mit runter/rauf (wie gyroTurn), Boost (logisch up)
  // wandert auf links, Ausrichten (logisch down) auf rechts.
  assert.deepEqual(gyroDirs(1, { down: true, left: true }),
    { left: true, right: false, up: true, down: false });
  assert.deepEqual(gyroDirs(1, { up: true, right: true }),
    { left: false, right: true, up: false, down: true });
  // 180 Grad: alles gespiegelt.
  assert.deepEqual(gyroDirs(2, { right: true, down: true }),
    { left: true, right: false, up: true, down: false });
  // Invarianten: jede physische Taste hat genau EINE Rolle, und gyroTurn
  // ist exakt links-minus-rechts aus gyroDirs (keine zweite Quelle).
  for (let orient = 0; orient < 4; orient++) {
    for (const key of ['left', 'right', 'up', 'down']) {
      const d = gyroDirs(orient, { [key]: true });
      assert.equal(Object.values(d).filter(Boolean).length, 1,
        `orient ${orient}, Taste ${key}: genau eine Rolle`);
      assert.equal(gyroTurn(orient, { [key]: true }),
        (d.left ? 1 : 0) - (d.right ? 1 : 0));
    }
  }
});

test('Mapping wechselt erst beim Einrasten: waehrend des Spins bleibt orient alt', () => {
  const g = createGyro();
  startSpin(g, fixedRng([0.9, 0.9])); // +450 Grad
  gyroStep(g, g.dur / 2);
  assert.ok(g.spinning && g.roll > 0, 'mitten in der Rotation');
  assert.equal(g.orient, 0, 'orient haelt die alte Stellung');
  gyroStep(g, g.dur); // zu Ende drehen
  assert.equal(g.orient, 1, 'beim Einrasten uebernimmt die neue Stellung');
});

test('startSpin ist mit echtem rng deterministisch und liefert gueltige Betraege', () => {
  const g = createGyro();
  const rng = createRng(123);
  for (let i = 0; i < 20; i++) {
    startSpin(g, rng);
    assert.ok(GYRO.amounts.some((a) => Math.abs(Math.abs(g.delta) - a) < EPS));
    while (g.spinning) gyroStep(g, 1 / 60);
    assert.equal(g.roll % QUARTER, 0);
  }
});

test('shortestRoll: kuerzester Weg, Bereich [-PI, PI)', () => {
  assert.equal(shortestRoll(0), 0);
  assert.ok(Math.abs(shortestRoll(1.5 * Math.PI) - (-0.5 * Math.PI)) < 1e-12, '270 Grad -> -90');
  assert.ok(Math.abs(shortestRoll(-1.5 * Math.PI) - 0.5 * Math.PI) < 1e-12, '-270 Grad -> +90');
  assert.ok(Math.abs(shortestRoll(2 * Math.PI)) < 1e-12, '360 Grad -> 0 (nichts auszudrehen)');
  assert.ok(Math.abs(shortestRoll(5 * Math.PI) - (-Math.PI)) < 1e-12, 'ungerade Vielfache -> -PI');
  assert.ok(Math.abs(shortestRoll(0.25 * Math.PI) - 0.25 * Math.PI) < 1e-12, 'kleine Winkel unveraendert');
});

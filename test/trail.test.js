// Tests fuer die praezise Weg-Aufzeichnung (world/trail.js): echte Positionen
// statt Zellmitten, gerade Strecken zusammengefasst, Kurven mit Zwischenpunkten.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordTrailPoint } from '../src/world/trail.js';

const MIN = 0.05;

test('erster Punkt wird immer aufgenommen', () => {
  const trail = [];
  recordTrailPoint(trail, 1.5, 2.5, { minDist: MIN });
  assert.deepEqual(trail, [[1.5, 2.5]]);
});

test('Punkte unterhalb der Mindestdistanz werden uebersprungen', () => {
  const trail = [[0, 0]];
  recordTrailPoint(trail, MIN * 0.5, 0, { minDist: MIN });
  assert.equal(trail.length, 1);
  recordTrailPoint(trail, MIN * 2, 0, { minDist: MIN });
  assert.equal(trail.length, 2);
});

test('gerade Strecke bleibt genau 2 Punkte (Segment wird verlaengert)', () => {
  const trail = [[0, 0]];
  for (let i = 1; i <= 100; i++) {
    recordTrailPoint(trail, i * 0.1, 0, { minDist: MIN });
  }
  assert.equal(trail.length, 2);
  assert.deepEqual(trail[1], [10, 0]); // Endpunkt exakt an der letzten Position
});

test('eine Ecke erzeugt einen Knickpunkt (L-Weg = 3 Punkte)', () => {
  const trail = [[0, 0]];
  for (let i = 1; i <= 10; i++) recordTrailPoint(trail, i * 0.1, 0, { minDist: MIN });
  for (let i = 1; i <= 10; i++) recordTrailPoint(trail, 1, i * 0.1, { minDist: MIN });
  assert.equal(trail.length, 3);
  assert.deepEqual(trail, [[0, 0], [1, 0], [1, 1]]);
});

test('Umkehren auf derselben Linie erzeugt einen Punkt (kein Rueckwaerts-Verlaengern)', () => {
  const trail = [[0, 0]];
  for (let i = 1; i <= 10; i++) recordTrailPoint(trail, i * 0.1, 0, { minDist: MIN });
  for (let i = 9; i >= 0; i--) recordTrailPoint(trail, i * 0.1, 0, { minDist: MIN });
  // Hin [0,0]->[1,0], zurueck [1,0]->[0,0]: der Wendepunkt bleibt erhalten.
  assert.equal(trail.length, 3);
  assert.deepEqual(trail[1], [1, 0]);
  assert.deepEqual(trail[2], [0, 0]);
});

test('eine Kurve erzeugt Zwischenpunkte (Bogen wird nicht zur Geraden)', () => {
  const trail = [];
  const r = 1;
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * (Math.PI / 2); // Viertelkreis
    recordTrailPoint(trail, r * Math.cos(a), r * Math.sin(a), { minDist: MIN });
  }
  assert.ok(trail.length >= 5, `Viertelkreis braucht Zwischenpunkte, hat ${trail.length}`);
  // Alle Punkte liegen (nahe) auf dem Kreis -> es sind echte Positionen.
  for (const [x, z] of trail) {
    assert.ok(Math.abs(Math.hypot(x, z) - r) < 0.01);
  }
});

test('force nimmt den letzten Punkt auch unterhalb der Mindestdistanz auf', () => {
  const trail = [[0, 0], [1, 0]];
  recordTrailPoint(trail, 1 + MIN * 0.2, 0.01, { minDist: MIN, force: true });
  assert.equal(trail[trail.length - 1][0], 1 + MIN * 0.2);
  // Identische Position wird auch mit force nicht dupliziert.
  const len = trail.length;
  recordTrailPoint(trail, 1 + MIN * 0.2, 0.01, { minDist: MIN, force: true });
  assert.equal(trail.length, len);
});

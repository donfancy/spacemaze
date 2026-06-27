import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, clipNear, focalLength } from '../src/render/projection.js';

const VP = { width: 800, height: 600, fov: Math.PI / 2, near: 0.1 };

test('focalLength bei 90 Grad FOV = halbe Hoehe', () => {
  assert.ok(Math.abs(focalLength(Math.PI / 2, 600) - 300) < 1e-9);
});

test('Punkt direkt voraus landet in der Bildmitte', () => {
  const p = project([0, 0, -10], VP);
  assert.ok(p);
  assert.ok(Math.abs(p.x - 400) < 1e-9);
  assert.ok(Math.abs(p.y - 300) < 1e-9);
});

test('+y (oben in der Welt) ergibt kleineres Bild-y (weiter oben)', () => {
  const p = project([0, 1, -10], VP);
  assert.ok(p.y < 300);
});

test('Punkt auf/hinter der Near-Plane wird verworfen', () => {
  assert.equal(project([0, 0, 0], VP), null);
  assert.equal(project([0, 0, 0.5], VP), null);
  assert.equal(project([0, 0, -0.05], VP), null); // naeher als near
});

test('perspektivische Verkleinerung mit Entfernung', () => {
  const near = project([1, 0, -5], VP);
  const far = project([1, 0, -50], VP);
  // Gleicher Welt-x, weiter weg -> naeher an der Bildmitte.
  assert.ok(Math.abs(far.x - 400) < Math.abs(near.x - 400));
});

test('clipNear: beide sichtbar -> unveraendert', () => {
  const a = [0, 0, -5];
  const b = [0, 0, -10];
  const res = clipNear(a, b, 0.1);
  assert.deepEqual(res, [a, b]);
});

test('clipNear: beide hinter der Plane -> null', () => {
  assert.equal(clipNear([0, 0, 1], [0, 0, 2], 0.1), null);
});

test('clipNear: ein Punkt davor -> am Plane abgeschnitten', () => {
  const a = [0, 0, -2]; // sichtbar
  const b = [0, 0, 2];  // hinter Kamera
  const res = clipNear(a, b, 0.1);
  assert.ok(res);
  assert.deepEqual(res[0], a);
  assert.ok(Math.abs(res[1][2] - -0.1) < 1e-9); // Schnittpunkt auf z = -near
});

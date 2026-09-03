import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, clipNear, focalLength, verticalFov } from '../src/render/projection.js';

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

// --- Schmale-Achse-Regel (1.9.2026, Hochformat) ------------------------------

test('Querformat: das Sichtfeld gilt wie bisher ueber die Hoehe', () => {
  const p = project([0, 1, -1], { width: 800, height: 600, fov: Math.PI / 2, near: 0.1 });
  assert.ok(Math.abs(p.y - 0) < 1e-9, 'oberer Bildrand bei 90 Grad');
});

test('Hochformat: dasselbe Sichtfeld gilt ueber die BREITE (kein Tunnelblick)', () => {
  const vp = { width: 600, height: 800, fov: Math.PI / 2, near: 0.1 };
  const p = project([1, 0, -1], vp);
  assert.ok(Math.abs(p.x - 600) < 1e-9, 'rechter Bildrand bei 90 Grad horizontal');
  const q = project([0, 1, -1], vp);
  assert.ok(q.y > 0, 'vertikal bleibt dafuer Luft (mehr Himmel/Boden)');
});

test('verticalFov liefert das Three.js-Pendant: Hochformat weiter, Querformat unveraendert', () => {
  const fov = Math.PI / 2.4;
  assert.equal(verticalFov(fov, 800, 600), fov);
  const v = verticalFov(fov, 600, 800);
  // Horizontal ergibt sich daraus wieder exakt fov.
  const h = 2 * Math.atan(Math.tan(v / 2) * (600 / 800));
  assert.ok(Math.abs(h - fov) < 1e-12);
  assert.ok(v > fov);
});

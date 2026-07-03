import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, measureText } from '../src/render/vectorText.js';

test('leerer Text ergibt keine Linien', () => {
  assert.deepEqual(layoutText('', { size: 24 }), []);
  assert.deepEqual(layoutText(' ', { size: 24 }), []); // Space hat keine Strokes
});

test('measureText: breiter Text ist breiter', () => {
  const a = measureText('A', { size: 24 });
  const abc = measureText('ABC', { size: 24 });
  assert.ok(abc.width > a.width);
  assert.ok(a.width > 0);
});

test('mehrzeilig erhoeht die Hoehe', () => {
  const one = measureText('A', { size: 24 });
  const two = measureText('A\nB', { size: 24 });
  assert.ok(two.height > one.height);
});

test('layoutText liefert Polylinien mit >= 2 Punkten', () => {
  const polys = layoutText('AB', { size: 30, x: 0, y: 0 });
  assert.ok(polys.length > 0);
  for (const poly of polys) {
    assert.ok(poly.length >= 2);
    for (const pt of poly) {
      assert.equal(pt.length, 2);
      assert.equal(typeof pt[0], 'number');
      assert.equal(typeof pt[1], 'number');
    }
  }
});

test('zentrierter Text ist um x gespiegelt-symmetrisch', () => {
  const size = 24;
  const polys = layoutText('AA', { size, x: 100, align: 'center', baseline: 'top', y: 0 });
  const xs = polys.flat().map((p) => p[0]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  // Mittelpunkt der Ausdehnung sollte ~100 sein.
  assert.ok(Math.abs((minX + maxX) / 2 - 100) < 1e-6);
});

test('baseline=bottom legt Text oberhalb von y', () => {
  const size = 24;
  const polys = layoutText('A', { size, x: 0, y: 100, baseline: 'bottom' });
  const ys = polys.flat().map((p) => p[1]);
  assert.ok(Math.max(...ys) <= 100 + 1e-6);
});

test('groessere size skaliert die Geometrie', () => {
  const small = layoutText('A', { size: 10, x: 0, y: 0 });
  const big = layoutText('A', { size: 40, x: 0, y: 0 });
  const span = (polys) => {
    const ys = polys.flat().map((p) => p[1]);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(span(big) > span(small) * 3);
});

test('angle rotiert die Polylinien um den Anker', () => {
  const opts = { size: 24, x: 100, y: 200, align: 'center', baseline: 'middle' };
  const plain = layoutText('N', opts);
  const rotated = layoutText('N', { ...opts, angle: Math.PI / 2 });
  assert.equal(rotated.length, plain.length);
  // Jeder Punkt (px,py) muss auf (x - (py-y), y + (px-x)) landen (90 Grad im UZS).
  for (let p = 0; p < plain.length; p++) {
    for (let i = 0; i < plain[p].length; i++) {
      const [px, py] = plain[p][i];
      const [rx, ry] = rotated[p][i];
      assert.ok(Math.abs(rx - (100 - (py - 200))) < 1e-9);
      assert.ok(Math.abs(ry - (200 + (px - 100))) < 1e-9);
    }
  }
  // Abstand zum Anker bleibt erhalten (starre Drehung).
  const dist = ([a, b]) => Math.hypot(a - 100, b - 200);
  assert.ok(Math.abs(dist(plain[0][0]) - dist(rotated[0][0])) < 1e-9);
});

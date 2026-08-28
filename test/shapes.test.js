import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeMesh } from '../src/world/shapes.js';

test('cubeMesh hat 8 Ecken, 6 Flaechen, 12 Kanten', () => {
  const m = cubeMesh([0, 0, 0], 2);
  assert.equal(m.vertices.length, 8);
  assert.equal(m.faces.length, 6);
  assert.equal(m.edges.length, 12);
  for (const f of m.faces) assert.equal(f.length, 4);
  for (const e of m.edges) assert.equal(e[2].length, 2); // 2 angrenzende Flaechen
});

test('Wuerfel-Ecken liegen bei +/- halbe Kantenlaenge', () => {
  const m = cubeMesh([0, 0, 0], 2);
  for (const p of m.vertices) {
    for (const c of p) {
      assert.ok(Math.abs(Math.abs(c) - 1) < 1e-9);
    }
  }
});

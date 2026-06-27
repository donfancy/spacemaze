import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeMesh } from '../src/world/shapes.js';
import { faceNormal, isFaceVisible, classifyEdges } from '../src/world/visibility.js';
import { dot } from '../src/math/vec3.js';

test('faceNormal zeigt bei zentriertem Wuerfel nach aussen', () => {
  const m = cubeMesh([0, 0, 0], 2);
  for (const f of m.faces) {
    const n = faceNormal(m.vertices, f);
    // Summe der Flaechen-Ecken zeigt vom Ursprung zur Flaechenmitte; die Aussen-
    // normale muss in dieselbe Richtung weisen.
    const c = f.reduce((a, i) => [a[0] + m.vertices[i][0], a[1] + m.vertices[i][1], a[2] + m.vertices[i][2]], [0, 0, 0]);
    assert.ok(dot(n, c) > 0, 'Normale zeigt nach innen');
  }
});

test('isFaceVisible: Frontflaeche sichtbar, Rueckflaeche nicht (Kamera bei +z)', () => {
  const m = cubeMesh([0, 0, 0], 2);
  const cam = [0, 0, 10];
  assert.equal(isFaceVisible(m.vertices, m.faces[0], cam), true);  // front (+z)
  assert.equal(isFaceVisible(m.vertices, m.faces[1], cam), false); // back (-z)
});

test('classifyEdges: Summe sichtbar + verdeckt ist immer 12', () => {
  const m = cubeMesh([0, 0, 0], 2);
  for (const cam of [[0, 0, 10], [10, 0, 0], [0, 10, 0], [8, 8, 8], [-5, 3, -9], [2, -7, 4]]) {
    const { visible, hidden } = classifyEdges(m, cam);
    assert.equal(visible.length + hidden.length, 12, `cam ${cam}`);
  }
});

test('classifyEdges: frontale Sicht zeigt 4 Kanten, verdeckt 8', () => {
  const m = cubeMesh([0, 0, 0], 2);
  const { visible, hidden } = classifyEdges(m, [0, 0, 10]);
  assert.equal(visible.length, 4);
  assert.equal(hidden.length, 8);
});

test('classifyEdges: Eckansicht zeigt 9 Kanten, verdeckt 3', () => {
  const m = cubeMesh([0, 0, 0], 2);
  const { visible, hidden } = classifyEdges(m, [8, 8, 8]);
  assert.equal(visible.length, 9);
  assert.equal(hidden.length, 3);
});

test('classifyEdges ist deterministisch', () => {
  const m = cubeMesh([0, 0, 0], 2);
  assert.deepEqual(classifyEdges(m, [6, 4, 7]), classifyEdges(m, [6, 4, 7]));
});

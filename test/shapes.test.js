import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeEdges, cubeMesh, floorGrid, rotateSegmentsY } from '../src/world/shapes.js';

test('Wuerfel hat 12 Kanten', () => {
  const edges = cubeEdges([0, 0, 0], 2);
  assert.equal(edges.length, 12);
  for (const [a, b] of edges) {
    assert.equal(a.length, 3);
    assert.equal(b.length, 3);
  }
});

test('cubeMesh hat 8 Ecken, 6 Flaechen, 12 Kanten', () => {
  const m = cubeMesh([0, 0, 0], 2);
  assert.equal(m.vertices.length, 8);
  assert.equal(m.faces.length, 6);
  assert.equal(m.edges.length, 12);
  for (const f of m.faces) assert.equal(f.length, 4);
  for (const e of m.edges) assert.equal(e[2].length, 2); // 2 angrenzende Flaechen
});

test('Wuerfel-Ecken liegen bei +/- halbe Kantenlaenge', () => {
  const edges = cubeEdges([0, 0, 0], 2);
  const pts = edges.flat();
  for (const p of pts) {
    for (const c of p) {
      assert.ok(Math.abs(Math.abs(c) - 1) < 1e-9);
    }
  }
});

test('floorGrid erzeugt symmetrisches Gitter', () => {
  const segs = floorGrid(0, 2, 1); // i = -2,-1,0,1,2 -> 5 Linien je Richtung
  assert.equal(segs.length, 10);
  // Alle Punkte liegen auf y = 0.
  for (const [a, b] of segs) {
    assert.equal(a[1], 0);
    assert.equal(b[1], 0);
  }
});

test('rotateSegmentsY um 0 laesst Geometrie unveraendert', () => {
  const segs = cubeEdges([0, 0, 0], 2);
  const rot = rotateSegmentsY(segs, [0, 0, 0], 0);
  for (let i = 0; i < segs.length; i++) {
    for (let e = 0; e < 2; e++) {
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(segs[i][e][c] - rot[i][e][c]) < 1e-9);
      }
    }
  }
});

test('rotateSegmentsY um 2*PI ist (fast) identisch', () => {
  const segs = cubeEdges([1, 1, 1], 2);
  const rot = rotateSegmentsY(segs, [1, 1, 1], Math.PI * 2);
  for (let i = 0; i < segs.length; i++) {
    for (let e = 0; e < 2; e++) {
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(segs[i][e][c] - rot[i][e][c]) < 1e-9);
      }
    }
  }
});

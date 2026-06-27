import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, OPEN } from '../src/world/maze.js';
import {
  corridorOutline, growthOutline, mapGridToWorld, mapSegmentsToWorld, gridBorderWorld,
} from '../src/world/mazeGeometry.js';
import { createRng } from '../src/util/rng.js';

function maze(n = 11, seed = 20260627) {
  return generateMaze(n, { rng: createRng(seed) });
}

// Grad jedes Gittervertex in der Liniemenge (fuer Kontur-Test).
function vertexDegrees(segments) {
  const deg = new Map();
  const bump = (x, y) => deg.set(`${x},${y}`, (deg.get(`${x},${y}`) || 0) + 1);
  for (const [a, b] of segments) { bump(a[0], a[1]); bump(b[0], b[1]); }
  return deg;
}

test('erzeugt nur Einheitskanten (Laenge 1)', () => {
  const segs = corridorOutline(maze(11));
  assert.ok(segs.length > 0);
  for (const [[x1, y1], [x2, y2]] of segs) {
    assert.equal(Math.abs(x2 - x1) + Math.abs(y2 - y1), 1);
  }
});

test('jede Randlinie trennt genau offen von nicht-offen', () => {
  const m = maze(11);
  const isOpen = (x, y) => x >= 0 && x < m.n && y >= 0 && y < m.n && m.grid[y][x] === OPEN;
  for (const [[x1, y1], [x2, y2]] of corridorOutline(m)) {
    if (y1 === y2) {
      // horizontale Kante auf y=y1: trennt Zelle (x1,y1-1) von (x1,y1)
      assert.ok(isOpen(x1, y1 - 1) !== isOpen(x1, y1), `h-Kante ${x1},${y1} trennt nicht`);
    } else {
      // vertikale Kante auf x=x1: trennt Zelle (x1-1,y1) von (x1,y1)
      assert.ok(isOpen(x1 - 1, y1) !== isOpen(x1, y1), `v-Kante ${x1},${y1} trennt nicht`);
    }
  }
});

test('keine doppelten Segmente', () => {
  const segs = corridorOutline(maze(11));
  const seen = new Set();
  for (const [a, b] of segs) {
    const key = `${a[0]},${a[1]}-${b[0]},${b[1]}`;
    assert.ok(!seen.has(key), `Duplikat: ${key}`);
    seen.add(key);
  }
});

test('Randlinien bilden geschlossene Konturen (jeder Vertex hat geraden Grad)', () => {
  for (const [, d] of vertexDegrees(corridorOutline(maze(11)))) {
    assert.equal(d % 2, 0);
  }
});

test('deterministisch fuer gleichen Seed', () => {
  assert.deepEqual(
    corridorOutline(generateMaze(11, { seed: 7 })),
    corridorOutline(generateMaze(11, { seed: 7 })),
  );
});

test('robust ueber mehrere n und Seeds (immer geschlossene Konturen)', () => {
  for (const n of [7, 9, 11, 13]) {
    for (let seed = 1; seed <= 10; seed++) {
      const segs = corridorOutline(generateMaze(n, { seed }));
      assert.ok(segs.length > 0, `n=${n} seed=${seed}: keine Segmente`);
      for (const [, d] of vertexDegrees(segs)) {
        assert.equal(d % 2, 0, `n=${n} seed=${seed}: offener Vertex`);
      }
    }
  }
});

test('growthOutline: k=0 ist leer, voll deckt die inneren Konturen ab', () => {
  const m = maze(11);
  assert.equal(growthOutline(m, 0).length, 0);
  assert.ok(growthOutline(m, m.order.length).length > 0);
});

test('growthOutline liefert NIE Aussenrand-Segmente, fuer jedes k', () => {
  const m = maze(11);
  for (let k = 0; k <= m.order.length; k++) {
    for (const [[x1, y1], [x2, y2]] of growthOutline(m, k)) {
      const onBorder = (y1 === y2 && (y1 === 0 || y1 === 11)) || (x1 === x2 && (x1 === 0 || x1 === 11));
      assert.ok(!onBorder, `k=${k}: Aussenrand-Segment durchgerutscht`);
    }
  }
});

test('mapGridToWorld bildet das Grid-Quadrat auf die Ebene ab', () => {
  assert.deepEqual(mapGridToWorld(0, 0, 11, 2.4, 1.2), [-1.2, 1.2, -1.2]);
  assert.deepEqual(mapGridToWorld(11, 11, 11, 2.4, 1.2), [1.2, 1.2, 1.2]);
  assert.deepEqual(mapGridToWorld(5.5, 5.5, 11, 2.4, 1.2), [0, 1.2, 0]);
});

test('gridBorderWorld: 4 Segmente, alle in der Ebene y=planeY', () => {
  const segs = gridBorderWorld(11, 2.4, 1.2);
  assert.equal(segs.length, 4);
  for (const [a, b] of segs) {
    assert.equal(a[1], 1.2);
    assert.equal(b[1], 1.2);
  }
});

test('mapSegmentsToWorld mappt 2D-Segmente in die Ebene', () => {
  const world = mapSegmentsToWorld([[[0, 0], [1, 0]]], 11, 2.4, 1.2);
  assert.equal(world.length, 1);
  assert.deepEqual(world[0][0], [-1.2, 1.2, -1.2]);
});

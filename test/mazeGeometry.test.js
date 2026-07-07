import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, OPEN } from '../src/world/maze.js';
import { corridorOutline, growthOutline, mergeCollinear } from '../src/world/mazeGeometry.js';
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
      assert.ok(isOpen(x1, y1 - 1) !== isOpen(x1, y1), `h-Kante ${x1},${y1} trennt nicht`);
    } else {
      assert.ok(isOpen(x1 - 1, y1) !== isOpen(x1, y1), `v-Kante ${x1},${y1} trennt nicht`);
    }
  }
});

test('keine doppelten Segmente', () => {
  const seen = new Set();
  for (const [a, b] of corridorOutline(maze(11))) {
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

test('mergeCollinear: fasst gerade Zuege zusammen, laesst Ecken/Luecken getrennt', () => {
  // Gerader Zug aus drei Einheitskanten -> ein Segment.
  assert.deepEqual(
    mergeCollinear([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [3, 0]]]),
    [[[0, 0], [3, 0]]],
  );
  // Ecke (horizontal + vertikal am selben Vertex) bleibt zwei Segmente.
  const corner = mergeCollinear([[[0, 0], [1, 0]], [[1, 0], [1, 1]]]);
  assert.equal(corner.length, 2);
  // Luecke auf derselben Linie wird NICHT ueberbrueckt.
  const gap = mergeCollinear([[[0, 0], [1, 0]], [[2, 0], [3, 0]]]);
  assert.equal(gap.length, 2);
  // Reihenfolge egal (unsortierte Eingabe).
  assert.deepEqual(
    mergeCollinear([[[2, 5], [3, 5]], [[0, 5], [1, 5]], [[1, 5], [2, 5]]]),
    [[[0, 5], [3, 5]]],
  );
});

test('mergeCollinear: Geometrie-Union bleibt exakt erhalten (echtes Labyrinth)', () => {
  const fine = corridorOutline(maze(11));
  const merged = mergeCollinear(fine);
  assert.ok(merged.length < fine.length / 2, `deutlich weniger Segmente (${fine.length} -> ${merged.length})`);
  // Jede feine Einheitskante liegt in genau einem zusammengefassten Zug,
  // und die Gesamtlaenge ist identisch (nichts verlaengert/verkuerzt).
  const covers = ([[ax, ay], [bx, by]], [[x1, y1], [x2, y2]]) => {
    const [lo1, hi1] = [Math.min(x1, x2), Math.max(x1, x2)];
    const [lo2, hi2] = [Math.min(y1, y2), Math.max(y1, y2)];
    return Math.min(ax, bx) >= lo1 && Math.max(ax, bx) <= hi1
      && Math.min(ay, by) >= lo2 && Math.max(ay, by) <= hi2;
  };
  for (const seg of fine) {
    const hits = merged.filter((r) => covers(seg, r));
    assert.equal(hits.length, 1, `Einheitskante ${JSON.stringify(seg)} in genau einem Zug`);
  }
  const len = (segs) => segs.reduce((s, [a, b]) => s + Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), 0);
  assert.equal(len(merged), len(fine), 'Gesamtlaenge unveraendert');
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

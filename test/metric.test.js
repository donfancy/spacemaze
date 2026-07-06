// Tests fuer die Achsen-Metrik (schmale Waende): world/metric.js selbst und
// ihre Wirkung auf mazeWorld (Waende, Kollision) und cubeFaces (Flaechen-Mapping).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetric, UNIFORM_METRIC, mazeMetric } from '../src/world/metric.js';
import { generateMaze, OPEN, WALL } from '../src/world/maze.js';
import { wallFootprints, cellCenter, cellAt, isWalkable, rectWalkable, tryMove } from '../src/world/mazeWorld.js';
import { SIDE_FACES, mapGridToFace } from '../src/world/cubeFaces.js';

const THIN = { wall: 1, corridor: 5 };

test('uniforme Metrik: toUnits ist die Identitaet, total(n) = n', () => {
  for (const g of [0, 0.5, 1, 2.75, 7, 11]) {
    assert.equal(UNIFORM_METRIC.toUnits(g), g);
    assert.equal(UNIFORM_METRIC.toGrid(g), g);
  }
  assert.equal(UNIFORM_METRIC.total(9), 9);
});

test('schmale Waende: gerade Zellen 1 Einheit, ungerade 5, total stimmt', () => {
  const m = createMetric(THIN);
  // Vorderkanten: 0 |1| 6 |7| 12 ... (wall, corridor, wall, corridor, ...)
  assert.equal(m.toUnits(0), 0);
  assert.equal(m.toUnits(1), 1);
  assert.equal(m.toUnits(2), 6);
  assert.equal(m.toUnits(3), 7);
  assert.equal(m.toUnits(4), 12);
  // Zellbreiten nach Paritaet.
  for (let i = 0; i < 9; i++) {
    const width = m.toUnits(i + 1) - m.toUnits(i);
    assert.equal(width, i % 2 === 0 ? 1 : 5, `Zelle ${i}`);
  }
  // n=9: 5 gerade + 4 ungerade Zellen -> 5*1 + 4*5 = 25 Einheiten.
  assert.equal(m.total(9), 25);
  // Innerhalb einer Zelle linear: Mitte von Zelle 1 (Kammer) bei 1 + 2.5.
  assert.equal(m.toUnits(1.5), 3.5);
  assert.equal(m.toUnits(0.5), 0.5);
});

test('toGrid ist die Umkehrung von toUnits (auch ausserhalb von [0,n])', () => {
  const m = createMetric(THIN);
  for (const g of [-1.3, -0.2, 0, 0.4, 1, 1.5, 2, 2.9, 3.5, 8, 10.01]) {
    assert.ok(Math.abs(m.toGrid(m.toUnits(g)) - g) < 1e-12, `Roundtrip fuer g=${g}`);
  }
});

test('die Grid-Mitte liegt auch in Einheiten genau in der Mitte (n ungerade)', () => {
  const m = createMetric(THIN);
  for (const n of [9, 11, 17]) {
    // Das Breitenmuster ist ein Palindrom (beginnt und endet mit wall).
    assert.equal(m.toUnits(n / 2), m.total(n) / 2);
  }
});

test('createMetric validiert die Breiten', () => {
  assert.throws(() => createMetric({ wall: 0, corridor: 5 }));
  assert.throws(() => createMetric({ wall: 1, corridor: -2 }));
});

test('generateMaze traegt die Metrik am Maze; mazeMetric hat den uniformen Fallback', () => {
  const thin = generateMaze(9, { seed: 3, metric: THIN });
  assert.equal(thin.metric.corridor, 5);
  const block = generateMaze(9, { seed: 3 });
  assert.equal(block.metric.toUnits(4.2), 4.2); // uniform
  assert.equal(mazeMetric({ n: 3, grid: [] }), UNIFORM_METRIC);
});

test('gleicher Seed: Metrik aendert NUR die Darstellung, nicht das Labyrinth', () => {
  const a = generateMaze(11, { seed: 42 });
  const b = generateMaze(11, { seed: 42, metric: THIN });
  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(a.start, b.start);
  assert.deepEqual(a.goal, b.goal);
  assert.deepEqual(a.order, b.order);
});

test('wallFootprints: alle Koordinaten liegen auf Zellkanten der Metrik', () => {
  const m = generateMaze(9, { seed: 11, metric: THIN });
  const edges = new Set();
  for (let i = 0; i <= 9; i++) edges.add(m.metric.toUnits(i));
  for (const [a, b] of wallFootprints(m, { unit: 1 })) {
    for (const p of [a, b]) {
      assert.ok(edges.has(p[0]), `x=${p[0]} ist eine Zellkante`);
      assert.ok(edges.has(p[2]), `z=${p[2]} ist eine Zellkante`);
    }
  }
});

test('cellCenter/cellAt: Kammermitte liegt in der Kammer, Roundtrip stimmt', () => {
  const m = generateMaze(9, { seed: 11, metric: THIN });
  const [cx, cz] = cellCenter(m, m.start[0], m.start[1], 1);
  assert.deepEqual(cellAt(m, cx, cz, 1), m.start);
  // Kammer 1 beginnt bei Einheit 1 und ist 5 breit -> Mitte bei 3.5.
  assert.deepEqual(cellCenter(m, 1, 1, 1), [3.5, 3.5]);
  // Mit unit-Skalierung (Float-Toleranz).
  for (const c of cellCenter(m, 1, 1, 0.1)) assert.ok(Math.abs(c - 0.35) < 1e-12);
});

test('tryMove: eine 1 Einheit schmale Wand blockiert trotzdem', () => {
  // Mini-Grid: Kammer(1,1) | Zwischenwand(2,1) zu | Kammer(3,1), schmale Metrik.
  const grid = [
    [WALL, WALL, WALL, WALL, WALL],
    [WALL, OPEN, WALL, OPEN, WALL],
    [WALL, WALL, WALL, WALL, WALL],
  ];
  const m = { n: 5, grid, metric: createMetric(THIN) };
  // Start: Mitte von Kammer (1,1) -- Zeile gy=1 belegt die Einheiten 1..6,
  // also x = z = toUnits(1.5) = 3.5.
  const radius = 1.25; // 0.25 Gangbreiten
  // Schritt nach +x gegen die geschlossene Zwischenwand (Kante bei Einheit 6).
  const [bx] = tryMove(m, 3.5, 3.5, 1.5, 0, { unit: 1, radius });
  assert.equal(bx, 3.5, 'Wand blockiert');
  // Kleiner Schritt innerhalb der Kammer geht (Kante 3.5+0.5+1.25 < 6).
  const [nx] = tryMove(m, 3.5, 3.5, 0.5, 0, { unit: 1, radius });
  assert.ok(Math.abs(nx - 4) < 1e-9, 'freie Bewegung in der Kammer');
});

test('tryMove haelt das Spieler-Quadrat auch bei schmalen Waenden in offenen Zellen', () => {
  const m = generateMaze(9, { seed: 7, metric: THIN });
  const radius = 1.25; // 0.25 Gangbreiten bei corridor=5
  let [x, z] = cellCenter(m, m.start[0], m.start[1], 1);
  let yaw = 0;
  for (let i = 0; i < 5000; i++) {
    yaw += Math.sin(i * 0.7) * 0.3;
    const step = 0.25; // Einheiten pro Schritt
    [x, z] = tryMove(m, x, z, -Math.sin(yaw) * step, -Math.cos(yaw) * step, { unit: 1, radius });
    // Das GANZE Quadrat (nicht nur Ecken -- Waende koennen schmaler sein).
    assert.ok(rectWalkable(m, x - radius, x + radius, z - radius, z + radius, 1),
      `Schritt ${i}: Quadrat um (${x.toFixed(2)}, ${z.toFixed(2)}) schneidet eine Wand`);
  }
});

test('tryMove: 1x1-Pfosten ZWISCHEN den Eckpunkten blockiert (Regression: durch Ecken fahren)', () => {
  // Kreuzung mit offenen Zwischenwaenden rund um den Pfeiler (2,2): der Spieler
  // steht im 1 Einheit schmalen offenen Durchgang (1,2) -- sein Quadrat (2.5
  // breit) ueberragt die Spur beidseitig. Seitlich (+x) liegt der 1x1-Pfeiler:
  // er passt exakt zwischen die beiden Eckpunkte bei z = 6.5 +- 1.25, reine
  // Eck-Checks fuhren frueher glatt durch ihn hindurch.
  const W = WALL, O = OPEN;
  const m = {
    n: 5,
    grid: [
      [W, W, W, W, W],
      [W, O, O, O, W],
      [W, O, W, O, W],
      [W, O, O, O, W],
      [W, W, W, W, W],
    ],
    metric: createMetric(THIN),
  };
  const radius = 1.25;
  // Mitte des Durchgangs (1,2): x = 3.5, z = 6.5 (Zeile 2 = Einheiten 6..7).
  const [bx] = tryMove(m, 3.5, 6.5, 1.5, 0, { unit: 1, radius });
  assert.equal(bx, 3.5, 'Pfeiler blockiert, obwohl beide Eckpunkte frei waeren');
  // Im offenen Gang (-z) faehrt man dagegen normal weiter.
  const [, nz] = tryMove(m, 3.5, 6.5, 0, -1.5, { unit: 1, radius });
  assert.ok(Math.abs(nz - 5) < 1e-9, 'freie Fahrt im Gang');
});

test('mapGridToFace mit Metrik: Grid-Mitte bleibt die Flaechenmitte, Ecken die Ecken', () => {
  const metric = createMetric(THIN);
  const front = SIDE_FACES[0];
  const n = 9, s = 2.4;
  const mid = mapGridToFace(n / 2, n / 2, n, s, front, metric);
  assert.ok(Math.hypot(mid[0], mid[1]) < 1e-12, 'Mitte bleibt Mitte');
  const corner = mapGridToFace(0, 0, n, s, front, metric);
  assert.ok(Math.abs(corner[0] + s / 2) < 1e-12 && Math.abs(corner[1] - s / 2) < 1e-12, 'Ecke bleibt Ecke');
  // Eine Kammer (Zelle 1) ist auf der Flaeche 5x so breit wie ein Pfosten (Zelle 0).
  const post = mapGridToFace(1, 0, n, s, front, metric)[0] - mapGridToFace(0, 0, n, s, front, metric)[0];
  const chamber = mapGridToFace(2, 0, n, s, front, metric)[0] - mapGridToFace(1, 0, n, s, front, metric)[0];
  assert.ok(Math.abs(chamber - 5 * post) < 1e-12);
});

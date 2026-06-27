import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMaze, isChamber, isPillar, chambersInQuadrant,
  reachable, findPath, WALL, OPEN,
} from '../src/world/maze.js';
import { createRng } from '../src/util/rng.js';

// Helfer: deterministisches Labyrinth fuer reproduzierbare Tests.
function maze(n = 11, seed = 20260627) {
  return generateMaze(n, { rng: createRng(seed) });
}

// Anzahl Kammern in einem n x n Grid: ((n-1)/2)^2.
function chamberCount(n) {
  const c = (n - 1) / 2;
  return c * c;
}

// Anzahl offener Verbindungen einer Kammer (ueber die 4 angrenzenden Zwischenwaende).
function openLinks(m, [cx, cy]) {
  let count = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && x < m.n && y >= 0 && y < m.n && m.grid[y][x] === OPEN) count++;
  }
  return count;
}

test('n muss eine ungerade Ganzzahl >= 7 sein', () => {
  assert.throws(() => generateMaze(10), /ungerade/);
  assert.throws(() => generateMaze(5), />= 7/);
  assert.doesNotThrow(() => maze(7));
  assert.doesNotThrow(() => maze(11));
});

test('Grid hat Groesse n x n', () => {
  const m = maze(11);
  assert.equal(m.n, 11);
  assert.equal(m.grid.length, 11);
  for (const row of m.grid) assert.equal(row.length, 11);
});

test('alle Kammern (ungerade,ungerade) sind offen', () => {
  const m = maze(11);
  for (let y = 1; y <= 9; y += 2) {
    for (let x = 1; x <= 9; x += 2) {
      assert.equal(m.grid[y][x], OPEN, `Kammer (${x},${y}) muss offen sein`);
    }
  }
});

test('alle Pfeiler (gerade,gerade) sind Wand', () => {
  const m = maze(11);
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      if (isPillar(x, y)) {
        assert.equal(m.grid[y][x], WALL, `Pfeiler (${x},${y}) muss Wand sein`);
      }
    }
  }
});

test('der gesamte Aussenrand ist Wand (keine Durchbrueche)', () => {
  const m = maze(11);
  for (let i = 0; i < 11; i++) {
    assert.equal(m.grid[0][i], WALL);
    assert.equal(m.grid[10][i], WALL);
    assert.equal(m.grid[i][0], WALL);
    assert.equal(m.grid[i][10], WALL);
  }
});

test('Start liegt in Quadrant 1, Ziel in Quadrant 3', () => {
  const m = maze(11);
  const q1 = chambersInQuadrant(11, 1).map((c) => c.join(','));
  const q3 = chambersInQuadrant(11, 3).map((c) => c.join(','));
  assert.ok(q1.includes(m.start.join(',')), `Start ${m.start} nicht in Q1`);
  assert.ok(q3.includes(m.goal.join(',')), `Ziel ${m.goal} nicht in Q3`);
  assert.ok(isChamber(...m.start) && isChamber(...m.goal));
});

test('perfektes Labyrinth: offene Zwischenwaende = Kammern - 1 (Spannbaum)', () => {
  const n = 11;
  const m = maze(n);
  let openWalls = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Zwischenwand = genau eine Koordinate gerade (gemischt).
      const mixed = (x % 2) !== (y % 2);
      if (mixed && m.grid[y][x] === OPEN) openWalls++;
    }
  }
  // Ein Spannbaum ueber K Kammern hat genau K-1 Kanten.
  assert.equal(openWalls, chamberCount(n) - 1);
});

test('alle Kammern sind vom Start aus erreichbar (verbunden)', () => {
  const n = 11;
  const m = maze(n);
  const seen = reachable(m, m.start);
  let chambersSeen = 0;
  for (let y = 1; y <= n - 2; y += 2) {
    for (let x = 1; x <= n - 2; x += 2) {
      if (seen.has(`${x},${y}`)) chambersSeen++;
    }
  }
  assert.equal(chambersSeen, chamberCount(n));
});

test('es existiert ein gueltiger Weg vom Start zum Ziel', () => {
  const m = maze(11);
  const path = findPath(m, m.start, m.goal);
  assert.ok(path, 'kein Weg gefunden');
  assert.deepEqual(path[0], m.start);
  assert.deepEqual(path[path.length - 1], m.goal);
  // Jede Wegzelle ist offen, jeder Schritt ist orthogonal benachbart.
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    assert.equal(m.grid[y][x], OPEN);
    if (i > 0) {
      const [px, py] = path[i - 1];
      assert.equal(Math.abs(x - px) + Math.abs(y - py), 1);
    }
  }
});

test('Determinismus: gleicher Seed -> identisches Labyrinth', () => {
  const a = generateMaze(11, { seed: 4242 });
  const b = generateMaze(11, { seed: 4242 });
  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(a.start, b.start);
  assert.deepEqual(a.goal, b.goal);
});

test('verschiedene Seeds erzeugen (in der Regel) verschiedene Labyrinthe', () => {
  const a = generateMaze(11, { seed: 1 });
  const b = generateMaze(11, { seed: 2 });
  assert.notDeepEqual(a.grid, b.grid);
});

test('Start S und Ziel G sind beide Sackgassen: je genau eine Verbindung (viele Seeds)', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const m = generateMaze(11, { seed });
    assert.equal(openLinks(m, m.start), 1,
      `seed ${seed}: S hat ${openLinks(m, m.start)} Verbindungen statt 1`);
    assert.equal(openLinks(m, m.goal), 1,
      `seed ${seed}: G hat ${openLinks(m, m.goal)} Verbindungen statt 1`);
  }
});

test('Terminierung erhaelt perfektes Labyrinth fuer n in {7,9,11,13,15} (viele Seeds)', () => {
  for (const n of [7, 9, 11, 13, 15]) {
    for (let seed = 1; seed <= 40; seed++) {
      const m = generateMaze(n, { seed });

      // Alle Kammern vom Start aus erreichbar (verbunden)?
      const seen = reachable(m, m.start);
      let chambers = 0;
      for (let y = 1; y <= n - 2; y += 2) {
        for (let x = 1; x <= n - 2; x += 2) {
          if (seen.has(`${x},${y}`)) chambers++;
        }
      }
      assert.equal(chambers, chamberCount(n), `n=${n} seed=${seed}: nicht alle Kammern verbunden`);

      // Spannbaum: offene Zwischenwaende = Kammern - 1 (genau ein Weg).
      let openWalls = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (((x % 2) !== (y % 2)) && m.grid[y][x] === OPEN) openWalls++;
        }
      }
      assert.equal(openWalls, chamberCount(n) - 1, `n=${n} seed=${seed}: kein Spannbaum`);

      // S und G beide Sackgassen.
      assert.equal(openLinks(m, m.start), 1, `n=${n} seed=${seed}: S keine Sackgasse`);
      assert.equal(openLinks(m, m.goal), 1, `n=${n} seed=${seed}: G keine Sackgasse`);
    }
  }
});

test('funktioniert auch fuer kleinstes n=7', () => {
  const n = 7;
  const m = maze(n);
  const seen = reachable(m, m.start);
  let chambersSeen = 0;
  for (let y = 1; y <= n - 2; y += 2) {
    for (let x = 1; x <= n - 2; x += 2) {
      if (seen.has(`${x},${y}`)) chambersSeen++;
    }
  }
  assert.equal(chambersSeen, chamberCount(n)); // 9 Kammern, alle verbunden
});

test('order enthaelt jede offene Zelle genau einmal, Start zuerst, Ziel enthalten', () => {
  const m = maze(11);
  let openCount = 0;
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      if (m.grid[y][x] === OPEN) openCount++;
    }
  }
  assert.equal(m.order.length, openCount);
  assert.deepEqual(m.order[0], m.start);

  const seen = new Set();
  for (const [x, y] of m.order) {
    const k = `${x},${y}`;
    assert.ok(!seen.has(k), `Duplikat in order: ${k}`);
    seen.add(k);
    assert.equal(m.grid[y][x], OPEN, `order-Zelle ${k} ist nicht offen`);
  }
  assert.ok(seen.has(m.goal.join(',')), 'Ziel fehlt in order');
});

test('order ist deterministisch fuer gleichen Seed', () => {
  assert.deepEqual(generateMaze(11, { seed: 123 }).order, generateMaze(11, { seed: 123 }).order);
});

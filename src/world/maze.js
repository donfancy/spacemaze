// Labyrinth-Erzeugung. Reine Berechnung, kein Canvas -> headless testbar.
//
// Modell (Spec von Boris):
//   - Quadratisches Grid n x n, n UNGERADE. Koordinaten (0,0) .. (n-1,n-1).
//   - Zellklassifikation nach Koordinaten-Paritaet:
//       beide ungerade  -> KAMMER   (Wegfeld, immer offen)
//       beide gerade     -> PFEILER  (immer Wand)
//       gemischt         -> ZWISCHENWAND (Wand zwischen zwei Kammern, oeffenbar)
//     Da n ungerade ist, sind 0 und n-1 gerade -> der gesamte Rand ist Wand.
//   - Recursive-Backtracker vom Startfeld: oeffnet zufaellig Zwischenwaende,
//     nie Durchbrueche nach aussen, bis alle Kammern verbunden sind.
//     Ergebnis: "perfektes" Labyrinth -> genau EIN Weg zwischen je zwei Kammern.
//   - Start: zufaellige Kammer in Quadrant 1 (grosses x & y).
//     Ziel:  zufaellige Kammer in Quadrant 3 (kleines x & y), diagonal gegenueber.

import { createRng, randomSeed, randInt } from '../util/rng.js';

export const WALL = 0;
export const OPEN = 1;

// Bewegungen zur jeweils naechsten Kammer (2 Felder weit) inkl. Richtung.
const STEP = [
  [2, 0], [-2, 0], [0, 2], [0, -2],
];

// Kammer = beide Koordinaten ungerade.
export function isChamber(x, y) {
  return (x % 2 === 1) && (y % 2 === 1);
}

// Pfeiler = beide Koordinaten gerade.
export function isPillar(x, y) {
  return (x % 2 === 0) && (y % 2 === 0);
}

// Alle Kammern eines Quadranten (bezogen auf die Grid-Mitte m=(n-1)/2).
//   q === 1 : x > m && y > m   (Start-Region)
//   q === 3 : x < m && y < m   (Ziel-Region, diagonal gegenueber)
// Kammern genau auf der Mittelachse (x===m oder y===m) gehoeren keinem Quadranten.
export function chambersInQuadrant(n, q) {
  const m = (n - 1) / 2;
  const result = [];
  for (let y = 1; y <= n - 2; y += 2) {
    for (let x = 1; x <= n - 2; x += 2) {
      const inQ =
        q === 1 ? (x > m && y > m) :
        q === 3 ? (x < m && y < m) :
        false;
      if (inQ) result.push([x, y]);
    }
  }
  return result;
}

// Erzeugt ein Labyrinth. options: { seed?, rng? }.
// Rueckgabe: { n, grid (grid[y][x] = WALL|OPEN), start:[x,y], goal:[x,y], seed }.
export function generateMaze(n = 11, options = {}) {
  if (!Number.isInteger(n) || n % 2 === 0) {
    throw new Error('n muss eine ungerade Ganzzahl sein, war ' + n);
  }
  if (n < 5) {
    throw new Error('n muss >= 5 sein, war ' + n);
  }

  const seed = options.seed ?? randomSeed();
  const rng = options.rng ?? createRng(seed);

  // Grid initialisieren: Kammern offen, alles andere Wand.
  const grid = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) {
      row.push(isChamber(x, y) ? OPEN : WALL);
    }
    grid.push(row);
  }

  // Start- und Zielkammer zufaellig aus ihrer Region waehlen.
  const startList = chambersInQuadrant(n, 1);
  const goalList = chambersInQuadrant(n, 3);
  const start = [...startList[randInt(rng, startList.length)]];
  const goal = [...goalList[randInt(rng, goalList.length)]];

  // Recursive Backtracker (iterativ mit Stack) ueber die Kammern.
  carve(grid, n, start, rng);

  return { n, grid, start, goal, seed };
}

// Hoehlt die Zwischenwaende aus, bis ein Spannbaum ueber alle Kammern entsteht.
function carve(grid, n, start, rng) {
  const key = (x, y) => x + ',' + y;
  const visited = new Set([key(start[0], start[1])]);
  const stack = [start];

  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1];

    // Unbesuchte Nachbarkammern (2 Felder entfernt, innerhalb der Aussenwaende).
    const candidates = [];
    for (const [dx, dy] of STEP) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 1 || nx > n - 2 || ny < 1 || ny > n - 2) continue;
      if (visited.has(key(nx, ny))) continue;
      candidates.push([nx, ny, dx, dy]);
    }

    if (candidates.length === 0) {
      stack.pop(); // Sackgasse -> zurueck
      continue;
    }

    const [nx, ny, dx, dy] = candidates[randInt(rng, candidates.length)];
    // Zwischenwand zwischen aktueller und Nachbarkammer oeffnen.
    grid[cy + dy / 2][cx + dx / 2] = OPEN;
    visited.add(key(nx, ny));
    stack.push([nx, ny]);
  }
}

// Menge aller von `from` aus erreichbaren offenen Zellen (als "x,y"-Strings).
// Nuetzlich fuer Verbundenheitstests und spaeter fuers Gameplay.
export function reachable(maze, from) {
  const { n, grid } = maze;
  const key = (x, y) => x + ',' + y;
  const seen = new Set([key(from[0], from[1])]);
  const stack = [from];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (stack.length > 0) {
    const [cx, cy] = stack.pop();
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
      if (grid[ny][nx] !== OPEN) continue;
      if (seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny));
      stack.push([nx, ny]);
    }
  }
  return seen;
}

// Kuerzester Weg (BFS) von `from` nach `to` ueber offene Zellen.
// Liefert ein Array von [x,y] (inkl. Start und Ziel) oder null, wenn unerreichbar.
// In einem perfekten Labyrinth ist dieser Weg zugleich der EINZIGE einfache Weg.
export function findPath(maze, from, to) {
  const { n, grid } = maze;
  const key = (x, y) => x + ',' + y;
  const prev = new Map([[key(from[0], from[1]), null]]);
  const queue = [from];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (queue.length > 0) {
    const [cx, cy] = queue.shift();
    if (cx === to[0] && cy === to[1]) {
      const path = [];
      let cur = [cx, cy];
      while (cur) {
        path.unshift(cur);
        cur = prev.get(key(cur[0], cur[1]));
      }
      return path;
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
      if (grid[ny][nx] !== OPEN) continue;
      if (prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [cx, cy]);
      queue.push([nx, ny]);
    }
  }
  return null;
}

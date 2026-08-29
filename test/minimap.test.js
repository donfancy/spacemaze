import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../src/world/maze.js';
import {
  MINIMAP, PLAYER_MARK, minimapWalls, cellCenterCells, minimapModel,
} from '../src/render2026/minimap.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function blockMaze(n = 11, seed = 20260829) {
  return generateMaze(n, { seed });
}

function narrowMaze(n = 17, seed = 20260829) {
  return generateMaze(n, { seed, metric: { wall: 1, corridor: 5 } });
}

// --- Wand-Kontur in Gangbreiten ---------------------------------------------

test('minimapWalls: Blockwelt liefert Kontur in Grid-Einheiten', () => {
  const maze = blockMaze();
  const walls = minimapWalls(maze);
  assert.ok(walls.length > 0);
  for (const [[x1, y1], [x2, y2]] of walls) {
    // uniforme Metrik: alle Koordinaten bleiben ganzzahlig, achsparallel
    assert.equal(x1 === x2 || y1 === y2, true);
    for (const v of [x1, y1, x2, y2]) close(v, Math.round(v));
  }
});

test('minimapWalls: schmale Waende sind auf Gangbreite normiert', () => {
  const maze = narrowMaze();
  const walls = minimapWalls(maze);
  // Gesamtausdehnung: total(n)/corridor Gangbreiten
  const total = maze.metric.total(maze.n) / maze.metric.corridor;
  for (const [[x1, y1], [x2, y2]] of walls) {
    for (const v of [x1, x2]) assert.ok(v >= 0 && v <= total);
    for (const v of [y1, y2]) assert.ok(v >= 0 && v <= total);
  }
  // Wand-Spur (1 Einheit) misst 0.2 Gangbreiten: es gibt Koordinaten mit
  // Abstand 0.2 zum Zellenpaar-Raster (1.2, 2.4, ...), keine muss ganz sein.
  const frac = walls.flat().flat().some((v) => Math.abs(v - Math.round(v)) > 1e-9);
  assert.ok(frac, 'Metrik wirkt nicht auf die Kontur');
});

test('cellCenterCells: Kammer-Zentrum liegt in der Gang-Mitte', () => {
  const maze = narrowMaze();
  const [x] = cellCenterCells(maze, 1, 1); // Zelle 1 = erste Kammer
  // Vorderkante bei 1 Einheit (Wand), Mitte bei 1 + 2.5 = 3.5 Einheiten = 0.7 Gangbreiten
  close(x, 3.5 / 5);
});

// --- Scheiben-Transformation (heading up) -----------------------------------

const base = { walls: [], px: 10, pz: 10, radius: 5 };

test('Punkt voraus liegt oben, unabhaengig vom yaw', () => {
  for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) {
    const fx = 10 - Math.sin(yaw) * 3; // 3 Gangbreiten voraus
    const fz = 10 - Math.cos(yaw) * 3;
    const m = minimapModel({ ...base, yaw, foes: [{ x: fx, z: fz }] });
    close(m.foes[0].x, 0, 1e-9);
    close(m.foes[0].y, 3 / 5, 1e-9);
  }
});

test('Blick nach Norden: Osten rechts, Sueden unten', () => {
  const m = minimapModel({ ...base, yaw: 0,
    foes: [{ x: 12, z: 10, id: 'ost' }, { x: 10, z: 12, id: 'sued' }] });
  const ost = m.foes.find((f) => f.id === 'ost');
  const sued = m.foes.find((f) => f.id === 'sued');
  close(ost.x, 2 / 5); close(ost.y, 0);
  close(sued.x, 0); close(sued.y, -2 / 5);
});

test('Blick nach Westen (yaw=+90): Norden liegt rechts', () => {
  const m = minimapModel({ ...base, yaw: Math.PI / 2, foes: [{ x: 10, z: 8 }] });
  close(m.foes[0].x, 2 / 5);
  close(m.foes[0].y, 0, 1e-9);
});

test('N-Marke dreht mit: oben bei yaw=0, rechts bei Blick nach Westen', () => {
  const n0 = minimapModel({ ...base, yaw: 0 }).north;
  close(n0.x, 0); close(n0.y, MINIMAP.northR);
  const nw = minimapModel({ ...base, yaw: Math.PI / 2 }).north;
  close(nw.x, MINIMAP.northR); close(nw.y, 0, 1e-9);
});

// --- Kreis-Clipping ----------------------------------------------------------

test('Waende: innen bleibt, aussen faellt weg, kreuzend wird gekuerzt', () => {
  const m = minimapModel({ ...base, yaw: 0, walls: [
    [[9, 9], [11, 9]],     // ganz innen
    [[30, 30], [31, 30]],  // weit draussen
    [[10, 10], [30, 10]],  // laeuft aus dem Kreis hinaus
  ] });
  assert.equal(m.walls.length, 2);
  // das gekuerzte Segment endet exakt auf dem Einheitskreis
  const cut = m.walls.find(([x1]) => Math.abs(x1) < 1e-9);
  close(Math.hypot(cut[2], cut[3]), 1);
});

test('langes Segment, dessen Enden beide draussen liegen, wird durchgeclippt', () => {
  const m = minimapModel({ ...base, yaw: 0, walls: [[[-100, 9], [100, 9]]] });
  assert.equal(m.walls.length, 1);
  const [x1, y1, x2, y2] = m.walls[0];
  close(Math.hypot(x1, y1), 1);
  close(Math.hypot(x2, y2), 1);
  close(y1, 1 / 5); close(y2, 1 / 5); // Wand 1 noerdlich -> oben
});

test('Sehne, die den Kreis verfehlt, liefert nichts', () => {
  const m = minimapModel({ ...base, yaw: 0, walls: [[[-100, 16], [100, 16]]] });
  assert.equal(m.walls.length, 0);
});

test('Trail wird als Segmentzug geclippt', () => {
  const m = minimapModel({ ...base, yaw: 0,
    trail: [[10, 10], [12, 10], [12, 30]] });
  assert.equal(m.trail.length, 2);
  const [, , , y2] = m.trail[1];
  close(Math.hypot(m.trail[1][2], y2), 1); // zweites Stueck endet am Kreis
});

test('Feinde ausserhalb markR erscheinen nicht', () => {
  const m = minimapModel({ ...base, yaw: 0,
    foes: [{ x: 10 + 5 * MINIMAP.markR + 0.01, z: 10 }, { x: 11, z: 10, kind: 2 }] });
  assert.equal(m.foes.length, 1);
  assert.equal(m.foes[0].kind, 2); // Zusatzfelder laufen durch
});

// --- S/G-Marker und Ziel-Pfeil ------------------------------------------------

test('Ziel im Radius: G-Buchstabe, kein Pfeil', () => {
  const m = minimapModel({ ...base, yaw: 0, start: [9, 9], goal: [11, 11] });
  assert.deepEqual(m.letters.map((l) => l.label).sort(), ['G', 'S']);
  assert.equal(m.goalArrow, null);
});

test('Ziel ausserhalb: Pfeil am Rand zeigt zum Ziel, kein G', () => {
  const m = minimapModel({ ...base, yaw: 0, goal: [10, 40] }); // weit im Sueden
  assert.equal(m.letters.length, 0);
  assert.ok(m.goalArrow);
  // Spitze zeigt nach unten (Sueden bei yaw=0) auf der Mittelachse
  const [, , tipX, tipY] = m.goalArrow[0];
  close(tipX, 0, 1e-9);
  close(tipY, -(MINIMAP.arrowR + MINIMAP.arrowSize));
  // beide Chevron-Segmente treffen sich in der Spitze
  close(m.goalArrow[1][0], tipX); close(m.goalArrow[1][1], tipY);
});

test('Pfeil dreht mit dem Blick mit', () => {
  // Blick nach Sueden: das Ziel im Sueden liegt voraus -> Pfeil oben
  const m = minimapModel({ ...base, yaw: Math.PI, goal: [10, 40] });
  const [, , tipX, tipY] = m.goalArrow[0];
  close(tipX, 0, 1e-6);
  close(tipY, MINIMAP.arrowR + MINIMAP.arrowSize, 1e-6);
});

// --- Spieler-Pfeil ------------------------------------------------------------

test('PLAYER_MARK ist ein geschlossener Zug ums Zentrum', () => {
  assert.ok(PLAYER_MARK.length >= 3);
  for (let i = 0; i < PLAYER_MARK.length; i++) {
    const [, end] = PLAYER_MARK[i];
    const [nextStart] = PLAYER_MARK[(i + 1) % PLAYER_MARK.length];
    assert.deepEqual(end, nextStart);
  }
  // Spitze zeigt nach oben (Blickrichtung)
  const ys = PLAYER_MARK.flat().map(([, y]) => y);
  assert.ok(Math.max(...ys) > 0 && Math.min(...ys) < 0);
});

// --- Integrationsnaht: echte Maze-Daten ---------------------------------------

test('echtes Maze: alle Ausgaben liegen im Einheitskreis', () => {
  const maze = narrowMaze();
  const walls = minimapWalls(maze);
  const [sx, sz] = cellCenterCells(maze, maze.start[0], maze.start[1]);
  const m = minimapModel({
    walls, px: sx, pz: sz, yaw: 1.234,
    start: [sx, sz], goal: cellCenterCells(maze, maze.goal[0], maze.goal[1]),
  });
  assert.ok(m.walls.length > 0, 'um den Start herum muessen Waende sichtbar sein');
  for (const [x1, y1, x2, y2] of m.walls) {
    assert.ok(Math.hypot(x1, y1) <= 1 + 1e-9);
    assert.ok(Math.hypot(x2, y2) <= 1 + 1e-9);
  }
});

// Wandelt ein Labyrinth in die begehbare 3D-Spielwelt um (Ego-Perspektive).
// Reine Berechnung, kein Canvas -> headless testbar.
//
// Welt-Konvention (horizontal): Grid-Zelle (gx,gy) belegt das Quadrat von
// (gx*cell, gy*cell) bis ((gx+1)*cell, (gy+1)*cell) in der xz-Ebene (gx -> Welt-x,
// gy -> Welt-z). Waende ragen von y=0 bis y=height nach oben.

import { OPEN } from './maze.js';
import { corridorOutline } from './mazeGeometry.js';

// Aufragende Wireframe-Waende aus den Korridor-Konturen. Jedes 2D-Konturensegment
// wird zu 4 Kanten: Unterkante, Oberkante und zwei senkrechte Pfosten.
export function mazeWalls(maze, opts = {}) {
  const cell = opts.cell ?? 1;
  const height = opts.height ?? 1;
  const walls = [];
  for (const [[x1, y1], [x2, y2]] of corridorOutline(maze)) {
    const ax = x1 * cell, az = y1 * cell;
    const bx = x2 * cell, bz = y2 * cell;
    const aB = [ax, 0, az], bB = [bx, 0, bz];
    const aT = [ax, height, az], bT = [bx, height, bz];
    walls.push([aB, bB], [aT, bT], [aB, aT], [bB, bT]);
  }
  return walls;
}

// Die Wand-Grundrisse (xz-Liniensegmente bei y=0) -- die Verdecker fuer die
// Hidden-Line-Bestimmung (siehe render/occlusion.js).
export function wallFootprints(maze, opts = {}) {
  const cell = opts.cell ?? 1;
  return corridorOutline(maze).map(([[x1, y1], [x2, y2]]) => [
    [x1 * cell, 0, y1 * cell],
    [x2 * cell, 0, y2 * cell],
  ]);
}

// Weltkoordinaten -> Grid-Zelle.
export function cellAt(worldX, worldZ, cell = 1) {
  return [Math.floor(worldX / cell), Math.floor(worldZ / cell)];
}

// Mittelpunkt einer Zelle in Weltkoordinaten (x,z).
export function cellCenter(gx, gy, cell = 1) {
  return [(gx + 0.5) * cell, (gy + 0.5) * cell];
}

// Ist die Weltposition begehbar (in einer offenen Zelle)?
export function isWalkable(maze, worldX, worldZ, cell = 1) {
  const [gx, gy] = cellAt(worldX, worldZ, cell);
  if (gx < 0 || gx >= maze.n || gy < 0 || gy >= maze.n) return false;
  return maze.grid[gy][gx] === OPEN;
}

// yaw, sodass die Kamera am Start in den (einzigen) offenen Nachbargang blickt.
// forward(yaw, pitch=0) = (-sin yaw, 0, -cos yaw).
export function startFacingYaw(maze) {
  const [sx, sy] = maze.start;
  const open = (x, y) => x >= 0 && x < maze.n && y >= 0 && y < maze.n && maze.grid[y][x] === OPEN;
  if (open(sx, sy - 1)) return 0;            // Blick -z
  if (open(sx + 1, sy)) return -Math.PI / 2; // Blick +x
  if (open(sx, sy + 1)) return Math.PI;      // Blick +z
  if (open(sx - 1, sy)) return Math.PI / 2;  // Blick -x
  return 0;
}

// Versucht eine Bewegung um (dx,dz); pro Achse blockiert, was in eine Wand fuehrt
// (erlaubt Gleiten an Waenden). `radius` ist der Spieler-Sicherheitsabstand.
// Liefert die neue Position [x,z].
export function tryMove(maze, x, z, dx, dz, opts = {}) {
  const cell = opts.cell ?? 1;
  const radius = opts.radius ?? 0.25;
  let nx = x;
  let nz = z;

  if (dx !== 0) {
    const edge = x + dx + Math.sign(dx) * radius;
    if (isWalkable(maze, edge, z, cell)) nx = x + dx;
  }
  if (dz !== 0) {
    const edge = z + dz + Math.sign(dz) * radius;
    if (isWalkable(maze, nx, edge, cell)) nz = z + dz;
  }
  return [nx, nz];
}

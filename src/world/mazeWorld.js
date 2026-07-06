// Wandelt ein Labyrinth in die begehbare 3D-Spielwelt um (Ego-Perspektive).
// Reine Berechnung, kein Canvas -> headless testbar.
//
// Welt-Konvention (horizontal): Grid-Koordinaten werden pro Achse durch die
// Maze-Metrik (world/metric.js) in Achsen-Einheiten gestreckt und dann mit
// `unit` (Weltgroesse EINER Einheit) skaliert: Welt-x = toUnits(gx) * unit,
// Welt-z = toUnits(gy) * unit (xz-Ebene). Bei der klassischen Blockwelt
// (uniforme Metrik) ist unit einfach die alte Zellgroesse. Waende ragen von
// y=0 bis y=height nach oben.

import { OPEN } from './maze.js';
import { corridorOutline } from './mazeGeometry.js';
import { mazeMetric } from './metric.js';

// Aufragende Wireframe-Waende aus den Korridor-Konturen. Jedes 2D-Konturensegment
// wird zu 4 Kanten: Unterkante, Oberkante und zwei senkrechte Pfosten.
export function mazeWalls(maze, opts = {}) {
  const unit = opts.unit ?? 1;
  const height = opts.height ?? 1;
  const { toUnits } = mazeMetric(maze);
  const walls = [];
  for (const [[x1, y1], [x2, y2]] of corridorOutline(maze)) {
    const ax = toUnits(x1) * unit, az = toUnits(y1) * unit;
    const bx = toUnits(x2) * unit, bz = toUnits(y2) * unit;
    const aB = [ax, 0, az], bB = [bx, 0, bz];
    const aT = [ax, height, az], bT = [bx, height, bz];
    walls.push([aB, bB], [aT, bT], [aB, aT], [bB, bT]);
  }
  return walls;
}

// Die Wand-Grundrisse (xz-Liniensegmente bei y=0) -- die Verdecker fuer die
// Hidden-Line-Bestimmung (siehe render/occlusion.js).
export function wallFootprints(maze, opts = {}) {
  const unit = opts.unit ?? 1;
  const { toUnits } = mazeMetric(maze);
  return corridorOutline(maze).map(([[x1, y1], [x2, y2]]) => [
    [toUnits(x1) * unit, 0, toUnits(y1) * unit],
    [toUnits(x2) * unit, 0, toUnits(y2) * unit],
  ]);
}

// Weltkoordinaten -> Grid-Zelle.
export function cellAt(maze, worldX, worldZ, unit = 1) {
  const { toGrid } = mazeMetric(maze);
  return [Math.floor(toGrid(worldX / unit)), Math.floor(toGrid(worldZ / unit))];
}

// Mittelpunkt einer Zelle in Weltkoordinaten (x,z).
export function cellCenter(maze, gx, gy, unit = 1) {
  const { toUnits } = mazeMetric(maze);
  return [toUnits(gx + 0.5) * unit, toUnits(gy + 0.5) * unit];
}

// Ist die Weltposition begehbar (in einer offenen Zelle)?
export function isWalkable(maze, worldX, worldZ, unit = 1) {
  const [gx, gy] = cellAt(maze, worldX, worldZ, unit);
  if (gx < 0 || gx >= maze.n || gy < 0 || gy >= maze.n) return false;
  return maze.grid[gy][gx] === OPEN;
}

// Sind ALLE Zellen offen, die das achsparallele Rechteck [x0,x1] x [z0,z1]
// ueberlappt? Eck-Checks allein reichen NICHT: bei schmalen Waenden ist eine
// Wandspur (1 Einheit) schmaler als das Spieler-Quadrat (2*radius) -- ein
// Pfosten passt dann komplett ZWISCHEN zwei Eckpunkte.
export function rectWalkable(maze, x0, x1, z0, z1, unit = 1) {
  const { toGrid } = mazeMetric(maze);
  const gx0 = Math.floor(toGrid(x0 / unit));
  const gx1 = Math.floor(toGrid(x1 / unit));
  const gy0 = Math.floor(toGrid(z0 / unit));
  const gy1 = Math.floor(toGrid(z1 / unit));
  if (gx0 < 0 || gx1 >= maze.n || gy0 < 0 || gy1 >= maze.n) return false;
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      if (maze.grid[gy][gx] !== OPEN) return false;
    }
  }
  return true;
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
// Der Spieler ist ein Quadrat der Halbbreite radius: geprueft wird das GANZE
// Quadrat an der Zielposition (rectWalkable) -- nicht nur Eckpunkte. Das haelt
// erstens den Abstand radius zu jeder Wand (sonst unterschreitet man die
// Render-Near-Plane und die Wand verdeckt nichts mehr) und verhindert zweitens
// bei schmalen Waenden das Durchrutschen an Pfosten, die schmaler als das
// Quadrat sind. Liefert die neue Position [x,z].
export function tryMove(maze, x, z, dx, dz, opts = {}) {
  const unit = opts.unit ?? 1;
  const radius = opts.radius ?? 0.25;
  let nx = x;
  let nz = z;

  if (dx !== 0) {
    const cx = x + dx;
    if (rectWalkable(maze, cx - radius, cx + radius, z - radius, z + radius, unit)) nx = cx;
  }
  if (dz !== 0) {
    const cz = z + dz;
    if (rectWalkable(maze, nx - radius, nx + radius, cz - radius, cz + radius, unit)) nz = cz;
  }
  return [nx, nz];
}

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
import { corridorOutline, mergeCollinear } from './mazeGeometry.js';
import { mazeMetric } from './metric.js';

// Die gemergten 2D-Konturzuege pro Maze cachen: die Schwenks (falling/
// rising) rufen mazeWalls mit ANIMIERTER Hoehe jeden Frame -- der teure
// Teil (O(n^2)-Zellenscan + mergeCollinear) haengt aber nur am Maze,
// nicht an der Hoehe. Das Grid ist nach generateMaze unveraenderlich
// (das Wachstum spielt maze.order separat ab), der Cache damit sicher;
// WeakMap laesst verworfene Mazes normal wegraeumen.
const mergedOutlines = new WeakMap();
function mergedOutline(maze) {
  let segs = mergedOutlines.get(maze);
  if (!segs) {
    segs = mergeCollinear(corridorOutline(maze));
    mergedOutlines.set(maze, segs);
  }
  return segs;
}

// Aufragende Wireframe-Waende aus den Korridor-Konturen. Kollineare Wandzuege
// sind zu LANGEN Unter-/Oberkanten zusammengefasst (weniger Kanten fuer den
// Occlusion-Pass, der mit Kanten x Verdecker skaliert); die senkrechten
// Pfosten stehen weiterhin an JEDEM Gitter-Vertex des Zuges -- der Zellen-
// Rhythmus an den Waenden ist Teil des Looks. Nebeneffekt: frueher wurde
// jeder Pfosten von beiden Nachbarsegmenten doppelt gezeichnet, jetzt genau
// einmal pro Zug (nur an Ecken treffen sich zwei Zuege).
export function mazeWalls(maze, opts = {}) {
  const unit = opts.unit ?? 1;
  const height = opts.height ?? 1;
  const { toUnits } = mazeMetric(maze);
  const walls = [];
  for (const [[x1, y1], [x2, y2]] of mergedOutline(maze)) {
    const ax = toUnits(x1) * unit, az = toUnits(y1) * unit;
    const bx = toUnits(x2) * unit, bz = toUnits(y2) * unit;
    walls.push([[ax, 0, az], [bx, 0, bz]], [[ax, height, az], [bx, height, bz]]);
    // Pfosten an jedem Gitter-Vertex entlang des Zuges (Endpunkte inklusive).
    if (y1 === y2) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        const wx = toUnits(x) * unit;
        walls.push([[wx, 0, az], [wx, height, az]]);
      }
    } else {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        const wz = toUnits(y) * unit;
        walls.push([[ax, 0, wz], [ax, height, wz]]);
      }
    }
  }
  return walls;
}

// Die Wand-Grundrisse (xz-Liniensegmente bei y=0) -- die Verdecker fuer die
// Hidden-Line-Bestimmung (siehe render/occlusion.js). Ebenfalls zusammen-
// gefasst: gleiche Geometrie-Union, ~3x weniger Verdecker pro occludeEdge.
export function wallFootprints(maze, opts = {}) {
  const unit = opts.unit ?? 1;
  const { toUnits } = mazeMetric(maze);
  return mergedOutline(maze).map(([[x1, y1], [x2, y2]]) => [
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

// Freie SICHTLINIE zwischen zwei Welt-Punkten (keine Wandzelle dazwischen)?
// Exakter Grid-DDA von Zellkante zu Zellkante ueber die Metrik, gleiche
// Mechanik wie skylineElevation (stars.js) -- die Sternen-FALLE gilt auch
// hier: ein abtastender Raycast ueberspringt schraeg gestreifte
// 1-Einheit-Waende. Ein exakt durch eine Zell-ECKE laufender Strahl wird
// konservativ behandelt (beide Nachbarzellen nacheinander geprueft).
// Nutzer: die Feuer-Disziplin des Autopiloten -- auf ein Ziel ohne
// Sichtlinie schiesst kein Profi, der Schuss verpufft nur an der Wand.
export function hasLineOfSight(maze, x0, z0, x1, z1, unit = 1) {
  const { toGrid, toUnits } = mazeMetric(maze);
  const dist = Math.hypot(x1 - x0, z1 - z0);
  if (dist < 1e-12) return true;
  const dx = (x1 - x0) / dist;
  const dz = (z1 - z0) / dist;
  let gx = Math.floor(toGrid(x0 / unit));
  let gz = Math.floor(toGrid(z0 / unit));
  const tgx = Math.floor(toGrid(x1 / unit));
  const tgz = Math.floor(toGrid(z1 / unit));
  const edge = (g, dir) => (dir > 0 ? g + 1 : g);
  for (let guard = 0; guard < 4 * maze.n; guard++) {
    if (gx === tgx && gz === tgz) return true;
    const tx = Math.abs(dx) > 1e-12
      ? (toUnits(edge(gx, dx)) * unit - x0) / dx : Infinity;
    const tz = Math.abs(dz) > 1e-12
      ? (toUnits(edge(gz, dz)) * unit - z0) / dz : Infinity;
    if (Math.min(tx, tz) >= dist) return true; // Ziel liegt vor der naechsten Kante
    if (tx <= tz) gx += dx > 0 ? 1 : -1;
    else gz += dz > 0 ? 1 : -1;
    if (gx < 0 || gx >= maze.n || gz < 0 || gz >= maze.n) return false;
    if (maze.grid[gz][gx] !== OPEN) return false;
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

// Achsweise Bewegung um (dx,dz) mit Buchfuehrung: pro Achse blockiert, was
// in eine Wand fuehrt (klassisches Gleiten an Waenden; erst x, dann z --
// blockiert x, kann z im selben Schritt weiterziehen). Der Spieler ist ein
// Quadrat der Halbbreite radius: geprueft wird das GANZE Quadrat an der
// Zielposition (rectWalkable) -- nicht nur Eckpunkte. Das haelt erstens den
// Abstand radius zu jeder Wand (sonst unterschreitet man die Render-Near-
// Plane und die Wand verdeckt nichts mehr) und verhindert zweitens bei
// schmalen Waenden das Durchrutschen an Pfosten, die schmaler als das
// Quadrat sind. DIE eine Laufzeit-Implementierung fuer walk.js und
// drive.js (vorher zwei driftgefaehrdete Kopien). Liefert
// { nx, nz, blockedX, blockedZ }.
export function moveAxiswise(maze, x, z, dx, dz, radius, unit) {
  let nx = x;
  let nz = z;
  let blockedX = false;
  let blockedZ = false;
  if (dx !== 0) {
    const cx = x + dx;
    if (rectWalkable(maze, cx - radius, cx + radius, z - radius, z + radius, unit)) nx = cx;
    else blockedX = true;
  }
  if (dz !== 0) {
    const cz = z + dz;
    if (rectWalkable(maze, nx - radius, nx + radius, cz - radius, cz + radius, unit)) nz = cz;
    else blockedZ = true;
  }
  return { nx, nz, blockedX, blockedZ };
}

// Bei einem Eck-Treffer (beide Achsen im selben Schritt blockiert) bestimmt
// die staerkere Komponente die Kollisions-Achse.
export function blockedAxis(move, dx, dz) {
  return move.blockedX && (!move.blockedZ || Math.abs(dx) >= Math.abs(dz)) ? 'x' : 'z';
}

// Bequemer Wrapper ohne Buchfuehrung: liefert nur die neue Position [x,z].
export function tryMove(maze, x, z, dx, dz, opts = {}) {
  const { nx, nz } = moveAxiswise(maze, x, z, dx, dz, opts.radius ?? 0.25, opts.unit ?? 1);
  return [nx, nz];
}

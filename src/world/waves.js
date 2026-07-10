// Kollisionswellen: vom Auftreffpunkt laufen auf der Wandflaeche senkrechte
// Linien seitwaerts und waagerechte Linien auf/ab weg und verblassen -- wie
// Wellenringe im Vektor-Stil. Reine Geometrie (lokale Flaechen-Koordinaten
// [lx, ly, lz] wie in mazeView), kein Canvas -> headless testbar.

import { OPEN } from './maze.js';
import { mazeMetric } from './metric.js';

function isOpenCell(maze, x, y) {
  return x >= 0 && x < maze.n && y >= 0 && y < maze.n && maze.grid[y][x] === OPEN;
}

// Baut aus einer Kollision (world/drive.js) die Wellen-Beschreibung:
//   { axis, plane, u0, y0, extent } -- alles in Weltkoordinaten.
// u0 ist der Auftreffpunkt ENTLANG der Wand (z bei axis 'x', x bei axis 'z'),
// y0 die Auftreffhoehe (Augenhoehe), extent die Ausdehnung der zusammen-
// haengenden sichtbaren Wandflaeche: Zellen, deren Wandspur zu ist UND deren
// Nachbarspur auf Spielerseite offen ist (nur dort existiert die Kontur --
// die Wellen sollen nicht um die Ecke in den freien Raum hinauslaufen).
export function collisionWave(maze, collision, { unit = 1, eye = 0 } = {}) {
  const { toUnits } = mazeMetric(maze);
  const { axis, side, plane, wallCell, point } = collision;
  const [wx, wy] = wallCell;

  const wallAt = axis === 'x'
    ? (k) => !isOpenCell(maze, wx, k) && isOpenCell(maze, wx - side, k)
    : (k) => !isOpenCell(maze, k, wy) && isOpenCell(maze, k, wy - side);

  let k0 = axis === 'x' ? wy : wx;
  let k1 = k0;
  // Nur von einer echten spieler-seitigen Wandzelle aus ausdehnen. Sicher-
  // heitsnetz: zeigt wallCell (wider Erwarten) auf eine offene Zelle, bleibt
  // die Ausdehnung auf deren Spanne begrenzt -- sonst "brueckte" die Suche
  // ueber die offene Luecke zu den Waenden links und rechts davon, und die
  // Welle liefe in die Luft.
  if (wallAt(k0)) {
    while (k0 - 1 >= 0 && wallAt(k0 - 1)) k0--;
    while (k1 + 1 < maze.n && wallAt(k1 + 1)) k1++;
  }

  const extent = [toUnits(k0) * unit, toUnits(k1 + 1) * unit];
  const along = axis === 'x' ? point[1] : point[0];
  const u0 = Math.min(Math.max(along, extent[0]), extent[1]);
  return { axis, plane, u0, y0: eye, extent };
}

// Linien einer Welle im Alter `age`: beginnt als KREUZ am Auftreffpunkt
// (eine senkrechte + eine waagerechte Linie mit Halbarmlaenge `arm`), dann
// laufen die Linien auseinander (senkrechte seitlich zu u0 +- r, waagerechte
// auf/ab zu y0 +- r) und ihre Arme wachsen mit (Halblaenge arm + r). Alles
// auf die Wandflaeche geklippt ([0,height] bzw. extent). r = speed * age.
// Liefert { segments, fade } oder null, wenn nichts (mehr) sichtbar ist.
export function waveSegments(wave, age, { height, speed, life, arm = 0 }) {
  if (age < 0 || age >= life) return null;
  const r = speed * age;
  const half = arm + r; // Halblaenge der Linienarme
  const fade = 1 - age / life;
  const { axis, plane, u0, y0, extent: [e0, e1] } = wave;
  // Punkt auf der Wandebene: u entlang der Wand, y die Hoehe.
  const at = axis === 'x' ? (u, y) => [plane, y, u] : (u, y) => [u, y, plane];

  const segments = [];
  const sides = r > 1e-12 ? [-1, 1] : [1]; // r=0: beide Seiten fielen zusammen
  for (const s of sides) {
    const u = u0 + s * r;
    if (u >= e0 && u <= e1) {
      const yA = Math.max(0, y0 - half);
      const yB = Math.min(height, y0 + half);
      if (yB - yA > 1e-9) segments.push([at(u, yA), at(u, yB)]);
    }
    const y = y0 + s * r;
    if (y >= 0 && y <= height) {
      const a = Math.max(e0, u0 - half);
      const b = Math.min(e1, u0 + half);
      if (b - a > 1e-9) segments.push([at(a, y), at(b, y)]);
    }
  }
  return segments.length > 0 ? { segments, fade } : null;
}

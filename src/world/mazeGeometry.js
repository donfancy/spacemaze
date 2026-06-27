// Leitet aus einem Labyrinth-Grid zeichenbare 2D-Geometrie (in Gitter-Koordinaten)
// ab. Reine Berechnung, kein Canvas -> headless testbar. Das Mapping in die 3D-Welt
// (auf eine Wuerfelflaeche) uebernimmt world/cubeFaces.js.

import { OPEN, WALL } from './maze.js';

// Liefert die "Randlinien der Wege": die Konturen der begehbaren Korridore.
// Jede Gitterkante zwischen einer offenen Zelle und einer nicht-offenen Nachbar-
// zelle (oder dem Aussenraum) wird zu einem Liniensegment. Innere Korridor-Kanten
// (offen|offen) und reine Wandkanten (zu|zu) erzeugen KEINE Linie.
//
// Koordinaten in Gitter-Einheiten: Zelle (gx,gy) belegt das Quadrat von (gx,gy)
// bis (gx+1,gy+1). Ein Segment ist [[x1,y1],[x2,y2]].
// Die erzeugte Linienmenge bildet stets geschlossene Konturen (jeder beruehrte
// Gittervertex hat geraden Grad).
export function corridorOutline(maze) {
  const { n, grid } = maze;
  const isOpen = (x, y) => x >= 0 && x < n && y >= 0 && y < n && grid[y][x] === OPEN;
  const segments = [];

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] !== OPEN) continue;
      if (!isOpen(x, y - 1)) segments.push([[x, y], [x + 1, y]]);         // oben
      if (!isOpen(x, y + 1)) segments.push([[x, y + 1], [x + 1, y + 1]]); // unten
      if (!isOpen(x - 1, y)) segments.push([[x, y], [x, y + 1]]);         // links
      if (!isOpen(x + 1, y)) segments.push([[x + 1, y], [x + 1, y + 1]]); // rechts
    }
  }
  return segments;
}

// Liegt ein Segment auf dem aeusseren Grid-Rand (x in {0,n} bzw. y in {0,n})?
function isOuterSegment([[x1, y1], [x2, y2]], n) {
  if (y1 === y2 && (y1 === 0 || y1 === n)) return true;
  if (x1 === x2 && (x1 === 0 || x1 === n)) return true;
  return false;
}

// Korridor-Randlinien fuer die ersten `k` geoeffneten Zellen (aus maze.order) --
// fuer die "Reinfress"-Animation. OHNE die aeusseren Randlinien (die zeigt der
// feste Grid-Rahmen, siehe cubeFaces.gridBorderOnFace).
export function growthOutline(maze, k) {
  const { n, order } = maze;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  const upto = Math.max(0, Math.min(k, order.length));
  for (let i = 0; i < upto; i++) {
    const [x, y] = order[i];
    grid[y][x] = OPEN;
  }
  return corridorOutline({ n, grid }).filter((seg) => !isOuterSegment(seg, n));
}

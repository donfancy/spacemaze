// Leitet aus einem Labyrinth-Grid zeichenbare Geometrie ab.
// Reine Berechnung, kein Canvas -> headless testbar.

import { OPEN, WALL } from './maze.js';

// Liefert die "Randlinien der Wege": die Konturen der begehbaren Korridore.
// Jede Gitterkante zwischen einer offenen Zelle und einer nicht-offenen Nachbar-
// zelle (oder dem Aussenraum) wird zu einem Liniensegment. Innere Korridor-Kanten
// (offen|offen) und reine Wandkanten (zu|zu) erzeugen KEINE Linie.
//
// Koordinaten in Gitter-Einheiten: Zelle (gx,gy) belegt das Quadrat von (gx,gy)
// bis (gx+1,gy+1); y zeigt nach unten (wie das grid[y][x]). Ein Segment ist
// [[x1,y1],[x2,y2]]. Das Mapping in die 3D-Welt macht spaeter der Renderer.
//
// Die erzeugte Linienmenge bildet stets geschlossene Konturen (jeder beruehrte
// Gittervertex hat geraden Grad) -- nuetzlich fuer saubere Darstellung und Tests.
export function corridorOutline(maze) {
  const { n, grid } = maze;
  const isOpen = (x, y) => x >= 0 && x < n && y >= 0 && y < n && grid[y][x] === OPEN;
  const segments = [];

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] !== OPEN) continue;
      // Nur Kanten zu nicht-offenen Nachbarn werden zu Randlinien.
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
// feste Grid-Rahmen, siehe gridBorderWorld).
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

// Bildet eine Grid-Koordinate (gx,gy) in [0,n] auf einen Weltpunkt in der Ebene
// y=planeY ab. Das Grid-Quadrat [0,n] x [0,n] wird auf [-s/2, s/2] x [-s/2, s/2]
// in der xz-Ebene abgebildet (s = squareSize) -- deckungsgleich mit der Wuerfel-
// Oberseite, damit der Uebergang vom Andocken nahtlos ist.
export function mapGridToWorld(gx, gy, n, squareSize, planeY) {
  return [
    (gx / n - 0.5) * squareSize,
    planeY,
    (gy / n - 0.5) * squareSize,
  ];
}

// Mappt eine Liste von 2D-Grid-Segmenten in Weltsegmente (in der Ebene y=planeY).
export function mapSegmentsToWorld(segments, n, squareSize, planeY) {
  return segments.map(([a, b]) => [
    mapGridToWorld(a[0], a[1], n, squareSize, planeY),
    mapGridToWorld(b[0], b[1], n, squareSize, planeY),
  ]);
}

// Die vier Randlinien des Grid-Quadrats als Weltsegmente.
export function gridBorderWorld(n, squareSize, planeY) {
  const corners = [[0, 0], [n, 0], [n, n], [0, n]];
  const segments = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    segments.push([
      mapGridToWorld(a[0], a[1], n, squareSize, planeY),
      mapGridToWorld(b[0], b[1], n, squareSize, planeY),
    ]);
  }
  return segments;
}

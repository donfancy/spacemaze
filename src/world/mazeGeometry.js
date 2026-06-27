// Leitet aus einem Labyrinth-Grid zeichenbare Geometrie ab.
// Reine Berechnung, kein Canvas -> headless testbar.

import { OPEN } from './maze.js';

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

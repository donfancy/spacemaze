// Erzeuger fuer Welt-Drahtgitter-Geometrie. Reine Funktionen, kein Canvas -> testbar.
// Ein "Segment" ist [aWorld, bWorld] mit a, b = [x, y, z].
// (Fruehere Prototyp-Formen cubeEdges/floorGrid/rotateSegmentsY sind
// entfernt -- Git-Historie; produktiv lebt nur der Wuerfel des Startscreens.)

// Voller Drahtwuerfel als Mesh: Ecken, Flaechen (Vertex-Indizes gegen den Uhrzeiger-
// sinn von AUSSEN gesehen -> Normale zeigt nach aussen) und Kanten mit den Indizes
// ihrer beiden angrenzenden Flaechen. Letzteres erlaubt die Hidden-Line-Bestimmung
// (siehe world/visibility.js).
export function cubeMesh(center = [0, 0, 0], size = 1) {
  const h = size / 2;
  const [cx, cy, cz] = center;
  const vertices = [
    [cx - h, cy - h, cz - h], [cx + h, cy - h, cz - h], [cx + h, cy + h, cz - h], [cx - h, cy + h, cz - h],
    [cx - h, cy - h, cz + h], [cx + h, cy - h, cz + h], [cx + h, cy + h, cz + h], [cx - h, cy + h, cz + h],
  ];
  const faces = [
    [4, 5, 6, 7], // 0 front  (+z)
    [0, 3, 2, 1], // 1 back   (-z)
    [1, 2, 6, 5], // 2 right  (+x)
    [0, 4, 7, 3], // 3 left   (-x)
    [3, 7, 6, 2], // 4 top    (+y)
    [0, 1, 5, 4], // 5 bottom (-y)
  ];
  // [vertexA, vertexB, [angrenzende Flaeche 1, angrenzende Flaeche 2]]
  const edges = [
    [0, 1, [1, 5]], [1, 2, [1, 2]], [2, 3, [1, 4]], [3, 0, [1, 3]],
    [4, 5, [0, 5]], [5, 6, [0, 2]], [6, 7, [0, 4]], [7, 4, [0, 3]],
    [0, 4, [3, 5]], [1, 5, [2, 5]], [2, 6, [2, 4]], [3, 7, [3, 4]],
  ];
  return { vertices, faces, edges };
}

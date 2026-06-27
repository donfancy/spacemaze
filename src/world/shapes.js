// Erzeuger fuer Welt-Drahtgitter-Geometrie. Reine Funktionen, kein Canvas -> testbar.
// Ein "Segment" ist [aWorld, bWorld] mit a, b = [x, y, z].

import { rotateY } from '../math/vec3.js';

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

// Die 12 Kanten eines Wuerfels als Liniensegmente [aWorld, bWorld].
export function cubeEdges(center = [0, 0, 0], size = 1) {
  const m = cubeMesh(center, size);
  return m.edges.map(([a, b]) => [m.vertices[a], m.vertices[b]]);
}

// Bodengitter in der xz-Ebene auf Hoehe y, von -extent..+extent, Schrittweite step.
export function floorGrid(y = 0, extent = 10, step = 1) {
  const segments = [];
  for (let i = -extent; i <= extent + 1e-9; i += step) {
    segments.push([[i, y, -extent], [i, y, extent]]);
    segments.push([[-extent, y, i], [extent, y, i]]);
  }
  return segments;
}

// Dreht alle Segmentpunkte um eine vertikale Achse durch `pivot`.
export function rotateSegmentsY(segments, pivot, angle) {
  const [px, py, pz] = pivot;
  const r = (p) => {
    const rot = rotateY([p[0] - px, p[1] - py, p[2] - pz], angle);
    return [rot[0] + px, rot[1] + py, rot[2] + pz];
  };
  return segments.map(([a, b]) => [r(a), r(b)]);
}

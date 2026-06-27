// Erzeuger fuer Welt-Drahtgitter-Geometrie. Reine Funktionen, kein Canvas -> testbar.
// Ein "Segment" ist [aWorld, bWorld] mit a, b = [x, y, z].

import { rotateY } from '../math/vec3.js';

// Die 12 Kanten eines achsenparallelen Wuerfels um `center` mit Kantenlaenge `size`.
export function cubeEdges(center = [0, 0, 0], size = 1) {
  const h = size / 2;
  const [cx, cy, cz] = center;
  const v = [
    [cx - h, cy - h, cz - h], [cx + h, cy - h, cz - h], [cx + h, cy + h, cz - h], [cx - h, cy + h, cz - h],
    [cx - h, cy - h, cz + h], [cx + h, cy - h, cz + h], [cx + h, cy + h, cz + h], [cx - h, cy + h, cz + h],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0], // hinten
    [4, 5], [5, 6], [6, 7], [7, 4], // vorne
    [0, 4], [1, 5], [2, 6], [3, 7], // verbindend
  ];
  return edges.map(([a, b]) => [v[a], v[b]]);
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

// Gemeinsames Rendern der begehbaren Labyrinth-Welt AUF einer Wuerfelflaeche.
// Genutzt von Playing (Ego-Begehung) und vom Reinfallen (Schwenk hinein).
//
// Die Spiellogik rechnet in der lokalen "horizontalen" Welt (x=uAxis, y=Hoehe
// entlang Normale, z=vAxis), die hier auf die Andock-Flaeche abgebildet wird.
// Damit das Labyrinth zur Wuerfelseite passt, ist eine Zelle CUBE_SIZE/n gross;
// alle Laengen skalieren mit dieser Zellgroesse.

import { basisFromForwardUp } from '../math/camera.js';
import { mazeWalls, wallFootprints } from '../world/mazeWorld.js';
import { faceLocalToWorld } from '../world/cubeFaces.js';
import { projectOccluders, occludeEdge } from '../render/occlusion.js';

export const CUBE_SIZE = 2.4;   // Kantenlaenge des Wuerfels (= Bildflaeche)
export const WALL_RATIO = 1.2;  // Wandhoehe in Zellen
export const EYE_RATIO = 0.5;   // Augenhoehe in Zellen
export const FAR_RATIO = 6;     // ab dieser Tiefe (in Zellen) werden verdeckte Kanten weggelassen
const NEAR = 0.1;
const DIM = 0.1;

export function cellSize(maze) {
  return CUBE_SIZE / maze.n;
}

function toFace(segments, face) {
  return segments.map(([a, b]) => [
    faceLocalToWorld(a[0], a[1], a[2], face, CUBE_SIZE),
    faceLocalToWorld(b[0], b[1], b[2], face, CUBE_SIZE),
  ]);
}

// Wireframe-Waende auf der Flaeche (height in Welt-Einheiten).
export function faceWalls(maze, face, height) {
  return toFace(mazeWalls(maze, { cell: cellSize(maze), height }), face);
}

// Verdecker-Grundrisse auf der Flaeche.
export function faceFootprints(maze, face) {
  return toFace(wallFootprints(maze, { cell: cellSize(maze) }), face);
}

// Rendert weltweite Wand-Segmente aus einer Pose {position, forward, up} mit
// exakter Hidden-Line-Dimmung. Mutiert camera (position + basis).
export function renderFaceWalls(renderer, walls, footprints, camera, pose, opts = {}) {
  camera.position = pose.position;
  camera.basis = basisFromForwardUp(pose.forward, pose.up);

  const vp = { width: renderer.width, height: renderer.height, fov: camera.fov, near: NEAR };
  const occ = projectOccluders(footprints, camera, vp);
  const far = opts.far ?? Infinity;

  const visible = [];
  const dimmed = [];
  for (const edge of walls) {
    for (const s of occludeEdge(edge, camera, vp, occ)) {
      if (!s.occluded) visible.push([s.a, s.b]);
      else if (s.depth < far) dimmed.push([s.a, s.b]);
    }
  }
  renderer.drawPolylines(dimmed, { intensity: opts.dim ?? DIM });
  renderer.drawPolylines(visible, { intensity: 1.0 });
}

// Gemeinsames Rendern der begehbaren Labyrinth-Welt AUF einer Wuerfelflaeche.
// Genutzt von Playing (Ego-Begehung) und vom Reinfallen (Schwenk hinein).
//
// Die Spiellogik rechnet in der lokalen "horizontalen" Welt (x=uAxis, y=Hoehe
// entlang Normale, z=vAxis), die hier auf die Andock-Flaeche abgebildet wird.
// Damit das Labyrinth zur Wuerfelseite passt, ist eine Zelle CUBE_SIZE/n gross;
// alle Laengen skalieren mit dieser Zellgroesse.

import { basisFromForwardUp } from '../math/camera.js';
import { mazeWalls, wallFootprints } from '../world/mazeWorld.js';
import { faceLocalToWorld, faceDir, faceDockPose, mapGridToFace, gridBorderOnFace } from '../world/cubeFaces.js';
import { projectOccluders, occludeEdge } from '../render/occlusion.js';

export const CUBE_SIZE = 2.4;   // Kantenlaenge des Wuerfels (= Bildflaeche)
export const WALL_RATIO = 1.2;  // Wandhoehe in Zellen
export const EYE_RATIO = 0.5;   // Augenhoehe in Zellen
export const FAR_RATIO = 6;     // ab dieser Tiefe (in Zellen) werden verdeckte Kanten weggelassen
export const NEAR_RATIO = 0.1;  // Near-Plane in Zellen -- MUSS mit der kleinen Flaechen-Zellgroesse mitskalieren,
                                // sonst werden nahe (verdeckende) Waende abgeschnitten
const DIM = 0.1;

export function cellSize(maze) {
  return CUBE_SIZE / maze.n;
}

// Ego-Pose auf der Flaeche: Position (lokale Flaecheneinheiten) + Blickwinkel yaw.
export function egoPose(face, px, pz, yaw, cell) {
  return {
    position: faceLocalToWorld(px, EYE_RATIO * cell, pz, face, CUBE_SIZE),
    forward: faceDir(-Math.sin(yaw), 0, -Math.cos(yaw), face),
    up: face.normal,
  };
}

// Kartensicht-Pose (= Andock-Pose): frontal auf die Flaeche, Welt-oben.
export function mapPose(face, fov) {
  const dock = faceDockPose(face, CUBE_SIZE, fov, 0.85);
  return {
    position: dock.position,
    forward: [-face.normal[0], -face.normal[1], -face.normal[2]],
    up: [0, 1, 0],
  };
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

function drawFaceMarker(renderer, gridCell, label, face, n, camera, intensity) {
  const world = mapGridToFace(gridCell[0] + 0.5, gridCell[1] + 0.5, n, CUBE_SIZE, face);
  const screen = renderer.worldToScreen(world, camera);
  if (!screen) return;
  renderer.drawText(label, {
    x: screen.x, y: screen.y, size: Math.max(12, renderer.height * 0.04),
    align: 'center', baseline: 'middle', intensity,
  });
}

// Karten-Overlay: Grid-Rahmen, S/G-Marker und (optional) der abgelaufene Weg.
// Erwartet eine bereits gesetzte camera.basis (nach renderFaceWalls). `trail` ist
// eine Liste von Grid-Zellen [gx,gy] oder null.
export function drawMapOverlay(renderer, maze, face, camera, trail, intensity) {
  if (intensity <= 0.01) return;
  renderer.renderScene({ segments: gridBorderOnFace(maze.n, CUBE_SIZE, face), intensity }, camera);

  if (trail && trail.length > 1) {
    const segs = [];
    for (let i = 1; i < trail.length; i++) {
      segs.push([
        mapGridToFace(trail[i - 1][0] + 0.5, trail[i - 1][1] + 0.5, maze.n, CUBE_SIZE, face),
        mapGridToFace(trail[i][0] + 0.5, trail[i][1] + 0.5, maze.n, CUBE_SIZE, face),
      ]);
    }
    renderer.renderScene({ segments: segs, intensity }, camera);
  }

  drawFaceMarker(renderer, maze.start, 'S', face, maze.n, camera, intensity);
  drawFaceMarker(renderer, maze.goal, 'G', face, maze.n, camera, intensity);
}

// Rendert weltweite Wand-Segmente aus einer Pose {position, forward, up} mit
// exakter Hidden-Line-Dimmung. Mutiert camera (position + basis).
export function renderFaceWalls(renderer, walls, footprints, camera, pose, opts = {}) {
  camera.position = pose.position;
  camera.basis = basisFromForwardUp(pose.forward, pose.up);

  const vp = { width: renderer.width, height: renderer.height, fov: camera.fov, near: opts.near ?? 0.1 };
  const occ = projectOccluders(footprints, camera, vp);
  const far = opts.far ?? Infinity;
  // Wirkungsstaerke der Hidden-Line-Verdeckung (0..1). Die azimutale Annahme gilt
  // nur, wenn die Kamera QUER zur Wandrichtung blickt. Beim Reinfallen schaut sie
  // anfangs noch auf die Flaeche (Waende in Blickrichtung) -> dort 0, sonst 1.
  const occWeight = opts.occWeight ?? 1;

  const visible = [];
  const dimmed = [];
  const faded = [];
  for (const edge of walls) {
    for (const s of occludeEdge(edge, camera, vp, occ)) {
      if (!s.occluded) visible.push([s.a, s.b]);
      else if (s.depth < far) dimmed.push([s.a, s.b]);
      else faded.push([s.a, s.b]);
    }
  }
  // occWeight 0 -> alle verdeckten Stuecke voll hell (keine Verdeckung);
  // occWeight 1 -> nahe verdeckte gedimmt, ferne weggelassen.
  const dimIntensity = 1 + ((opts.dim ?? DIM) - 1) * occWeight; // lerp(1 -> dim)
  const fadeIntensity = 1 - occWeight;                          // lerp(1 -> 0)
  if (fadeIntensity > 0.01) renderer.drawPolylines(faded, { intensity: fadeIntensity });
  renderer.drawPolylines(dimmed, { intensity: dimIntensity });
  renderer.drawPolylines(visible, { intensity: 1.0 });
}

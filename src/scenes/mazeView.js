// Gemeinsames Rendern der begehbaren Labyrinth-Welt AUF einer Wuerfelflaeche.
// Genutzt von Playing (Ego-Begehung) und vom Reinfallen (Schwenk hinein).
//
// Die Spiellogik rechnet in der lokalen "horizontalen" Welt (x=uAxis, y=Hoehe
// entlang Normale, z=vAxis), die hier auf die Andock-Flaeche abgebildet wird.
// Damit das Labyrinth zur Wuerfelseite passt, ist eine Achsen-Einheit der
// Maze-Metrik CUBE_SIZE/total(n) gross (unitSize); alle Gameplay-Laengen
// (Tempo, Radius, Wandhoehe, Near/Far) skalieren mit der GANG-Breite (cellSize).
// Bei der klassischen Blockwelt ist beides dieselbe alte Zellgroesse CUBE_SIZE/n.

import { basisFromForwardUp } from '../math/camera.js';
import { quatFromBasis, basisFromQuat, slerpQuat } from '../math/quat.js';
import { lerp } from '../math/vec3.js';
import { mazeWalls, wallFootprints } from '../world/mazeWorld.js';
import { mazeMetric } from '../world/metric.js';
import {
  faceLocalToWorld, faceDir, faceDockPose, mapGridToFace, mapUnitsToFace, gridBorderOnFace,
} from '../world/cubeFaces.js';
import { projectOccluders, occludeEdge } from '../render/occlusion.js';

export const CUBE_SIZE = 2.4;   // Kantenlaenge des Wuerfels (= Bildflaeche)
export const WALL_RATIO = 1.2;  // Wandhoehe in Zellen
export const EYE_RATIO = 0.5;   // Augenhoehe in Zellen
export const FAR_RATIO = 6;     // ab dieser Tiefe (in Zellen) werden verdeckte Kanten weggelassen
export const NEAR_RATIO = 0.1;  // Near-Plane in Zellen -- MUSS mit der kleinen Flaechen-Zellgroesse mitskalieren,
                                // sonst werden nahe (verdeckende) Waende abgeschnitten
const DIM = 0.1;

// Weltgroesse EINER Achsen-Einheit der Maze-Metrik.
export function unitSize(maze) {
  return CUBE_SIZE / mazeMetric(maze).total(maze.n);
}

// Weltgroesse eines GANGS (Kammer-Breite) -- der Massstab fuer alles Gameplay.
export function cellSize(maze) {
  return mazeMetric(maze).corridor * unitSize(maze);
}

// Ego-Pose auf der Flaeche: Position (lokale Flaecheneinheiten) + Blickwinkel yaw.
// WICHTIG: bewusst OHNE roll/pitch -- die Kamera muss horizontal bleiben, sonst
// bricht die azimutale Annahme der Hidden-Line-Verdeckung (render/occlusion.js).
// Kurvenneigung und Schwingungen laufen als Bildraum-Transform (render/sway.js).
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

// Pose-Ueberblendung fuer die Schwenks (Reinfallen/Rueckschwenk): Position
// linear, Orientierung als EINE Rotation per Quaternion-Slerp. Getrenntes
// Lerpen von forward/up wuerde umkippen, wenn beide in der Mitte antiparallel
// werden (Ego-Blick "Sued": forward=-Welt-oben) -- der Kameraueberschlag.
export function blendPose(a, b, e) {
  const qa = quatFromBasis(basisFromForwardUp(a.forward, a.up));
  const qb = quatFromBasis(basisFromForwardUp(b.forward, b.up));
  const { forward, up } = basisFromQuat(slerpQuat(qa, qb, e));
  return { position: lerp(a.position, b.position, e), forward, up };
}

// Lokale Flaechen-Segmente [lx,ly,lz] -> Welt (auch fuer Effekte, z.B. Wellen).
export function faceSegments(segments, face) {
  return segments.map(([a, b]) => [
    faceLocalToWorld(a[0], a[1], a[2], face, CUBE_SIZE),
    faceLocalToWorld(b[0], b[1], b[2], face, CUBE_SIZE),
  ]);
}

const toFace = faceSegments;

// Wireframe-Waende auf der Flaeche (height in Welt-Einheiten).
export function faceWalls(maze, face, height) {
  return toFace(mazeWalls(maze, { unit: unitSize(maze), height }), face);
}

// Verdecker-Grundrisse auf der Flaeche.
export function faceFootprints(maze, face) {
  return toFace(wallFootprints(maze, { unit: unitSize(maze) }), face);
}

function drawFaceMarker(renderer, gridCell, label, face, maze, camera, intensity) {
  const world = mapGridToFace(gridCell[0] + 0.5, gridCell[1] + 0.5, maze.n, CUBE_SIZE, face, mazeMetric(maze));
  const screen = renderer.worldToScreen(world, camera);
  if (!screen) return;
  renderer.drawText(label, {
    x: screen.x, y: screen.y, size: Math.max(12, renderer.height * 0.04),
    align: 'center', baseline: 'middle', intensity,
  });
}

// Himmelsrichtungen am Kartenrand: Grid-gy waechst nach unten -> Norden ist
// oben (kleines gy), Osten rechts (grosses gx). Punkte in Achsen-EINHEITEN
// knapp ausserhalb des Rahmens, mittig an jeder Seite (so bleibt der Abstand
// auch bei ungleichen Zellbreiten ein fester Anteil der Flaechenkante).
const COMPASS_MARGIN = 0.06; // Abstand vom Rahmen, Anteil der Flaechenkante

export function compassUnitPoints(n, metric) {
  const total = metric.total(n);
  const m = COMPASS_MARGIN * total;
  return {
    N: [total / 2, -m],
    S: [total / 2, total + m],
    W: [-m, total / 2],
    E: [total + m, total / 2],
  };
}

// Blendet N/W/E/S um den Kartenrand ein (Kartensicht bzw. Labyrinth-Aufbau).
export function drawCompassLabels(renderer, maze, face, camera, intensity) {
  if (intensity <= 0.01) return;
  const metric = mazeMetric(maze);
  const points = compassUnitPoints(maze.n, metric);
  for (const [label, [ux, uy]] of Object.entries(points)) {
    const world = mapUnitsToFace(ux, uy, metric.total(maze.n), CUBE_SIZE, face);
    const screen = renderer.worldToScreen(world, camera);
    if (!screen) continue;
    renderer.drawText(label, {
      x: screen.x, y: screen.y, size: Math.max(11, renderer.height * 0.028),
      align: 'center', baseline: 'middle', intensity: 0.7 * intensity,
    });
  }
}

const TRAIL_DIM = 0.5; // Weglinie zu 50% gedimmt (gegen Rahmen/Waende absetzen)

// Karten-Overlay: Grid-Rahmen, S/G-Marker und (optional) der abgelaufene Weg.
// Erwartet eine bereits gesetzte camera.basis (nach renderFaceWalls). `trail` ist
// eine Polyline praeziser lokaler Flaechenpunkte [x,z] (siehe world/trail.js) oder null.
// `borderIntensity` erlaubt, den Rahmen getrennt zu halten (Karten-Ausblenden:
// der Rahmen bleibt stehen, weil er zur Wuerfelkante des Startscreens wird).
export function drawMapOverlay(renderer, maze, face, camera, trail, intensity, borderIntensity = intensity) {
  if (intensity <= 0.01 && borderIntensity <= 0.01) return;
  if (borderIntensity > 0.01) {
    renderer.renderScene({ segments: gridBorderOnFace(maze.n, CUBE_SIZE, face), intensity: borderIntensity }, camera);
  }
  if (intensity <= 0.01) return;

  if (trail && trail.length > 1) {
    const segs = [];
    for (let i = 1; i < trail.length; i++) {
      segs.push([
        faceLocalToWorld(trail[i - 1][0], 0, trail[i - 1][1], face, CUBE_SIZE),
        faceLocalToWorld(trail[i][0], 0, trail[i][1], face, CUBE_SIZE),
      ]);
    }
    renderer.renderScene({ segments: segs, intensity: TRAIL_DIM * intensity }, camera);
  }

  drawFaceMarker(renderer, maze.start, 'S', face, maze, camera, intensity);
  drawFaceMarker(renderer, maze.goal, 'G', face, maze, camera, intensity);
  drawCompassLabels(renderer, maze, face, camera, intensity);
}

// Rendert weltweite Wand-Segmente aus einer Pose {position, forward, up} mit
// exakter Hidden-Line-Dimmung. Mutiert camera (position + basis). Liefert
// { occ, vp } (projizierte Verdecker + Viewport) fuer renderFaceOverlay --
// so koennen Zusatz-Segmente dieselbe Verdeckung nutzen, ohne sie neu zu rechnen.
export function renderFaceWalls(renderer, walls, footprints, camera, pose, opts = {}) {
  camera.position = pose.position;
  camera.basis = basisFromForwardUp(pose.forward, pose.up);

  // alpha skaliert alles gleichmaessig (Karten-Ausblenden beim Verlassen);
  // die Kamera-Basis ist dann bereits gesetzt (das Overlay braucht sie).
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.01) return null;

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
  if (fadeIntensity > 0.01) renderer.drawPolylines(faded, { intensity: alpha * fadeIntensity });
  renderer.drawPolylines(dimmed, { intensity: alpha * dimIntensity });
  renderer.drawPolylines(visible, { intensity: alpha });
  return { occ, vp };
}

// Zusatz-Segmente (Welt) mit derselben Hidden-Line-Verdeckung wie die Waende
// rendern (view = Rueckgabe von renderFaceWalls). Verdeckte Stuecke werden auf
// `dim` * intensity gedimmt statt weggelassen -- z.B. das Ziel-Leuchtfeuer,
// das staerker durchscheinen darf als normale Kanten. `color`/`glow` erlauben
// andersfarbige Overlays (die roten Feind-Rauten).
export function renderFaceOverlay(renderer, segments, camera, view, opts = {}) {
  if (!view) return;
  const intensity = opts.intensity ?? 1;
  const dim = opts.dim ?? DIM;
  const visible = [];
  const hidden = [];
  for (const edge of segments) {
    for (const s of occludeEdge(edge, camera, view.vp, view.occ)) {
      (s.occluded ? hidden : visible).push([s.a, s.b]);
    }
  }
  renderer.drawPolylines(hidden, { intensity: intensity * dim, color: opts.color, glow: opts.glow });
  renderer.drawPolylines(visible, { intensity, color: opts.color, glow: opts.glow });
}

// Ziel-Zone und Ziel-Leuchtfeuer. Das Ziel gilt erst als erreicht, wenn man
// wirklich IM Zielfeld steht (pro Seite um einen Anteil der Feldgroesse
// eingerueckt) -- die Kante zu beruehren reicht nicht. Die Zone wird als
// Quadrat auf dem Boden markiert, von dessen Kante flimmernde Leucht-Linien
// senkrecht in den Himmel strahlen (von weitem hinter den Waenden sichtbar).
// Reine Berechnung, kein Canvas -> headless testbar.

import { mazeMetric } from './metric.js';

// Rechteck der Ziel-Zone in Weltkoordinaten: das Zielfeld, pro Seite um
// `inset` (Welt) eingerueckt.
export function goalZone(maze, unit = 1, inset = 0) {
  const { toUnits } = mazeMetric(maze);
  const [gx, gy] = maze.goal;
  return {
    x0: toUnits(gx) * unit + inset,
    x1: toUnits(gx + 1) * unit - inset,
    z0: toUnits(gy) * unit + inset,
    z1: toUnits(gy + 1) * unit - inset,
  };
}

// Steht (px,pz) in der Ziel-Zone?
export function inGoalZone(maze, px, pz, unit = 1, inset = 0) {
  const z = goalZone(maze, unit, inset);
  return px >= z.x0 && px <= z.x1 && pz >= z.z0 && pz <= z.z1;
}

// Boden-Quadrat der Zone (y=0): 4 Kanten, geschlossener Umriss.
export function goalMarkerSegments(zone) {
  const { x0, x1, z0, z1 } = zone;
  return [
    [[x0, 0, z0], [x1, 0, z0]],
    [[x1, 0, z0], [x1, 0, z1]],
    [[x1, 0, z1], [x0, 0, z1]],
    [[x0, 0, z1], [x0, 0, z0]],
  ];
}

// Wanderposition eines Strahls auf seiner Kante (0..1): weiches Wert-Rauschen
// (smoothstep zwischen Zufalls-Stuetzstellen im Takt `rate`) -- jeder Strahl
// gleitet unabhaengig, bleibt aber an seine Kante gebunden.
export function beamWander(i, t, opts = {}) {
  const rate = opts.rate ?? 0.7; // Stuetzstellen pro Sekunde
  const s = t * rate;
  const k = Math.floor(s);
  const f = s - k;
  const smooth = f * f * (3 - 2 * f);
  const a = hash01(i + 4096, k); // eigener Index-Raum, entkoppelt vom Flimmern
  const b = hash01(i + 4096, k + 1);
  return a + (b - a) * smooth;
}

// Fusspunkte der Strahlen zur Zeit `time`: Strahl i ist fest an Kante
// floor(i / (perEdge+1)) gebunden und wandert auf ihr entlang -- insgesamt
// 4*(perEdge+1) Strahlen. Liefert [[x,z], ...].
export function goalBeamFeet(zone, opts = {}) {
  const perEdge = opts.perEdge ?? 2;
  const time = opts.time ?? 0;
  const { x0, x1, z0, z1 } = zone;
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const feet = [];
  const count = 4 * (perEdge + 1);
  for (let i = 0; i < count; i++) {
    const e = Math.floor(i / (perEdge + 1));
    const [ax, az] = corners[e];
    const [bx, bz] = corners[(e + 1) % 4];
    const u = beamWander(i, time, { rate: opts.rate });
    feet.push([ax + (bx - ax) * u, az + (bz - az) * u]);
  }
  return feet;
}

// Verdeckungs-Schnitt eines senkrechten Strahls -- dieselbe azimutale Annahme
// wie render/occlusion.js (gleich hohe Waende, horizontale Kamera auf
// Augenhoehe): eine Wand zwischen Kamera-Fusspunkt und Strahl-Fusspunkt
// verdeckt den Strahl vom Boden bis zur Hoehe eye + (wallHeight - eye)/t
// (t = Anteil der Wanddistanz an der Strahldistanz); darueber ragt er frei
// ueber die Wand. Liefert das Maximum ueber alle schneidenden Grundriss-
// Segmente (0 = ganz frei sichtbar); der Aufrufer kappt bei der Strahlhoehe.
// footprints: xz-Segmente als [x,0,z]-Paare (wallFootprints).
export function beamOcclusionCut(footprints, cam, foot, opts = {}) {
  const eye = opts.eye ?? 0;
  const wallHeight = opts.wallHeight ?? 1;
  const dx = foot[0] - cam[0];
  const dz = foot[1] - cam[1];
  let cut = 0;
  for (const [a, b] of footprints) {
    const rx = b[0] - a[0], rz = b[2] - a[2];
    const det = rx * dz - rz * dx;
    if (Math.abs(det) < 1e-12) continue; // parallel zur Sichtlinie
    const qx = a[0] - cam[0], qz = a[2] - cam[1];
    const t = (rx * qz - rz * qx) / det; // Anteil auf der Sichtlinie
    const u = (dx * qz - dz * qx) / det; // Anteil auf dem Wand-Segment
    if (t <= 1e-9 || t >= 1 - 1e-9 || u < 0 || u > 1) continue;
    cut = Math.max(cut, eye + (wallHeight - eye) / t);
  }
  return cut;
}

// Deterministisches Pseudo-Rauschen aus zwei Ganzzahlen (0..1); bewusst kein
// Math.random -- reproduzierbar und damit testbar.
function hash01(i, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(k, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Flimmern eines Strahls: springt `rate` mal pro Sekunde auf eine neue
// Zufalls-Intensitaet in [min, max] -- pro Strahl-Index eigenes Muster.
export function beamFlicker(i, t, opts = {}) {
  const rate = opts.rate ?? 24;
  const min = opts.min ?? 0.15;
  const max = opts.max ?? 1;
  return min + (max - min) * hash01(i, Math.floor(t * rate));
}

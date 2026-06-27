// Hidden-Line-Bestimmung fuer das Labyrinth via 1D-Tiefenpuffer ueber Bildschirm-x.
// Reine Berechnung (View-Space + Projektion), kein Canvas -> headless testbar.
//
// Schluessel-Annahme: alle Waende sind gleich hoch und die Kamera schaut auf
// konstanter Augenhoehe horizontal. Dann ist Verdeckung rein AZIMUTAL -- eine
// naehere Wand verdeckt im ueberlappenden Bildschirm-x-Bereich alles dahinter
// vollstaendig. Es genuegt also pro Bildspalte die kleinste Wand-Tiefe.

import { worldToView } from '../math/camera.js';
import { project, clipNear } from './projection.js';

// Baut den Tiefenpuffer aus den Verdecker-Grundrissen (xz-Liniensegmente, 3D).
// Liefert { depth: Float64Array, cols, colW }. depth[c] = naechste Wand-Tiefe in
// Spalte c (Infinity, wenn dort keine Wand).
export function buildDepthBuffer(occluders, camera, viewport, cols = 240) {
  const depth = new Float64Array(cols).fill(Infinity);
  const colW = viewport.width / cols;

  for (const [a, b] of occluders) {
    const clipped = clipNear(worldToView(camera, a), worldToView(camera, b), viewport.near);
    if (!clipped) continue;
    const pa = project(clipped[0], viewport);
    const pb = project(clipped[1], viewport);
    if (!pa || !pb) continue;

    let x1 = pa.x, x2 = pb.x;
    let d1 = -clipped[0][2], d2 = -clipped[1][2]; // Tiefen (positiv vor der Kamera)
    if (x1 > x2) { [x1, x2] = [x2, x1]; [d1, d2] = [d2, d1]; }

    const span = x2 - x1;
    const cStart = Math.max(0, Math.floor(x1 / colW));
    const cEnd = Math.min(cols - 1, Math.floor(x2 / colW));
    for (let c = cStart; c <= cEnd; c++) {
      const sx = (c + 0.5) * colW;
      const t = span > 1e-9 ? (sx - x1) / span : 0;
      // perspektivisch korrekt: 1/Tiefe ist linear im Bildschirmraum
      const d = 1 / ((1 / d1) + ((1 / d2) - (1 / d1)) * t);
      if (d < depth[c]) depth[c] = d;
    }
  }
  return { depth, cols, colW };
}

function makeSeg(pa, pb, da, db, tA, tB, occluded) {
  const a = [pa.x + (pb.x - pa.x) * tA, pa.y + (pb.y - pa.y) * tA];
  const b = [pa.x + (pb.x - pa.x) * tB, pa.y + (pb.y - pa.y) * tB];
  const tm = (tA + tB) / 2;
  const depth = 1 / ((1 / da) + ((1 / db) - (1 / da)) * tm);
  return { a, b, occluded, depth };
}

// Teilt eine 3D-Kante anhand des Tiefenpuffers in Stuecke gleicher Sichtbarkeit.
// Liefert Liste von { a:[sx,sy], b:[sx,sy], occluded:boolean, depth:number }.
export function splitEdgeByOcclusion(edge, camera, viewport, depthBuffer, opts = {}) {
  const eps = opts.eps ?? 0.08; // Toleranz, damit eine Wand sich nicht selbst verdeckt
  const clipped = clipNear(worldToView(camera, edge[0]), worldToView(camera, edge[1]), viewport.near);
  if (!clipped) return [];
  const pa = project(clipped[0], viewport);
  const pb = project(clipped[1], viewport);
  if (!pa || !pb) return [];

  const da = -clipped[0][2];
  const db = -clipped[1][2];
  const { depth, cols, colW } = depthBuffer;

  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const N = Math.max(2, Math.ceil(len / colW));

  const occludedAt = (t) => {
    const sx = pa.x + (pb.x - pa.x) * t;
    const d = 1 / ((1 / da) + ((1 / db) - (1 / da)) * t);
    const col = Math.min(cols - 1, Math.max(0, Math.floor(sx / colW)));
    return d > depth[col] + eps;
  };

  // occluded-Flag an N+1 Stuetzstellen, dann zu Laeufen gleicher Sichtbarkeit gruppieren.
  const flags = [];
  for (let i = 0; i <= N; i++) flags.push(occludedAt(i / N));

  const segs = [];
  let start = 0;
  for (let i = 1; i <= N; i++) {
    if (i === N || flags[i] !== flags[start]) {
      segs.push(makeSeg(pa, pb, da, db, start / N, i / N, flags[start]));
      start = i;
    }
  }
  return segs;
}

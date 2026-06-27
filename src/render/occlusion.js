// Hidden-Line-Bestimmung fuer das Labyrinth -- EXAKT analytisch, ohne Diskretisierung.
// Reine Berechnung (View-Space + Projektion), kein Canvas -> headless testbar.
//
// Schluessel-Annahme: alle Waende sind gleich hoch und die Kamera schaut auf
// konstanter Augenhoehe horizontal. Dann ist Verdeckung rein AZIMUTAL (ueber den
// Bildschirm-x) -- eine naehere Wand verdeckt im ueberlappenden x-Bereich alles
// dahinter vollstaendig. Es genuegt also, jede Kante gegen die Wand-Grundrisse
// zu testen und die Verdeckungsgrenzen als exakte Schnittpunkte zu bestimmen.

import { worldToView } from '../math/camera.js';
import { project, clipNear } from './projection.js';

// Projiziert die Verdecker-Grundrisse (xz-Segmente) zu Bildschirm-Spans:
//   { xL, xR, invL, invR }  mit xL <= xR und inv* = 1/Tiefe an den Enden.
// 1/Tiefe ist im Bildschirmraum exakt linear in x.
export function projectOccluders(footprints, camera, viewport) {
  const out = [];
  for (const [a, b] of footprints) {
    const clipped = clipNear(worldToView(camera, a), worldToView(camera, b), viewport.near);
    if (!clipped) continue;
    const pa = project(clipped[0], viewport);
    const pb = project(clipped[1], viewport);
    if (!pa || !pb) continue;
    let xL = pa.x, xR = pb.x;
    let invL = 1 / -clipped[0][2], invR = 1 / -clipped[1][2];
    if (xL > xR) { [xL, xR] = [xR, xL]; [invL, invR] = [invR, invL]; }
    if (xR - xL < 1e-6) continue; // genau von der Seite gesehen -> verdeckt nichts
    out.push({ xL, xR, invL, invR });
  }
  return out;
}

// 1/Tiefe eines Occluders bei Bildschirm-x.
function occInvd(o, x) {
  return o.invL + (o.invR - o.invL) * ((x - o.xL) / (o.xR - o.xL));
}

function segOf(pa, pb, invA, invB, tA, tB, occluded) {
  const a = [pa.x + (pb.x - pa.x) * tA, pa.y + (pb.y - pa.y) * tA];
  const b = [pa.x + (pb.x - pa.x) * tB, pa.y + (pb.y - pa.y) * tB];
  const invM = invA + (invB - invA) * ((tA + tB) / 2);
  return { a, b, occluded, depth: 1 / invM };
}

// Teilt eine 3D-Kante EXAKT in sichtbare und verdeckte Stuecke.
// Liefert Liste von { a:[sx,sy], b:[sx,sy], occluded:boolean, depth:number }.
export function occludeEdge(edge, camera, viewport, occluders, opts = {}) {
  // eps in 1/Tiefe-Einheiten: trennt die eigene Wand (identische Tiefe) sauber ab.
  const eps = opts.eps ?? 1e-5;
  const clipped = clipNear(worldToView(camera, edge[0]), worldToView(camera, edge[1]), viewport.near);
  if (!clipped) return [];
  const pa = project(clipped[0], viewport);
  const pb = project(clipped[1], viewport);
  if (!pa || !pb) return [];

  const invA = 1 / -clipped[0][2];
  const invB = 1 / -clipped[1][2];
  const dx = pb.x - pa.x;

  // Kante parametrisiert ueber t in [0,1] (im Bildschirmraum linear):
  //   x(t)    = pa.x + dx*t
  //   invE(t) = invA + (invB-invA)*t
  const invEAt = (t) => invA + (invB - invA) * t;

  // Vertikale Kante: ein einziger Bildschirm-x -> einheitlich klassifizieren.
  if (Math.abs(dx) < 1e-6) {
    const x = pa.x;
    const invE = (invA + invB) / 2;
    let occ = false;
    for (const o of occluders) {
      if (x < o.xL || x > o.xR) continue;
      if (occInvd(o, x) > invE + eps) { occ = true; break; }
    }
    return [segOf(pa, pb, invA, invB, 0, 1, occ)];
  }

  // Verdeckte t-Intervalle einsammeln.
  const occluded = [];
  for (const o of occluders) {
    let tLo = (o.xL - pa.x) / dx;
    let tHi = (o.xR - pa.x) / dx;
    if (tLo > tHi) { const s = tLo; tLo = tHi; tHi = s; }
    tLo = Math.max(0, tLo);
    tHi = Math.min(1, tHi);
    if (tLo >= tHi) continue;

    // D(t) = occInvd(o, x(t)) - invE(t) - eps, linear in t. Verdeckt, wo D(t) > 0.
    const dLo = occInvd(o, pa.x + dx * tLo) - invEAt(tLo) - eps;
    const dHi = occInvd(o, pa.x + dx * tHi) - invEAt(tHi) - eps;
    if (dLo <= 0 && dHi <= 0) continue;
    if (dLo > 0 && dHi > 0) { occluded.push([tLo, tHi]); continue; }
    const tc = tLo + (tHi - tLo) * (dLo / (dLo - dHi)); // exakte Nullstelle
    occluded.push(dLo > 0 ? [tLo, tc] : [tc, tHi]);
  }

  if (occluded.length === 0) return [segOf(pa, pb, invA, invB, 0, 1, false)];

  // Verdeckte Intervalle vereinigen.
  occluded.sort((p, q) => p[0] - q[0]);
  const merged = [occluded[0].slice()];
  for (let i = 1; i < occluded.length; i++) {
    const top = merged[merged.length - 1];
    if (occluded[i][0] <= top[1] + 1e-9) top[1] = Math.max(top[1], occluded[i][1]);
    else merged.push(occluded[i].slice());
  }

  // [0,1] in sichtbare/verdeckte Stuecke zerlegen.
  const segs = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor + 1e-9) segs.push(segOf(pa, pb, invA, invB, cursor, s, false));
    segs.push(segOf(pa, pb, invA, invB, Math.max(s, cursor), e, true));
    cursor = e;
  }
  if (cursor < 1 - 1e-9) segs.push(segOf(pa, pb, invA, invB, cursor, 1, false));
  return segs;
}

// Hidden-Line-Bestimmung fuer konvexe Meshes. Reine Geometrie -> headless testbar.
//
// Stil-Vorgabe (Boris): es werden KEINE Linien entfernt. Verdeckte Kanten bleiben
// sichtbar, werden aber gedimmt gezeichnet (bis hinunter auf 0 %). Diese Funktion
// teilt die Kanten nur in "sichtbar" und "verdeckt"; das Dimmen macht der Renderer.
//
// Fuer einen konvexen Koerper gilt exakt: eine Kante ist verdeckt, wenn BEIDE
// angrenzenden Flaechen von der Kamera abgewandt sind (Rueckseiten).

import { sub, cross, dot } from '../math/vec3.js';

// Flaechennormale (nach aussen, sofern die Flaeche CCW von aussen definiert ist).
export function faceNormal(vertices, face) {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  return cross(sub(b, a), sub(c, a));
}

// Ist die Flaeche von `cameraPos` aus sichtbar (Vorderseite)?
// Exakt fuer planare Flaechen: die Kamera liegt auf der Aussenseite der Flaechen-
// ebene, also dot(normal, cameraPos - flaechenpunkt) > 0.
export function isFaceVisible(vertices, face, cameraPos) {
  const n = faceNormal(vertices, face);
  const toCam = sub(cameraPos, vertices[face[0]]);
  return dot(n, toCam) > 0;
}

// Teilt die Mesh-Kanten in { visible, hidden } -- je eine Liste von Segmenten
// [aWorld, bWorld]. Eine Kante ist sichtbar, sobald mindestens eine angrenzende
// Flaeche sichtbar ist; sonst gilt sie als verdeckt.
export function classifyEdges(mesh, cameraPos) {
  const faceVisible = mesh.faces.map((f) => isFaceVisible(mesh.vertices, f, cameraPos));
  const visible = [];
  const hidden = [];
  for (const [ai, bi, adjacentFaces] of mesh.edges) {
    const seg = [mesh.vertices[ai], mesh.vertices[bi]];
    const shown = adjacentFaces.some((fi) => faceVisible[fi]);
    (shown ? visible : hidden).push(seg);
  }
  return { visible, hidden };
}

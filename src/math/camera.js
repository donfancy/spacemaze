// Kamera: 3x Position (x,y,z) + Orientierung (yaw, pitch) oder freie Basis.
// Rein rechnerisch, kein Canvas -> headless testbar.
//
// Koordinatensystem (rechtshaendig, OpenGL-Stil):
//   +x rechts, +y oben, +z zum Betrachter heraus.
//   Die Kamera schaut bei Orientierung 0 entlang -z in die Szene.
//
// yaw   = Drehung um die y-Achse (nach links/rechts schauen)
// pitch = Drehung um die x-Achse (hoch/runter schauen)
// BEWUSST KEIN roll: die Hidden-Lines-Regel 4 verlangt eine horizontale
// 3D-Kamera -- Roll (Kurvenneigung, Gyro) laeuft IMMER als Bildraum-Sway
// (render/sway.js), nie in der Kamera. Ein Roll-Feld hier waere eine
// Einladung, genau diese Regel zu verletzen (entfernt 28.8.2026).

import { sub, normalize, cross, dot, rotateX, rotateY } from './vec3.js';

export function createCamera(opts = {}) {
  return {
    position: opts.position ? [...opts.position] : [0, 0, 0],
    yaw: opts.yaw ?? 0,
    pitch: opts.pitch ?? 0,
    fov: opts.fov ?? Math.PI / 2, // 90 Grad vertikales Sichtfeld
  };
}

// Orthonormale Kamera-Basis aus Blickrichtung + grober Oben-Richtung.
// { right, up, forward } -- erlaubt eine FREIE Oben-Richtung (anders als yaw/pitch,
// die implizit Welt-oben = +y annehmen). Noetig fuer den Schwenk aus der flachen
// Kartensicht in die Ego-Begehung auf einer (vertikalen) Wuerfelflaeche.
export function basisFromForwardUp(forwardDir, upHint) {
  const f = normalize(forwardDir);
  const r = normalize(cross(f, upHint));
  const u = cross(r, f);
  return { right: r, up: u, forward: f };
}

// Transformiert einen Weltpunkt in den View-Space (Kamerakoordinaten).
// Mit camera.basis: Projektion auf die Basisachsen (Kamera blickt entlang -z_view,
// daher z = -(p . forward)). Sonst klassisch ueber yaw/pitch:
//   1) relativ zur Kameraposition verschieben,
//   2) mit der inversen Kamerarotation zurueckdrehen
//      (Inverse von yaw->pitch ist -pitch->-yaw).
export function worldToView(camera, worldPoint) {
  const p = sub(worldPoint, camera.position);
  if (camera.basis) {
    const { right, up, forward } = camera.basis;
    return [dot(p, right), dot(p, up), -dot(p, forward)];
  }
  const q = rotateY(p, -camera.yaw);
  return rotateX(q, -camera.pitch);
}

// Vorwaertsrichtung der Kamera in Weltkoordinaten (wohin sie schaut).
export function forward(camera) {
  if (camera.basis) return camera.basis.forward;
  // Startet als -z und wird mit der Kamerarotation in die Welt gedreht.
  const f = rotateX([0, 0, -1], camera.pitch);
  return rotateY(f, camera.yaw);
}

// Berechnet yaw/pitch (roll bleibt 0), damit eine Kamera an `position` genau auf
// `target` blickt -- die Umkehrung von forward(). Liefert {yaw, pitch}.
export function lookAt(position, target) {
  const d = normalize(sub(target, position));
  // forward = [-cos(pitch)*sin(yaw), sin(pitch), -cos(pitch)*cos(yaw)]
  const pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
  const yaw = Math.atan2(-d[0], -d[2]);
  return { yaw, pitch };
}

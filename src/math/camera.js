// 6-DOF-Kamera: 3x Position (x,y,z) + 3x Orientierung (yaw, pitch, roll).
// Rein rechnerisch, kein Canvas -> headless testbar.
//
// Koordinatensystem (rechtshaendig, OpenGL-Stil):
//   +x rechts, +y oben, +z zum Betrachter heraus.
//   Die Kamera schaut bei Orientierung 0 entlang -z in die Szene.
//
// yaw   = Drehung um die y-Achse (nach links/rechts schauen)
// pitch = Drehung um die x-Achse (hoch/runter schauen)
// roll  = Drehung um die z-Achse (Kippen des Horizonts)

import { sub, normalize, cross, dot, rotateX, rotateY, rotateZ } from './vec3.js';

export function createCamera(opts = {}) {
  return {
    position: opts.position ? [...opts.position] : [0, 0, 0],
    yaw: opts.yaw ?? 0,
    pitch: opts.pitch ?? 0,
    roll: opts.roll ?? 0,
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
// daher z = -(p . forward)). Sonst klassisch ueber yaw/pitch/roll:
//   1) relativ zur Kameraposition verschieben,
//   2) mit der inversen Kamerarotation zurueckdrehen
//      (Inverse von yaw->pitch->roll ist -roll->-pitch->-yaw).
export function worldToView(camera, worldPoint) {
  const p = sub(worldPoint, camera.position);
  if (camera.basis) {
    const { right, up, forward } = camera.basis;
    return [dot(p, right), dot(p, up), -dot(p, forward)];
  }
  let q = rotateY(p, -camera.yaw);
  q = rotateX(q, -camera.pitch);
  q = rotateZ(q, -camera.roll);
  return q;
}

// Vorwaertsrichtung der Kamera in Weltkoordinaten (wohin sie schaut).
export function forward(camera) {
  if (camera.basis) return camera.basis.forward;
  // Startet als -z und wird mit der Kamerarotation in die Welt gedreht.
  let f = [0, 0, -1];
  f = rotateZ(f, camera.roll);
  f = rotateX(f, camera.pitch);
  f = rotateY(f, camera.yaw);
  return f;
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

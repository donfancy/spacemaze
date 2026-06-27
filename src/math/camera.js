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

import { sub, rotateX, rotateY, rotateZ } from './vec3.js';

export function createCamera(opts = {}) {
  return {
    position: opts.position ? [...opts.position] : [0, 0, 0],
    yaw: opts.yaw ?? 0,
    pitch: opts.pitch ?? 0,
    roll: opts.roll ?? 0,
    fov: opts.fov ?? Math.PI / 2, // 90 Grad vertikales Sichtfeld
  };
}

// Transformiert einen Weltpunkt in den View-Space (Kamerakoordinaten).
// Schritte: 1) relativ zur Kameraposition verschieben,
//           2) mit der inversen Kamerarotation zurueckdrehen.
// Inverse von (yaw dann pitch dann roll) ist (-roll dann -pitch dann -yaw).
export function worldToView(camera, worldPoint) {
  let p = sub(worldPoint, camera.position);
  p = rotateY(p, -camera.yaw);
  p = rotateX(p, -camera.pitch);
  p = rotateZ(p, -camera.roll);
  return p;
}

// Vorwaertsrichtung der Kamera in Weltkoordinaten (wohin sie schaut).
export function forward(camera) {
  // Startet als -z und wird mit der Kamerarotation in die Welt gedreht.
  let f = [0, 0, -1];
  f = rotateZ(f, camera.roll);
  f = rotateX(f, camera.pitch);
  f = rotateY(f, camera.yaw);
  return f;
}

// Reine Kamera-Bahnen (Choreografie). Kein Canvas -> headless testbar.

import { lookAt } from '../math/camera.js';
import { lerp } from '../math/vec3.js';

// Punkt auf einer Kugel um `center`:
//   azimuth   dreht um die y-Achse (in der xz-Ebene)
//   elevation hebt von der xz-Ebene nach oben (+y)
export function sphericalToCartesian(center, radius, azimuth, elevation) {
  const ce = Math.cos(elevation);
  return [
    center[0] + radius * ce * Math.sin(azimuth),
    center[1] + radius * Math.sin(elevation),
    center[2] + radius * ce * Math.cos(azimuth),
  ];
}

// "Umtanzende" Kamera: kreist um `center`, Abstand und Hoehe pulsieren sanft,
// der Blick bleibt stets auf das Zentrum gerichtet.
// Liefert { position, yaw, pitch, radius, azimuth, elevation }.
export function orbitCamera(t, opts = {}) {
  const center = opts.center ?? [0, 0, 0];
  const baseRadius = opts.radius ?? 6;
  const radiusVar = opts.radiusVar ?? 1.5;
  const azimuthSpeed = opts.azimuthSpeed ?? 0.3;  // rad/s -- horizontales Kreisen
  const elevBase = opts.elevation ?? 0.4;
  const elevVar = opts.elevationVar ?? 0.3;
  const radiusFreq = opts.radiusFreq ?? 0.23;
  const elevFreq = opts.elevationFreq ?? 0.37;

  const azimuth = t * azimuthSpeed;
  const elevation = elevBase + elevVar * Math.sin(t * elevFreq);
  const radius = baseRadius + radiusVar * Math.sin(t * radiusFreq);
  const position = sphericalToCartesian(center, radius, azimuth, elevation);
  const { yaw, pitch } = lookAt(position, center);
  return { position, yaw, pitch, radius, azimuth, elevation };
}

// Zeitpunkt, zu dem die Orbit-Kamera einer Seitenflaeche (Normale in der
// xz-Ebene) frontal zugewandt ist: Azimut so, dass die Position horizontal
// entlang der Normalen liegt. Fuer das Abdocken -- der Rueckflug endet an
// dieser Stelle der Bahn, damit der Orbit dort nahtlos weiterlaeuft.
export function orbitTimeFacing(normal, opts = {}) {
  const speed = opts.azimuthSpeed ?? 0.3;
  let azimuth = Math.atan2(normal[0], normal[2]);
  if (azimuth < 0) azimuth += 2 * Math.PI;
  return azimuth / speed;
}

// --- Andocken: vom Umtanzen zur Draufsicht -------------------------------------

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Sanfte, harmonische Ein-/Ausblendkurve (Cosinus): 0 -> 0, 1 -> 1, flach an den Enden.
function easeInOut(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

// Kuerzester Winkelweg from->to, normalisiert auf (-pi, pi].
function shortestAngle(from, to) {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Draufsicht-Pose: Kamera senkrecht ueber `center`, blickt gerade nach unten,
// sodass ein Quadrat der Kantenlaenge `squareSize` (die Oberseite) den Screen
// vertikal zu `fill` ausfuellt.
export function topDownDock(center, squareSize, fov, fill = 0.85) {
  const dist = squareSize / (2 * Math.tan(fov / 2) * fill);
  return {
    position: [center[0], center[1] + squareSize / 2 + dist, center[2]],
    yaw: 0,
    pitch: -Math.PI / 2,
  };
}

// Interpoliert harmonisch von der Start-Pose zur Dock-Pose (progress in [0,1]):
// Position linear, yaw ueber den kuerzeren Winkelweg, pitch direkt.
export function dockPose(progress, start, dock) {
  const e = easeInOut(clamp01(progress));
  return {
    position: lerp(start.position, dock.position, e),
    yaw: start.yaw + shortestAngle(start.yaw, dock.yaw) * e,
    pitch: start.pitch + (dock.pitch - start.pitch) * e,
  };
}

// Reine Kamera-Bahnen (Choreografie). Kein Canvas -> headless testbar.

import { lookAt } from '../math/camera.js';

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

// Perspektivische Projektion View-Space -> Bildschirmkoordinaten + Near-Clipping.
// Rein rechnerisch, kein Canvas -> headless testbar.
//
// View-Space-Konvention (siehe camera.js): die Kamera schaut entlang -z,
// sichtbare Punkte haben also z < 0 (vor der Kamera).

// Brennweite in Pixeln aus vertikalem Sichtfeld und Bildhoehe.
export function focalLength(fov, height) {
  return (height / 2) / Math.tan(fov / 2);
}

// Projiziert einen einzelnen View-Space-Punkt auf den Bildschirm.
// Gibt {x, y} in Pixeln zurueck, oder null wenn der Punkt vor der Near-Plane
// liegt (also hinter/zu nah an der Kamera) und damit nicht darstellbar ist.
export function project(viewPoint, viewport) {
  const { width, height, fov = Math.PI / 2, near = 0.1 } = viewport;
  const [vx, vy, vz] = viewPoint;

  // Sichtbar nur, wenn weiter weg als die Near-Plane (z negativer als -near).
  if (vz > -near) return null;

  const f = focalLength(fov, height);
  const depth = -vz; // positive Tiefe vor der Kamera
  return {
    x: width / 2 + (f * vx) / depth,
    y: height / 2 - (f * vy) / depth, // +y (oben) -> kleinere Bild-y
  };
}

// Clippt ein View-Space-Liniensegment [a,b] an der Near-Plane (z = -near).
// Liefert ein neues Paar [a', b'], bei dem beide Endpunkte vor der Kamera liegen,
// oder null, wenn das gesamte Segment hinter der Near-Plane liegt.
export function clipNear(a, b, near = 0.1) {
  const za = a[2], zb = b[2];
  const planeZ = -near;
  const aVisible = za <= planeZ;
  const bVisible = zb <= planeZ;

  if (aVisible && bVisible) return [a, b];
  if (!aVisible && !bVisible) return null;

  // Genau ein Punkt sichtbar -> Schnittpunkt mit der Near-Plane berechnen.
  const t = (planeZ - za) / (zb - za);
  const intersect = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    planeZ,
  ];
  return aVisible ? [a, intersect] : [intersect, b];
}

// Quaternionen fuer Orientierungs-Interpolation. Rein rechnerisch -> headless
// testbar. Ein Quaternion ist [x, y, z, w] (Einheitslaenge = Rotation).
//
// Zweck: die Kamera-Schwenks (Reinfallen/Rueckschwenk) interpolieren die
// Orientierung als EINE Rotation auf dem kuerzesten Bogen (Slerp). Getrenntes
// Lerpen von forward und up kippt um, sobald beide in der Mitte antiparallel
// werden (Karte: forward=-Normale/up=+y, Ego Blick "Sued": forward=-y/up=Normale)
// -- das war der Kameraueberschlag.
//
// Konvention Kamera-Basis {right, up, forward}: lokale Achsen x=right, y=up,
// z=-forward (rechtshaendig, OpenGL-Stil wie in camera.js).

// Quaternion aus einer orthonormalen Kamera-Basis (Matrix->Quaternion nach
// Shepperd: den numerisch groessten der vier Kandidaten waehlen).
export function quatFromBasis({ right, up, forward }) {
  // Matrixspalten: x=right, y=up, z=-forward.
  const m00 = right[0], m10 = right[1], m20 = right[2];
  const m01 = up[0], m11 = up[1], m21 = up[2];
  const m02 = -forward[0], m12 = -forward[1], m22 = -forward[2];

  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}

// Kamera-Basis aus einem Einheits-Quaternion (rotierte lokale Achsen).
export function basisFromQuat([x, y, z, w]) {
  return {
    right: [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    up: [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    forward: [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))],
  };
}

// Sphaerische Interpolation auf dem kuerzesten Bogen (q und -q sind dieselbe
// Rotation -> bei negativem Skalarprodukt b negieren). Fuer fast identische
// Quaternionen lineare Naeherung + Normierung (sin(theta) -> 0 vermeiden).
export function slerpQuat(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bx = b;
  if (d < 0) {
    d = -d;
    bx = [-b[0], -b[1], -b[2], -b[3]];
  }

  let wa;
  let wb;
  if (d > 0.9995) {
    wa = 1 - t;
    wb = t;
  } else {
    const theta = Math.acos(Math.min(1, d));
    const s = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / s;
    wb = Math.sin(t * theta) / s;
  }

  const q = [
    a[0] * wa + bx[0] * wb,
    a[1] * wa + bx[1] * wb,
    a[2] * wa + bx[2] * wb,
    a[3] * wa + bx[3] * wb,
  ];
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

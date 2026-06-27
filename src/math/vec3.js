// Reine 3D-Vektor-Mathematik. Keine DOM-/Canvas-Abhaengigkeit -> headless testbar.
// Ein Vektor ist schlicht ein Array [x, y, z]. Funktionen sind seiteneffektfrei.

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const len = length(a);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

// Lineare Interpolation zwischen a und b (t in [0,1]).
export function lerp(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// Rotation um die jeweilige Achse, rechtshaendiges System, Winkel in Radiant.
export function rotateX(a, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [a[0], a[1] * c - a[2] * s, a[1] * s + a[2] * c];
}

export function rotateY(a, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [a[0] * c + a[2] * s, a[1], -a[0] * s + a[2] * c];
}

export function rotateZ(a, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c, a[2]];
}

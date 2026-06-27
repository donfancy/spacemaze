// Die Wuerfel-Seitenflaechen als Andock-Ziele. Reine Geometrie -> headless testbar.
//
// Beim Andocken waehlen wir die Flaeche, der die Kamera am meisten zugewandt ist
// (kleinstes, also negativstes Skalarprodukt Blickrichtung . Aussennormale). So ist
// die noetige Drehung minimal und es entsteht kein "Seitenrollen".
//
// Wir beschraenken uns auf die 4 VERTIKALEN Seitenflaechen (nicht oben/unten): dort
// ist der Blick horizontal (pitch 0, up = +y), die Pose also frei von Gimbal-Rollen.
// Jede Flaeche traegt zwei Achsen fuer das Grid-Mapping:
//   uAxis = Welt-Richtung fuer wachsendes Grid-gx (im Bild nach rechts)
//   vAxis = Welt-Richtung fuer wachsendes Grid-gy (im Bild nach unten)

export const SIDE_FACES = [
  { normal: [0, 0, 1],  yaw: 0,            uAxis: [1, 0, 0],  vAxis: [0, -1, 0] }, // front (+z)
  { normal: [0, 0, -1], yaw: Math.PI,      uAxis: [-1, 0, 0], vAxis: [0, -1, 0] }, // back  (-z)
  { normal: [1, 0, 0],  yaw: Math.PI / 2,  uAxis: [0, 0, -1], vAxis: [0, -1, 0] }, // right (+x)
  { normal: [-1, 0, 0], yaw: -Math.PI / 2, uAxis: [0, 0, 1],  vAxis: [0, -1, 0] }, // left  (-x)
];

// Waehlt die der Blickrichtung am meisten zugewandte Flaeche: min(viewDir . normal).
export function pickDockFace(viewDir, faces = SIDE_FACES) {
  let best = faces[0];
  let bestDot = Infinity;
  for (const f of faces) {
    const d = viewDir[0] * f.normal[0] + viewDir[1] * f.normal[1] + viewDir[2] * f.normal[2];
    if (d < bestDot) {
      bestDot = d;
      best = f;
    }
  }
  return best;
}

// Frontalsicht-Pose senkrecht vor einer Flaeche; das Quadrat (Kantenlaenge
// `squareSize`) fuellt den Screen vertikal zu `fill`. Liefert {position, yaw, pitch}.
export function faceDockPose(face, squareSize, fov, fill = 0.85) {
  const half = squareSize / 2;
  const dist = squareSize / (2 * Math.tan(fov / 2) * fill);
  const r = half + dist;
  return {
    position: [face.normal[0] * r, face.normal[1] * r, face.normal[2] * r],
    yaw: face.yaw,
    pitch: 0,
  };
}

// Bildet eine Grid-Koordinate (gx,gy) in [0,n] auf einen Weltpunkt der Flaeche ab.
export function mapGridToFace(gx, gy, n, squareSize, face) {
  const half = squareSize / 2;
  const u = (gx / n - 0.5) * squareSize;
  const v = (gy / n - 0.5) * squareSize;
  return [
    face.normal[0] * half + face.uAxis[0] * u + face.vAxis[0] * v,
    face.normal[1] * half + face.uAxis[1] * u + face.vAxis[1] * v,
    face.normal[2] * half + face.uAxis[2] * u + face.vAxis[2] * v,
  ];
}

// Bildet einen Punkt der lokalen "horizontalen" Spielwelt auf die Flaeche ab:
//   lx entlang uAxis, lz entlang vAxis (beide in Welt-Einheiten 0..squareSize),
//   ly als Hoehe entlang der Flaechennormalen (0 = auf der Flaeche).
// Mit ly=0 deckungsgleich mit mapGridToFace (gx*cell, gy*cell).
export function faceLocalToWorld(lx, ly, lz, face, squareSize) {
  const half = squareSize / 2;
  const u = lx - half;
  const v = lz - half;
  const h = half + ly;
  return [
    face.uAxis[0] * u + face.vAxis[0] * v + face.normal[0] * h,
    face.uAxis[1] * u + face.vAxis[1] * v + face.normal[1] * h,
    face.uAxis[2] * u + face.vAxis[2] * v + face.normal[2] * h,
  ];
}

// Wie faceLocalToWorld, aber fuer RICHTUNGEN (ohne Verschiebung) -- z.B. Blickrichtung.
export function faceDir(lx, ly, lz, face) {
  return [
    face.uAxis[0] * lx + face.vAxis[0] * lz + face.normal[0] * ly,
    face.uAxis[1] * lx + face.vAxis[1] * lz + face.normal[1] * ly,
    face.uAxis[2] * lx + face.vAxis[2] * lz + face.normal[2] * ly,
  ];
}

// Mappt eine Liste von 2D-Grid-Segmenten auf die Flaeche.
export function mapSegmentsToFace(segments, n, squareSize, face) {
  return segments.map(([a, b]) => [
    mapGridToFace(a[0], a[1], n, squareSize, face),
    mapGridToFace(b[0], b[1], n, squareSize, face),
  ]);
}

// Die vier Randlinien des Grid-Quadrats auf der Flaeche als Weltsegmente.
export function gridBorderOnFace(n, squareSize, face) {
  const corners = [[0, 0], [n, 0], [n, n], [0, n]];
  const segments = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    segments.push([
      mapGridToFace(a[0], a[1], n, squareSize, face),
      mapGridToFace(b[0], b[1], n, squareSize, face),
    ]);
  }
  return segments;
}

// Mini-Map der 2026-Ego-Ansicht (Stufe 6): ersetzt die 1980-Kompass-Rose.
// Reine Berechnung, kein Three.js -> headless testbar (wie skyTheme.js).
//
// Idee: eine runde, MITDREHENDE Karte ("heading up" wie die Kompass-Rose --
// oben ist immer die Blickrichtung). Alle Ausgaben liegen in SCHEIBEN-
// Koordinaten: Einheitskreis um den Spieler, x nach rechts, y nach OBEN auf
// dem Bildschirm, Radius 1. Der Renderer (backend.js) skaliert die Scheibe
// nur noch in eine kamera-verankerte Gruppe.
//
// Einheiten-Vertrag: minimapModel ist einheiten-agnostisch -- Spieler, Trail,
// Feinde, Ziel und `radius` muessen in DERSELBEN Einheit kommen. Der Aufrufer
// nutzt GANGBREITEN (Gameplay-Massstab): minimapWalls liefert die Wand-Kontur
// direkt darin (Grid -> Metrik-Einheiten / corridor).
//
// Blick-Konvention wie ueberall (mazeView/compass): yaw=0 blickt nach Norden
// (-z), positives yaw dreht nach links (Westen). forward=(-sin yaw, -cos yaw).

import { corridorOutline, mergeCollinear } from '../world/mazeGeometry.js';
import { mazeMetric } from '../world/metric.js';

export const MINIMAP = {
  viewCells: 5.5,   // Sichtradius in Gangbreiten (Boris: Ausschnitt, fester Zoom)
  markR: 0.92,      // Feinde/Buchstaben nur innerhalb dieses Radius (Rand bleibt frei)
  northR: 0.82,     // Abstand der N-Marke vom Zentrum
  arrowR: 0.86,     // Fusspunkt des Ziel-Richtungspfeils
  arrowSize: 0.1,   // Halbarm der Pfeilspitze
};

// Spieler-Pfeil im Zentrum (fest, zeigt nach oben = Blickrichtung):
// kleines Dreieck mit eingekerbtem Heck, als Segmente in Scheiben-Einheiten.
export const PLAYER_MARK = [
  [[0, 0.11], [-0.07, -0.09]],
  [[-0.07, -0.09], [0, -0.05]],
  [[0, -0.05], [0.07, -0.09]],
  [[0.07, -0.09], [0, 0.11]],
];

// Wand-Kontur des Labyrinths in GANGBREITEN: Grid-Kontur (zusammengefasst wie
// beim 3D-Aufbau) durch die Achsen-Metrik geschickt und auf die Gang-Breite
// normiert. Einmal pro Maze berechnen (der Aufrufer cacht).
export function minimapWalls(maze) {
  const metric = mazeMetric(maze);
  const c = metric.corridor;
  return mergeCollinear(corridorOutline(maze)).map(([[x1, y1], [x2, y2]]) => [
    [metric.toUnits(x1) / c, metric.toUnits(y1) / c],
    [metric.toUnits(x2) / c, metric.toUnits(y2) / c],
  ]);
}

// Zentrum der Grid-Zelle (gx,gy) in Gangbreiten (fuer S/G-Marker).
export function cellCenterCells(maze, gx, gy) {
  const metric = mazeMetric(maze);
  return [metric.toUnits(gx + 0.5) / metric.corridor,
    metric.toUnits(gy + 0.5) / metric.corridor];
}

// Segment [ax,ay]-[bx,by] am Einheitskreis clippen. Liefert [ax,ay,bx,by]
// (ggf. gekuerzt) oder null, wenn nichts im Kreis liegt.
function clipToDisc(ax, ay, bx, by) {
  const aIn = ax * ax + ay * ay <= 1;
  const bIn = bx * bx + by * by <= 1;
  if (aIn && bIn) return [ax, ay, bx, by];
  // |a + t(b-a)|^2 = 1 loesen, Segment auf den Innen-Anteil kuerzen.
  const dx = bx - ax, dy = by - ay;
  const A = dx * dx + dy * dy;
  if (A === 0) return null; // Punkt ausserhalb (aIn haette schon gegriffen)
  const B = 2 * (ax * dx + ay * dy);
  const C = ax * ax + ay * ay - 1;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null; // verfehlt den Kreis
  const s = Math.sqrt(disc);
  const t0 = Math.max(0, (-B - s) / (2 * A));
  const t1 = Math.min(1, (-B + s) / (2 * A));
  if (t0 >= t1) return null; // Schnitt liegt ausserhalb von [0,1]
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

// Mini-Map-Modell fuer einen Frame. Eingaben (alles in Gangbreiten):
//   walls   Wand-Segmente [[x,z],[x,z]] (minimapWalls, gecacht)
//   trail   Polyline [[x,z],...] oder null
//   foes    [{x, z, ...}] -- nur LEBENDE; Zusatzfelder (kind) laufen durch
//   start/goal  [x,z] Kammer-Zentren
//   px, pz, yaw Spielerlage und Blick
//   radius  Sichtradius (Default MINIMAP.viewCells)
// Ausgabe in Scheiben-Koordinaten (Einheitskreis, y nach oben):
//   walls/trail  geclippte Segmente [x1,y1,x2,y2]
//   foes         [{x, y, ...}] innerhalb markR
//   letters      [{label:'S'|'G', x, y}] innerhalb markR
//   goalArrow    Pfeil-Segmente am Rand (nur wenn das Ziel AUSSERHALB liegt)
//   north        {x, y} Position der N-Marke (dreht mit der Scheibe)
export function minimapModel({ walls, trail = null, foes = [], start = null,
  goal = null, px, pz, yaw, radius = MINIMAP.viewCells }) {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  // Welt-Offset -> Scheibe: x = Anteil laengs der Rechts-Richtung (cos, -sin),
  // y = Anteil laengs der Blickrichtung (-sin, -cos). Heading up: yaw=0 laesst
  // Norden (-z) oben, jede Drehung rotiert die Karte gegenlaeufig mit.
  const toDisc = (x, z) => {
    const dx = x - px, dz = z - pz;
    return [(dx * cos - dz * sin) / radius, (-dx * sin - dz * cos) / radius];
  };

  const clipSegs = (segments) => {
    const out = [];
    if (!segments) return out;
    for (const [[x1, z1], [x2, z2]] of segments) {
      // Grob-Ausschluss im Weltraum (billig), bevor transformiert wird.
      if (Math.abs(x1 - px) > radius && Math.abs(x2 - px) > radius
        && Math.sign(x1 - px) === Math.sign(x2 - px)) continue;
      if (Math.abs(z1 - pz) > radius && Math.abs(z2 - pz) > radius
        && Math.sign(z1 - pz) === Math.sign(z2 - pz)) continue;
      const [ax, ay] = toDisc(x1, z1);
      const [bx, by] = toDisc(x2, z2);
      const seg = clipToDisc(ax, ay, bx, by);
      if (seg) out.push(seg);
    }
    return out;
  };

  const model = {
    walls: clipSegs(walls),
    trail: [],
    foes: [],
    letters: [],
    goalArrow: null,
    // Nord-Richtung (0,-1) durch dieselbe Drehung: yaw=0 -> N oben.
    north: { x: sin * MINIMAP.northR, y: cos * MINIMAP.northR },
  };

  if (trail && trail.length > 1) {
    const segs = [];
    for (let i = 1; i < trail.length; i++) {
      segs.push([trail[i - 1], trail[i]]);
    }
    model.trail = clipSegs(segs);
  }

  const markR2 = MINIMAP.markR * MINIMAP.markR;
  for (const f of foes) {
    const [x, y] = toDisc(f.x, f.z);
    if (x * x + y * y <= markR2) model.foes.push({ ...f, x, y });
  }

  for (const [label, at] of [['S', start], ['G', goal]]) {
    if (!at) continue;
    const [x, y] = toDisc(at[0], at[1]);
    if (x * x + y * y <= markR2) model.letters.push({ label, x, y });
  }

  // Ziel ausserhalb: Chevron-Pfeil am Rand, zeigt die Richtung (Boris' Wunsch).
  if (goal) {
    const [gx, gy] = toDisc(goal[0], goal[1]);
    const d = Math.hypot(gx, gy);
    if (d > MINIMAP.markR) {
      const ux = gx / d, uy = gy / d;          // radial zum Ziel
      const vx = -uy, vy = ux;                 // quer dazu
      const r = MINIMAP.arrowR, s = MINIMAP.arrowSize;
      const tipX = (r + s) * ux, tipY = (r + s) * uy;
      model.goalArrow = [
        [(r * ux + vx * s), (r * uy + vy * s), tipX, tipY],
        [tipX, tipY, (r * ux - vx * s), (r * uy - vy * s)],
      ];
    }
  }

  return model;
}

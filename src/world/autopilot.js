// AUTOPILOT fuer den Animate-/Attract-Mode: faehrt den Loesungsweg des
// Labyrinths ab und erzeugt dafuer pro Frame eine TASTEN-Menge -- exakt die
// Namen, die playing.js aus game.keys liest (ArrowLeft/Right/Up, Space).
// So laeuft die Demo durch die UNVERAENDERTE Spiel-Logik (walk/drive,
// Schiessen, Feinde, Crash): kein zweiter Bewegungs-Code, nichts driftet.
// Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// Verfolgungs-Idee (pure pursuit): Ziel ist der erste Loesungsweg-Punkt
// mindestens `lookahead` Gangbreiten voraus; gelenkt wird auf den Winkel
// dorthin. In Kampf-Levels feuert der Autopilot dauerhaft (die Tempest-
// Regel deckelt) -- stirbt er trotzdem, ist das arcade-authentisch: die
// Demo endet im GAME OVER und die naechste beginnt.
//
// Blick-Verdrehung (Pulsar-Gyro, ab 26): der Autopilot will WELT-links/
// rechts -- die Pfeiltaste dafuer liefert die Inverse des gyroTurn-Mappings
// (gleiche Quelle world/gyro.js, kein zweites Vorzeichen-Wissen).

import { findPath } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { gyroTurn } from './gyro.js';

export const AUTOPILOT = {
  lookahead: 0.9,   // Gangbreiten: Vorausblick der Verfolgung
  advance: 0.55,    // Gangbreiten: naeher dran -> naechster Wegpunkt
  doneRadius: 0.2,  // Gangbreiten: erst SO nah an der Zielmitte ist Schluss
                    // (die Ziel-Zone verlangt 0.25 Feldgroesse "drinnen")
  turnDead: 0.06,   // rad: darunter wird nicht gelenkt (kein Zappeln)
  walkAlign: 0.6,   // rad: erst drehen, ab hier auch vorwaerts (Tank-Modus)
};

// Winkel auf (-PI, PI] normalisieren (yaw akkumuliert frei).
export function wrapAngle(a) {
  const w = a % (2 * Math.PI);
  return w > Math.PI ? w - 2 * Math.PI : w <= -Math.PI ? w + 2 * Math.PI : w;
}

// Die Pfeiltaste, die unter der aktuellen Blick-Verdrehung `orient` den
// gewuenschten Lenk-Sinn ergibt (turn +1 = Welt-links, -1 = Welt-rechts).
export function keyForTurn(orient, turn) {
  const names = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
  for (const dir of Object.keys(names)) {
    if (gyroTurn(orient ?? 0, { [dir]: true }) === turn) return names[dir];
  }
  return turn > 0 ? 'ArrowLeft' : 'ArrowRight';
}

// Autopilot fuer ein Labyrinth anlegen. opts = { unit, cell }.
export function createAutopilot(maze, { unit, cell }) {
  const path = (findPath(maze, maze.start, maze.goal) ?? [])
    .map(([gx, gy]) => cellCenter(maze, gx, gy, unit));
  return { path, idx: 0, cell };
}

// Ein Schritt: liefert { keys: Set<string>, done }. pose = {px,pz,yaw};
// mode = { drive, shoot, orient } (orient = gyro.orient der Szene, 0 ohne
// Verdrehung). Der Aufrufer schreibt keys nach game.keys.
export function autopilotStep(ap, pose, mode = {}) {
  const keys = new Set();
  const { path } = ap;
  if (!path.length) return { keys, done: true };

  // Wegpunkte aufruecken, Ziel = erster Punkt ausreichend weit voraus.
  const distTo = (i) => Math.hypot(path[i][0] - pose.px, path[i][1] - pose.pz);
  while (ap.idx < path.length - 1 && distTo(ap.idx) < AUTOPILOT.advance * ap.cell) ap.idx++;
  let t = ap.idx;
  while (t < path.length - 1 && distTo(t) < AUTOPILOT.lookahead * ap.cell) t++;
  // Fertig erst dicht an der ZIELMITTE (die Ziel-Zone verlangt 0.25
  // Feldgroesse "drinnen" -- advance allein stoppte knapp davor).
  const done = distTo(path.length - 1) < AUTOPILOT.doneRadius * ap.cell;

  const [tx, tz] = path[t];
  const want = Math.atan2(-(tx - pose.px), -(tz - pose.pz)); // Konvention: forward = (-sin, -cos)
  const dyaw = wrapAngle(want - pose.yaw);

  if (!done) {
    if (Math.abs(dyaw) > AUTOPILOT.turnDead) {
      keys.add(keyForTurn(mode.orient, dyaw > 0 ? 1 : -1));
    }
    if (!mode.drive && Math.abs(dyaw) < AUTOPILOT.walkAlign) {
      keys.add('ArrowUp'); // Tank-Modus: erst ausrichten, dann vorwaerts
    }
  }
  if (mode.shoot && !done) keys.add(' '); // Dauerfeuer raeumt Tanker/Spikes weg

  return { keys, done };
}

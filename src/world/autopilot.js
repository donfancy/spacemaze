// AUTOPILOT fuer den Animate-/Attract-Mode: faehrt den Loesungsweg des
// Labyrinths ab und erzeugt dafuer pro Frame eine TASTEN-Menge -- exakt die
// Namen, die playing.js aus game.keys liest (Pfeiltasten, Space).
// So laeuft die Demo durch die UNVERAENDERTE Spiel-Logik (walk/drive,
// Schiessen, Feinde, Crash): kein zweiter Bewegungs-Code, nichts driftet.
// Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// Verfolgungs-Idee (pure pursuit): Ziel ist der erste Loesungsweg-Punkt
// mindestens `lookahead` Gangbreiten voraus; gelenkt wird auf den Winkel
// dorthin. Im Fahrt-Modus lenkt der Autopilot aber nur noch echte KURVEN
// selbst (|dyaw| > driveSteer) -- auf der Geraden haelt der Ausricht-
// Assistent (logisch Pfeil runter, world/align.js) die Spur: kein
// Schlingerkurs von Wand zu Wand mehr. Wie ein Profi feuert er NUR, wenn
// wirklich ein Feind in Sicht ist (foeInSight: Distanz + Blickkegel), und
// BOOSTET (logisch Pfeil hoch) auf freien langen Geraden. Stirbt er im
// Kampf trotzdem, ist das arcade-authentisch: die Demo endet im GAME OVER
// und die naechste beginnt.
//
// Blick-Verdrehung (Pulsar-Gyro, ab 26): der Autopilot will WELT-links/
// rechts bzw. logisch Boost/Ausrichten -- die Pfeiltaste dafuer liefert
// die Inverse des gyroTurn-/gyroDirs-Mappings (gleiche Quelle
// world/gyro.js, kein zweites Vorzeichen-Wissen).

import { findPath } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { gyroTurn, gyroDirs } from './gyro.js';

export const AUTOPILOT = {
  lookahead: 0.9,   // Gangbreiten: Vorausblick der Verfolgung
  advance: 0.55,    // Gangbreiten: naeher dran -> naechster Wegpunkt
  doneRadius: 0.2,  // Gangbreiten: erst SO nah an der Zielmitte ist Schluss
                    // (die Ziel-Zone verlangt 0.25 Feldgroesse "drinnen")
  turnDead: 0.06,   // rad: darunter wird nicht gelenkt (kein Zappeln)
  walkAlign: 0.6,   // rad: erst drehen, ab hier auch vorwaerts (Tank-Modus)
  driveSteer: 0.35, // rad: ab hier lenkt der Autopilot im Fahrt-Modus selbst
                    // (Kurven) -- darunter uebernimmt der Ausricht-Assistent
  fireDist: 7,      // Gangbreiten: nur so nahe Feinde gelten als "in Sicht"
  fireCone: 0.5,    // rad: halber Oeffnungswinkel des Sicht-Kegels um die
                    // Blickrichtung (deckt den eigenen Gang ab)
  boostRun: 3.0,    // Gangbreiten: mindestens so viel freie Gerade bis zur
                    // naechsten Kurve -> Boost (Brems-Rampe schafft den Abbau
                    // von boost*cruise auf cruise in ~0.85 Gangbreiten)
  boostAlign: 0.12, // rad: geboostet wird nur, wenn der Kurs schon stimmt
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

// Die Pfeiltaste, die unter der Blick-Verdrehung `orient` die logische
// ROLLE ergibt ('up' = Boost, 'down' = Ausrichten im Fahrt-Modus) --
// Inverse von gyroDirs, analog zu keyForTurn.
export function keyForRole(orient, role) {
  const names = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
  for (const dir of Object.keys(names)) {
    if (gyroDirs(orient ?? 0, { [dir]: true })[role]) return names[dir];
  }
  return names[role];
}

// Ist ein Feind "in Sicht"? Nah genug UND ungefaehr in Blickrichtung --
// der Kegel deckt den eigenen Gang ab (ein Feind im Nachbargang faellt
// selten hinein; ein Fehlschuss in die Wand ist arcade-ok).
// foes = [[x,z], ...] (Welt-Koordinaten), null/leer = nichts in Sicht.
export function foeInSight(pose, foes, cell) {
  if (!foes) return false;
  for (const [fx, fz] of foes) {
    const dx = fx - pose.px;
    const dz = fz - pose.pz;
    if (Math.hypot(dx, dz) > AUTOPILOT.fireDist * cell) continue;
    if (Math.abs(wrapAngle(Math.atan2(-dx, -dz) - pose.yaw)) < AUTOPILOT.fireCone) return true;
  }
  return false;
}

// Freie Gerade voraus (Welt-Einheiten): Weglaenge von der Spielerlage bis
// zur naechsten RICHTUNGSAENDERUNG des Loesungswegs (das Weg-Ende zaehlt
// wie eine Kurve -- so endet der Boost rechtzeitig vor dem Ziel).
function straightRunAhead(ap, pose) {
  const { path } = ap;
  const last = path.length - 1;
  if (ap.idx >= last) {
    return Math.hypot(path[last][0] - pose.px, path[last][1] - pose.pz);
  }
  const dir = (j) => {
    const dx = path[j + 1][0] - path[j][0];
    const dz = path[j + 1][1] - path[j][1];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  const [dx0, dz0] = dir(ap.idx);
  const ax = path[ap.idx][0] - pose.px;
  const az = path[ap.idx][1] - pose.pz;
  const approach = Math.hypot(ax, az);
  // Anlauf zum naechsten Wegpunkt zaehlt nur mit, wenn er in Lauf-Richtung
  // liegt -- quer dazu (mitten in einer Kurve) endet die Gerade dort.
  if (approach > 1e-9 && (ax * dx0 + az * dz0) / approach < 0.99) return approach;
  let dist = approach;
  for (let j = ap.idx; j < last; j++) {
    const [dx, dz] = dir(j);
    if (dx * dx0 + dz * dz0 < 0.99) break; // Kurve
    dist += Math.hypot(path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1]);
  }
  return dist;
}

// Autopilot fuer ein Labyrinth anlegen. opts = { unit, cell }.
export function createAutopilot(maze, { unit, cell }) {
  const path = (findPath(maze, maze.start, maze.goal) ?? [])
    .map(([gx, gy]) => cellCenter(maze, gx, gy, unit));
  return { path, idx: 0, cell };
}

// Ein Schritt: liefert { keys: Set<string>, done }. pose = {px,pz,yaw};
// mode = { drive, shoot, orient, foes } (orient = gyro.orient der Szene,
// 0 ohne Verdrehung; foes = Ziel-Positionen [[x,z],...] fuer foeInSight --
// ohne foes wird nie gefeuert). Der Aufrufer schreibt keys nach game.keys.
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

  const foe = !done && !!mode.shoot && foeInSight(pose, mode.foes, ap.cell);

  if (!done) {
    if (mode.drive) {
      // Fahrt-Modus: nur echte Kurven selbst lenken -- auf der Geraden
      // haelt der Ausricht-Assistent (logisch runter) weich die Gangmitte,
      // statt bang-bang von Wand zu Wand zu schlingern.
      if (Math.abs(dyaw) > AUTOPILOT.driveSteer) {
        keys.add(keyForTurn(mode.orient, dyaw > 0 ? 1 : -1));
      } else {
        keys.add(keyForRole(mode.orient, 'down'));
        // BOOST wie ein Profi: Kurs stimmt, freie lange Gerade, kein Feind
        // in Sicht (vor Feinden faellt er rechtzeitig auf cruise zurueck).
        if (!foe && Math.abs(dyaw) < AUTOPILOT.boostAlign
          && straightRunAhead(ap, pose) > AUTOPILOT.boostRun * ap.cell) {
          keys.add(keyForRole(mode.orient, 'up'));
        }
      }
    } else {
      if (Math.abs(dyaw) > AUTOPILOT.turnDead) {
        keys.add(keyForTurn(mode.orient, dyaw > 0 ? 1 : -1));
      }
      if (Math.abs(dyaw) < AUTOPILOT.walkAlign) {
        keys.add('ArrowUp'); // Tank-Modus: erst ausrichten, dann vorwaerts
      }
    }
  }
  if (foe) keys.add(' '); // gezieltes Feuer statt Dauerfeuer

  return { keys, done };
}

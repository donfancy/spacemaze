// Pulsare (ab Level 26): gelbe ZACKENLINIEN im GANG-QUERSCHNITT (Boris'
// Skizze: flache Enden, dazwischen eine Zackenstrecke, die sich pulsierend
// zusammenzieht und wieder ausdehnt). Wie die Flipper spannen sie sich
// zwischen zwei Gangkanten (unten/rechts/oben/links) und klappen um
// 90 Grad -- anders als die Flipper rasten sie in JEDER Stellung laenger
// ein, auch oben und unten. Feste Position: ein Pulsar bewacht die Mitte
// seines Gangstuecks. Reine Daten + Berechnung, kein Canvas -> testbar.
//
// Spielregeln (Boris' Spec, 15.7.2026):
// - UNZERSTOERBAR: Schuesse im eigenen Gang lassen den Pulsar RECHTZEITIG
//   aus der Seiten-Stellung nach unten oder oben in den Gang klappen
//   (Schuesse fliegen auf Augenhoehe mittig -- unten/oben sind sie sicher).
//   Es gibt keinerlei Treffer-Funktion; eigene Schuesse fliegen durch.
// - NICHT toedlich: beruehrt der Spieler die Pulsar-Ebene, ROTIERT die
//   Blickachse (world/gyro.js) und das Spiel laeuft in der verdrehten
//   Welt weiter. Nach der Beruehrung ist der Pulsar entschaerft, bis der
//   Spieler wieder Abstand gewonnen hat (rearmDist) -- sonst wuerde die
//   Durchfahrt waehrend der Rotation sofort erneut ausloesen.
// - Vorbei kommt man GENAU DANN, wenn der Pulsar seitlich EINGERASTET ist
//   und man selbst zur GEGENSEITE rueberzieht (passMargin) -- oben/unten
//   sperrt die Zackenlinie die ganze Gangbreite.
// - STURM-Branch (Boris, 3.9.2026): die Beruehrung dreht IMMER 360 Grad
//   (gyro.js), und die WAND WIRD DURCHLAESSIG: ist die Zackenstrecke
//   ZUSAMMENGEZOGEN (Takt closedTime zu / openTime offen), werden
//   Wandstuecke flirrend unsichtbar und begehbar (pulsarOpenings ->
//   maze.openings, s. maze.js) -- seitlich eingerastet bis 5 Stuecke auf
//   DIESER Seite, oben/unten 3 je Seite, im Klappen 1 auf der beruehrten
//   Seite; zentriert am Pulsar, nie Aussenwaende, nie Einmuendungen. Beim
//   Wiedererscheinen drueckt die Wand den Spieler zurueck oder ganz in
//   den Nachbargang (mazeWorld.resolveWallOverlap). Das eroeffnet
//   Gang-WECHSEL mitten im Labyrinth.

import { randInt } from '../util/rng.js';
import { isOpenCell } from './maze.js';
import {
  corridorCandidates, foeMarkers, QUARTER, orientIndex, sideOf, nextRnd,
} from './foePlacement.js';

export const PULSAR = {
  minChambers: 3,   // so viele Kammern braucht ein Gangstueck fuer einen Pulsar
  exclude: 3,       // so viele Weg-Kammern um S und G bleiben pulsarfrei
  teeth: 6,         // Zacken-Paare der Zackenstrecke
  amp: 0.15,        // Zacken-Amplitude beidseits der Linie (Gangbreiten)
  lift: 0.18,       // Abstand der Linie von ihrer Wand (Gangbreiten) -- mit
                    // amp zusammen bleibt die Zackenspitze knapp vor der Wand
  closedTime: 2.5,  // s: ausgedehnt, die Waende stehen (Boris' Start-Takt)
  openTime: 0.8,    // s: zusammengezogen, die Wandstuecke sind weg
  ramp: 0.25,       // s: Zusammenziehen vor dem Oeffnen / Ausdehnen nach dem Schliessen
  sideHoles: 2,     // Wandstuecke je Seite der Mitte bei Seiten-Stellung (2+1+2 = 5)
  upHoles: 1,       // ... bei oben/unten (1+1+1 = 3 je Seite)
  spreadMax: 0.42,  // halbe Laenge der Zackenstrecke, ausgedehnt (Gangbreiten)
  spreadMin: 0.18,  // ... und zusammengezogen
  holdMin: 1.4,     // s Verweildauer pro Stellung (auch oben/unten!) ...
  holdMax: 2.8,     // ... pro Einrasten neu gewuerfelt
  flipTime: 0.25,   // s fuer eine 90-Grad-Drehung
  dodgeRange: 3.0,  // Gangbreiten: naehert sich ein Schuss auf diese Distanz,
                    // klappt die Seiten-Stellung weg (SHOTS.speed 8 braucht
                    // dafuer 0.375 s -- mehr als flipTime, immer rechtzeitig)
  passMargin: 0.08, // so weit (Gangbreiten) muss der Spieler aus der Gangmitte
                    // zur GEGENSEITE ziehen, um seitlich vorbeizukommen
  rearmDist: 0.6,   // Gangbreiten Abstand, bis der Pulsar wieder scharf ist
};

// Eingerastete Seiten-Stellung: +1 (rechts) / -1 (links) / 0 (unten, oben
// oder mitten im Flip) -- nur seitlich gibt es das Vorbei-Schlupfloch.
// (Winkel-Raster und LCG-Zufall: foePlacement.js, geteilt mit den Flippern.)
export const pulsarSide = sideOf;

// Welt-Position (x,z) der Linien-Mitte (Gangmitte quer, `along` laengs).
export function pulsarPos(p) {
  return p.axis === 'x' ? [p.along, p.cross] : [p.cross, p.along];
}

function holdRoll(p) {
  return PULSAR.holdMin + (PULSAR.holdMax - PULSAR.holdMin) * nextRnd(p);
}

function beginFlip(p, rotDir) {
  p.mode = 'flip';
  p.rotDir = rotDir;
  p.from = p.angle;
  p.delta = rotDir * QUARTER;
  p.flipT = 0;
}

// Baustein: ein fertiger Pulsar an fester Position. Startwinkel zufaellig
// aus allen vier Stellungen (er verweilt ueberall lange). `run` = Grid-Lage
// des Gangstuecks fuer die Wandphantome: fix (Gang-Reihe/-Spalte), lo/hi
// (Spanne laengs), mid (Zelle des Pulsars laengs).
function makePulsar(axis, cross, along, run, rnd) {
  const p = {
    axis, cross, along,
    fix: run.fix, lo: run.lo, hi: run.hi, mid: Math.round((run.lo + run.hi) / 2),
    angle: 0, mode: 'hold', hold: 0, from: 0, delta: 0, flipT: 0, rotDir: 1,
    armed: true,   // nach einer Beruehrung entschaerft, bis der Spieler Abstand hat
    alive: true,   // Pulsare sterben nie -- das Flag hält die Marker-Pipeline einheitlich
    phase: 0,      // Pulsier-Phase (individuell, kein Gleichtakt)
    rnd: rnd >>> 0,
  };
  p.angle = Math.floor(nextRnd(p) * 4) * QUARTER;
  p.hold = holdRoll(p);
  p.phase = nextRnd(p) * 2 * Math.PI;
  p.rotDir = nextRnd(p) < 0.5 ? -1 : 1;
  return p;
}

// Erzeugt die Pulsare eines Levels. config = { count } (Level-Daten),
// opts = { unit, cell, rng, avoid } -- `avoid` sind Spinner UND Flipper des
// Levels: deren Gangstuecke bleiben pulsarfrei (drei Feindarten in einem
// Gang waeren unlesbar). Platzierung via corridorCandidates
// (foePlacement.js, wie Spinner/Flipper); der Pulsar sitzt fest in der
// Gang-MITTE. Deterministisch bei gleichem rng.
export function createPulsars(maze, config, opts) {
  const { unit, cell, rng, avoid = [] } = opts;
  const count = config.count ?? 0;
  const candidates = corridorCandidates(maze, {
    minChambers: PULSAR.minChambers, exclude: PULSAR.exclude, unit, cell, avoid,
  });
  return candidates.slice(0, count).map((run) => makePulsar(
    run.axis, run.cross, (run.min + run.max) / 2, run, randInt(rng, 4294967296)));
}

// --- Takt: zu / offen ---------------------------------------------------------

// Zyklus-Uhr eines Pulsars (0 .. closedTime+openTime), individuell versetzt
// (phase) -- kein Gleichtakt im Labyrinth.
function cycleClock(p, time) {
  const T = PULSAR.closedTime + PULSAR.openTime;
  const off = (p.phase / (2 * Math.PI)) * T;
  return (((time + off) % T) + T) % T;
}

// Ist die Zackenstrecke gerade ZUSAMMENGEZOGEN (= die Wandstuecke sind weg)?
export function pulsarOpen(p, time) {
  return cycleClock(p, time) >= PULSAR.closedTime;
}

// Wandphantome aller Pulsare zur Zeit `time`: die Wandzellen [{gx, gy,
// side, pulsar}], die gerade unsichtbar/begehbar sind. Seitlich eingerastet
// bis 5 Stuecke (mid +-2) auf DIESER Seite, oben/unten 3 je Seite (mid +-1),
// im Klappen 1 (mid) auf der beruehrten Seite (die Seiten-Stellung, von der
// weg bzw. auf die zu geklappt wird). Nur innerhalb der Gang-Spanne, nie
// Aussenwaende, nie Einmuendungen (offene Zellen) -- "gerader Gang, sonst
// weniger". Reine Funktion der Pulsar-Daten + Zeit (auch fuers Replay).
export function pulsarOpenings(pulsars, maze, time) {
  const out = [];
  for (const p of pulsars) {
    if (!pulsarOpen(p, time)) continue;
    let sides;
    let reach;
    if (p.mode === 'hold') {
      const k = orientIndex(p.angle);
      if (k % 2 === 1) { sides = [k === 1 ? 1 : -1]; reach = PULSAR.sideHoles; }
      else { sides = [-1, 1]; reach = PULSAR.upHoles; }
    } else {
      const from = orientIndex(p.from);
      const to = orientIndex(p.from + p.delta);
      const k = from % 2 === 1 ? from : to;
      sides = [k === 1 ? 1 : -1];
      reach = 0;
    }
    for (const side of sides) {
      const row = p.fix + side;
      if (row <= 0 || row >= maze.n - 1) continue; // Aussenwand: nie
      for (let i = p.mid - reach; i <= p.mid + reach; i++) {
        if (i < p.lo || i > p.hi) continue;
        const [gx, gy] = p.axis === 'x' ? [i, row] : [row, i];
        if (isOpenCell(maze, gx, gy)) continue; // Einmuendung: da ist nichts zu oeffnen
        out.push({ gx, gy, side, pulsar: p });
      }
    }
  }
  return out;
}

// Bedroht ein eigener Schuss diesen Pulsar? Ja, wenn er im selben Gang
// fliegt (quer innerhalb der Gangbreite), auf die Pulsar-Ebene ZU, und
// naeher als dodgeRange ist. shots = [{x, z, dx, dz}] (world/shots.js).
function shotThreat(p, shots, cell) {
  for (const sh of shots) {
    const along = p.axis === 'x' ? sh.x : sh.z;
    const crossS = p.axis === 'x' ? sh.z : sh.x;
    if (Math.abs(crossS - p.cross) >= 0.5 * cell) continue;
    const gap = p.along - along;
    if (Math.abs(gap) >= PULSAR.dodgeRange * cell) continue;
    const va = p.axis === 'x' ? sh.dx : sh.dz;
    if (gap * va > 0) return true; // er fliegt auf die Ebene zu
  }
  return false;
}

// Ein Simulationsschritt: verweilen und klappen -- und AUSWEICHEN: bedroht
// ein Schuss eine Seiten-Stellung, klappt der Pulsar sofort nach unten oder
// oben in den Gang; endet ein Flip unter Beschuss seitlich, klappt er in
// derselben Richtung direkt weiter durch. `shots` (optional) sind die
// eigenen Projektile des Spielers (shotsState.shots).
export function pulsarsStep(pulsars, dt, cell, shots = null) {
  for (const p of pulsars) {
    const threat = shots && shots.length ? shotThreat(p, shots, cell) : false;
    if (p.mode === 'hold') {
      p.hold -= dt;
      if (threat && orientIndex(p.angle) % 2 === 1) {
        beginFlip(p, nextRnd(p) < 0.5 ? -1 : 1); // rechtzeitig weg (Boden ODER Decke)
      } else if (p.hold <= 0) {
        beginFlip(p, nextRnd(p) < 0.5 ? -1 : 1);
      }
    } else {
      p.flipT += dt;
      if (p.flipT >= PULSAR.flipTime) {
        p.angle = orientIndex(p.from + p.delta) * QUARTER;
        if (threat && orientIndex(p.angle) % 2 === 1) {
          beginFlip(p, p.rotDir); // unter Beschuss seitlich gelandet: weiterklappen
        } else {
          p.mode = 'hold';
          p.hold = holdRoll(p);
        }
      } else {
        p.angle = p.from + p.delta * (p.flipT / PULSAR.flipTime);
      }
    }
  }
}

// Spieler-Beruehrung der Pulsar-Ebene: Beruehren (Abstand laengs < radius)
// oder Kreuzen (Vorzeichenwechsel; nur der Spieler bewegt sich, der Pulsar
// steht fest). Quer zaehlt nur der eigene Gang. SCHLUPFLOCH: ist der Pulsar
// seitlich eingerastet und der Spieler mindestens passMargin zur GEGENSEITE
// gezogen, passiert nichts. Eine Beruehrung entschaerft den Pulsar (armed),
// bis der Spieler wieder rearmDist Abstand hat -- so loest die Durchfahrt
// waehrend der Blick-Rotation nicht sofort erneut aus. Liefert
// { x, z, pulsar } oder null.
export function pulsarPlayerTouch(pulsars, px, pz, radius, cell, prev) {
  const ppx = prev?.px ?? px;
  const ppz = prev?.pz ?? pz;
  let touch = null;
  for (const p of pulsars) {
    const along = p.axis === 'x' ? px : pz;
    const crossP = p.axis === 'x' ? pz : px;
    const g = along - p.along;
    if (!p.armed) {
      // Echten Abstand messen (nicht nur laengs) -- wer ueber einen
      // Quergang mit aehnlichem `along` zurueckkehrt, hatte real Abstand.
      const [qx, qz] = pulsarPos(p);
      if (Math.hypot(px - qx, pz - qz) > PULSAR.rearmDist * cell) p.armed = true;
      continue;
    }
    if (Math.abs(crossP - p.cross) >= 0.5 * cell) continue;
    const gPrev = (p.axis === 'x' ? ppx : ppz) - p.along;
    if (Math.abs(g) >= radius && (gPrev > 0) === (g > 0)) continue;
    const side = pulsarSide(p);
    if (side !== 0 && side * (crossP - p.cross) <= -PULSAR.passMargin * cell) continue;
    p.armed = false;
    const [x, z] = pulsarPos(p);
    if (!touch) touch = { x, z, pulsar: p };
  }
  return touch;
}

// Marker-Positionen fuer die Kartensicht (Pulsare sterben nie, aber die
// Form haelt die Marker-Pipeline einheitlich mit den anderen Feinden).
export function pulsarMarkers(pulsars) {
  return foeMarkers(pulsars, pulsarPos); // alive ist bei Pulsaren immer true
}

// Aktuelle halbe Laenge der Zackenstrecke (Gangbreiten-Anteil) -- das
// PULSIEREN im Takt: ausgedehnt, solange die Waende stehen; kurz vor dem
// Oeffnen zieht sie sich zusammen (ramp), bleibt zusammengezogen, solange
// die Wandstuecke weg sind, und dehnt sich nach dem Schliessen wieder aus.
export function pulsarSpread(p, time) {
  const u = cycleClock(p, time);
  const { spreadMin: lo, spreadMax: hi, closedTime, ramp } = PULSAR;
  const f = u < ramp ? u / ramp
    : u < closedTime - ramp ? 1
      : u < closedTime ? (closedTime - u) / ramp
        : 0;
  return lo + (hi - lo) * f;
}

// Geometrie eines Pulsars als Liniensegmente (lokale Flaechen-Welt): die
// Zackenlinie im GANG-QUERSCHNITT -- flache Enden bis an die Gangkanten,
// dazwischen die pulsierende Zackenstrecke (Boris' Skizze). Der Winkel
// dreht die Figur um die Gang-Laengsachse: die Linie liegt (0.5 - lift)
// Gangbreiten von der Gangmitte Richtung Boden/Wand/Decke, ihre lange
// Achse senkrecht dazu ("zwischen zwei Gangkanten"). opts = { cell }.
export function pulsarSegments(p, time, opts) {
  const { cell } = opts;
  const s = pulsarSpread(p, time) * cell;
  const A = PULSAR.amp * cell;
  const d = (0.5 - PULSAR.lift) * cell;
  const cu = Math.cos(p.angle);
  const su = Math.sin(p.angle);
  // Querschnitt: u = quer zur Gangmitte, v = Hoehe ueber dem Boden.
  const C = [d * su, 0.5 * cell - d * cu]; // Linien-Mitte
  const E1 = [cu, su];                     // lange Achse (parallel zur Wand)
  const E2 = [-su, cu];                    // Zacken-Richtung (zur Gangmitte)
  const pt = (a, b) => {
    const u = C[0] + a * E1[0] + b * E2[0];
    const v = C[1] + a * E1[1] + b * E2[1];
    return p.axis === 'x' ? [p.along, v, p.cross + u] : [p.cross + u, v, p.along];
  };
  // Stuetzpunkte: Gangkante, flach bis -s, Zacken (abwechselnd +-amp,
  // Endpunkte auf der Achse), flach bis zur anderen Gangkante.
  const ring = [pt(-0.5 * cell, 0), pt(-s, 0)];
  const N = 2 * PULSAR.teeth;
  for (let i = 1; i < N; i++) {
    ring.push(pt(-s + (i / N) * 2 * s, i % 2 === 1 ? A : -A));
  }
  ring.push(pt(s, 0), pt(0.5 * cell, 0));
  const segs = [];
  for (let i = 1; i < ring.length; i++) {
    segs.push([ring[i - 1], ring[i]]);
  }
  return segs;
}

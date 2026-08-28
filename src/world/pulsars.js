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

import { isChamber, findPath } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { randInt } from '../util/rng.js';
import { straightRuns } from './spinners.js';

export const PULSAR = {
  minChambers: 3,   // so viele Kammern braucht ein Gangstueck fuer einen Pulsar
  exclude: 3,       // so viele Weg-Kammern um S und G bleiben pulsarfrei
  teeth: 6,         // Zacken-Paare der Zackenstrecke
  amp: 0.15,        // Zacken-Amplitude beidseits der Linie (Gangbreiten)
  lift: 0.18,       // Abstand der Linie von ihrer Wand (Gangbreiten) -- mit
                    // amp zusammen bleibt die Zackenspitze knapp vor der Wand
  pulseFreq: 0.8,   // Hz: Zusammenziehen/Ausdehnen der Zackenstrecke
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

const QUARTER = Math.PI / 2;

// Winkel-Konvention wie bei den Flippern (Drehung um die Gang-Laengsachse):
// 0 = unten, PI/2 = rechts (+quer), PI = oben, 3*PI/2 = links (-quer).
function orientIndex(angle) {
  return ((Math.round(angle / QUARTER) % 4) + 4) % 4;
}

// Eingerastete Seiten-Stellung: +1 (rechts) / -1 (links) / 0 (unten, oben
// oder mitten im Flip) -- nur seitlich gibt es das Vorbei-Schlupfloch.
export function pulsarSide(p) {
  if (p.mode !== 'hold') return 0;
  const k = orientIndex(p.angle);
  return k === 1 ? 1 : k === 3 ? -1 : 0;
}

// Winziger deterministischer Zufall pro Pulsar (LCG wie bei den Flippern).
function nextRnd(p) {
  p.rnd = (Math.imul(p.rnd, 1664525) + 1013904223) >>> 0;
  return p.rnd / 4294967296;
}

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
// aus allen vier Stellungen (er verweilt ueberall lange).
function makePulsar(axis, cross, along, rnd) {
  const p = {
    axis, cross, along,
    angle: 0, mode: 'hold', hold: 0, from: 0, delta: 0, flipT: 0, rotDir: 1,
    armed: true,   // nach einer Beruehrung entschaerft, bis der Spieler Abstand hat
    alive: true,   // Pulsare sterben nie -- das Flag hält die Marker-Pipeline einheitlich
    phase: 0,      // Pulsier-Phase (individuell, kein Gleichtakt)
    rnd: rnd >>> 0,
  };
  p.angle = orientIndex(Math.floor(nextRnd(p) * 4) * QUARTER) * QUARTER;
  p.hold = holdRoll(p);
  p.phase = nextRnd(p) * 2 * Math.PI;
  p.rotDir = nextRnd(p) < 0.5 ? -1 : 1;
  return p;
}

// Belegte Laengs-Spanne eines fremden Feinds (Spinner ODER Flipper) -- die
// beiden Formen unterscheiden sich: Flipper haben min/max, Spinner Wand +
// Laufrichtung + Ganglaenge.
function spanOf(s) {
  if ('min' in s) return [s.min, s.max];
  const a = s.wall;
  const b = s.wall + s.dir * s.runLen;
  return [Math.min(a, b), Math.max(a, b)];
}

// Erzeugt die Pulsare eines Levels. config = { count } (Level-Daten),
// opts = { unit, cell, rng, avoid } -- `avoid` sind Spinner UND Flipper des
// Levels: deren Gangstuecke bleiben pulsarfrei (drei Feindarten in einem
// Gang waeren unlesbar). Platzierung wie bei Spinnern/Flippern: lange
// gerade Gangstuecke, Weg-Gaenge zuerst, Schutzzone um S und G; der Pulsar
// sitzt fest in der Gang-MITTE. Deterministisch bei gleichem rng.
export function createPulsars(maze, config, opts) {
  const { unit, cell, rng, avoid = [] } = opts;
  const count = config.count ?? 0;

  const path = (findPath(maze, maze.start, maze.goal) ?? []).filter(([x, y]) => isChamber(x, y));
  const key = (x, y) => x + ',' + y;
  const pathSet = new Set(path.map(([x, y]) => key(x, y)));
  const guard = new Set([...path.slice(0, PULSAR.exclude), ...path.slice(-PULSAR.exclude)]
    .map(([x, y]) => key(x, y)));

  const candidates = [];
  for (const run of straightRuns(maze)) {
    if (run.chambers < PULSAR.minChambers) continue;
    let guarded = false;
    let onPath = false;
    for (let i = run.lo; i <= run.hi; i += 2) {
      const k = run.axis === 'x' ? key(i, run.fix) : key(run.fix, i);
      if (pathSet.has(k)) onPath = true;
      if (guard.has(k)) guarded = true;
    }
    if (guarded) continue;
    const centerOf = (i) => (run.axis === 'x'
      ? cellCenter(maze, i, run.fix, unit)
      : cellCenter(maze, run.fix, i, unit));
    const a = centerOf(run.lo);
    const b = centerOf(run.hi);
    const min = run.axis === 'x' ? a[0] : a[1];
    const max = run.axis === 'x' ? b[0] : b[1];
    const cross = run.axis === 'x' ? a[1] : a[0];
    // Gangstuecke mit Spinner oder Flipper ueberspringen (gleiche Achse,
    // gleiche Gangmitte, ueberlappende Spanne).
    const taken = avoid.some((s) => {
      if (s.axis !== run.axis || Math.abs(s.cross - cross) >= 1e-9) return false;
      const [lo, hi] = spanOf(s);
      return lo < max + cell && hi > min - cell;
    });
    if (!taken) candidates.push({ ...run, onPath, min, max, cross });
  }
  candidates.sort((a, b) => (b.onPath - a.onPath)
    || (b.chambers - a.chambers) || (a.fix - b.fix) || (a.lo - b.lo) || (a.axis < b.axis ? -1 : 1));

  return candidates.slice(0, count).map((run) => makePulsar(
    run.axis, run.cross, (run.min + run.max) / 2, randInt(rng, 4294967296)));
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
  if (!pulsars) return null;
  return pulsars.map((p) => {
    const [x, z] = pulsarPos(p);
    return { x, z, alive: true };
  });
}

// Aktuelle halbe Laenge der Zackenstrecke (Gangbreiten-Anteil) -- das
// PULSIEREN: zieht sich zusammen und dehnt sich wieder aus.
export function pulsarSpread(p, time) {
  const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * PULSAR.pulseFreq * time + p.phase);
  return PULSAR.spreadMin + (PULSAR.spreadMax - PULSAR.spreadMin) * w;
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

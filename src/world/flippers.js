// Flipper (ab Level 21): magentafarbene, gestreckte X-Silhouetten, die im
// GANG-QUERSCHNITT stehen und den Gang entlangwandern. Mit der langen Seite
// spannen sie sich immer zwischen zwei Gangkanten: unten (auf dem Boden),
// links/rechts (an der Wand hochkant) oder oben (unter der Decke). Gelegent-
// lich "flippen" sie um 90 Grad in die Nachbarlage -- an den Seiten rasten
// sie LANGE ein, oben und unten klappen sie fast sofort weiter durch.
// Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// Spielregeln (Boris' Spec, 14.7.2026):
// - Die Flipper-EBENE (der ganze Gang-Querschnitt an ihrer Position) ist
//   toedlich: wer sie beruehrt oder kreuzt, wird zerstoert -- vorbei kommt
//   nur, wer den Flipper abschiesst.
// - Abschiessbar sind sie NUR in der Links- oder Rechts-Stellung: dort
//   kreuzt das hochkant stehende X die Schusshoehe (Augenhoehe) nahe der
//   Wand -- man muss den Lenk-Ausschlag des Fadenkreuzes nutzen und etwas
//   zur Seite zielen. Unten/oben fliegen die Schuesse drueber/drunter.
// - Sie sind etwas schneller als die Tanker (rote Rauten, ENEMY.patrolSpeed).
// - Einzeln bewachen sie lange Gangstuecke (Platzierung wie die Spinner);
//   zusaetzlich entsteht ein PAAR (links + rechts), wenn ein Tanker aus
//   3 oder mehr Feldern Entfernung abgeschossen wird (spawnFlipperPair) --
//   die Strafe fuers Feige-von-weitem-Schiessen.

import { OPEN, isChamber, findPath } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { randInt } from '../util/rng.js';
import { straightRuns } from './spinners.js';

export const FLIPPER = {
  minChambers: 3,  // so viele Kammern braucht ein Gangstueck fuer einen Flipper
  exclude: 3,      // so viele Weg-Kammern um S und G bleiben flipperfrei
  speed: 0.85,     // Wander-Tempo (Gangbreiten/s) -- schneller als die Tanker
                   // (ENEMY.patrolSpeed 0.6), aber fliehbar (DRIVE.cruise 1.5)
  length: 0.48,    // halbe Laenge des X entlang der langen Achse (Gangbreiten)
  width: 0.15,     // halbe Breite quer dazu (Gangbreiten)
  notch: 0.1,      // Kerbtiefe der Spitzen-Pfeile (Gangbreiten)
  lift: 0.16,      // Abstand der X-Ebene von ihrer Wand (Gangbreiten) -- das X
                   // schwebt knapp vor Boden/Wand/Decke
  shotRadius: 0.3, // Trefferradius eigener Projektile um die X-Mitte (Gangbreiten)
  holdSide: 2.2,   // s Grundverweildauer in Links-/Rechts-Stellung ...
  holdJitter: 0.8, // ... plus/minus dieser Streuung (pro Flipper gewuerfelt)
  holdShort: 0.3,  // s: oben/unten nur kurz "einrasten", dann weiterklappen
  flipTime: 0.3,   // s fuer eine 90-Grad-Drehung
  pairFields: 3,   // ab dieser Abschuss-Distanz (in Feldern) entsteht das Paar
  pairGap: 0.6,    // Versatz des zweiten Paar-Flippers (Gangbreiten)
};

const QUARTER = Math.PI / 2;

// Winkel-Konvention (Drehung um die Gang-Laengsachse): 0 = unten,
// PI/2 = rechts (+quer), PI = oben, 3*PI/2 = links (-quer).
function orientIndex(angle) {
  return ((Math.round(angle / QUARTER) % 4) + 4) % 4;
}

// Eingerastete Seiten-Stellung: +1 (rechts) / -1 (links) / 0 (unten, oben
// oder mitten im Flip) -- nur in einer Seiten-Stellung ist er abschiessbar.
export function flipperSide(f) {
  if (f.mode !== 'hold') return 0;
  const k = orientIndex(f.angle);
  return k === 1 ? 1 : k === 3 ? -1 : 0;
}

// Winziger deterministischer Zufall pro Flipper (LCG auf f.rnd) -- die
// Flip-Entscheidungen brauchen zur Laufzeit keinen externen rng.
function nextRnd(f) {
  f.rnd = (Math.imul(f.rnd, 1664525) + 1013904223) >>> 0;
  return f.rnd / 4294967296;
}

function isOpen(maze, x, y) {
  return x >= 0 && x < maze.n && y >= 0 && y < maze.n && maze.grid[y][x] === OPEN;
}

// Welt-Position (x,z) der X-Mitte (Gangmitte quer, `along` laengs).
export function flipperPos(f) {
  return f.axis === 'x' ? [f.along, f.cross] : [f.cross, f.along];
}

// Baustein: ein fertiger Flipper. Startwinkel eine SEITEN-Stellung (dort
// verweilen sie am laengsten), Wander- und Drehrichtung aus `rnd`.
function makeFlipper(axis, cross, along, min, max, rnd) {
  const f = {
    axis, cross, along, min, max,
    prevAlong: along,
    moveDir: 1, rotDir: 1,
    angle: 0, mode: 'hold', hold: 0, from: 0, delta: 0, flipT: 0,
    alive: true,
    rnd: rnd >>> 0,
  };
  f.moveDir = nextRnd(f) < 0.5 ? -1 : 1;
  f.rotDir = nextRnd(f) < 0.5 ? -1 : 1;
  f.angle = nextRnd(f) < 0.5 ? QUARTER : 3 * QUARTER; // links oder rechts
  f.hold = FLIPPER.holdSide + FLIPPER.holdJitter * (2 * nextRnd(f) - 1);
  return f;
}

// Erzeugt die Flipper eines Levels. config = { count } (Level-Daten),
// opts = { unit, cell, rng, avoid } -- `avoid` sind die Spinner des Levels:
// deren Gangstuecke bleiben flipperfrei (ein Flipper, der durch einen Spike
// pendelt, waere unlesbar). Platzierung wie bei den Spinnern: lange gerade
// Gangstuecke, Weg-Gaenge zuerst, Schutzzone um S und G; der Flipper startet
// in der Gang-MITTE. Deterministisch bei gleichem rng.
export function createFlippers(maze, config, opts) {
  const { unit, cell, rng, avoid = [] } = opts;
  const count = config.count ?? 0;

  const path = (findPath(maze, maze.start, maze.goal) ?? []).filter(([x, y]) => isChamber(x, y));
  const key = (x, y) => x + ',' + y;
  const pathSet = new Set(path.map(([x, y]) => key(x, y)));
  const guard = new Set([...path.slice(0, FLIPPER.exclude), ...path.slice(-FLIPPER.exclude)]
    .map(([x, y]) => key(x, y)));

  const candidates = [];
  for (const run of straightRuns(maze)) {
    if (run.chambers < FLIPPER.minChambers) continue;
    let guarded = false;
    let onPath = false;
    for (let i = run.lo; i <= run.hi; i += 2) {
      const k = run.axis === 'x' ? key(i, run.fix) : key(run.fix, i);
      if (pathSet.has(k)) onPath = true;
      if (guard.has(k)) guarded = true;
    }
    if (guarded) continue;
    // Spannweite in Welt-Koordinaten (wie bei den Spinnern).
    const centerOf = (i) => (run.axis === 'x'
      ? cellCenter(maze, i, run.fix, unit)
      : cellCenter(maze, run.fix, i, unit));
    const a = centerOf(run.lo);
    const b = centerOf(run.hi);
    const min = run.axis === 'x' ? a[0] : a[1];
    const max = run.axis === 'x' ? b[0] : b[1];
    const cross = run.axis === 'x' ? a[1] : a[0];
    // Gangstuecke mit Spinner ueberspringen (gleiche Achse, gleiche Gang-
    // mitte, ueberlappende Spanne).
    const taken = avoid.some((s) => s.axis === run.axis
      && Math.abs(s.cross - cross) < 1e-9
      && Math.min(s.wall, s.wall + s.dir * s.runLen) < max + cell
      && Math.max(s.wall, s.wall + s.dir * s.runLen) > min - cell);
    if (!taken) candidates.push({ ...run, onPath, min, max, cross });
  }
  candidates.sort((a, b) => (b.onPath - a.onPath)
    || (b.chambers - a.chambers) || (a.fix - b.fix) || (a.lo - b.lo) || (a.axis < b.axis ? -1 : 1));

  return candidates.slice(0, count).map((run) => makeFlipper(
    run.axis, run.cross, (run.min + run.max) / 2, run.min, run.max,
    randInt(rng, 4294967296)));
}

// Das Flipper-PAAR beim Fern-Abschuss eines Tankers: zwei Flipper an dessen
// Position, einer in Links-, einer in Rechts-Stellung, leicht versetzt --
// beide wandern auf den Spieler ZU. Achse/Richtung aus der Sichtlinie
// Spieler -> Tanker (der Schuss flog ja den Gang entlang). `enemy` ist der
// getroffene Tanker (x, z, gx, gy), `player` = { px, pz }.
export function spawnFlipperPair(maze, enemy, player, opts) {
  const { unit, cell } = opts;
  const dx = player.px - enemy.x;
  const dz = player.pz - enemy.z;
  const axis = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
  const toward = (axis === 'x' ? dx : dz) >= 0 ? 1 : -1;

  // Patrouillen-Spanne des Tanker-Gangs entlang der Achse (Kammer-Mitten).
  const [ax, ay] = axis === 'x' ? [1, 0] : [0, 1];
  let back = 0;
  while (isOpen(maze, enemy.gx - (back + 1) * ax, enemy.gy - (back + 1) * ay)) back++;
  let fwd = 0;
  while (isOpen(maze, enemy.gx + (fwd + 1) * ax, enemy.gy + (fwd + 1) * ay)) fwd++;
  const lo = cellCenter(maze, enemy.gx - back * ax, enemy.gy - back * ay, unit);
  const hi = cellCenter(maze, enemy.gx + fwd * ax, enemy.gy + fwd * ay, unit);
  const min = axis === 'x' ? lo[0] : lo[1];
  const max = axis === 'x' ? hi[0] : hi[1];
  const center = cellCenter(maze, enemy.gx, enemy.gy, unit);
  const cross = axis === 'x' ? center[1] : center[0];

  const clamp = (v) => Math.min(max, Math.max(min, v));
  const at = axis === 'x' ? enemy.x : enemy.z;
  return [QUARTER, 3 * QUARTER].map((angle, i) => {
    const f = makeFlipper(axis, cross, clamp(at - toward * i * FLIPPER.pairGap * cell),
      min, max, (Math.imul(enemy.gx, 2654435761) ^ Math.imul(enemy.gy, 40503) ^ i) >>> 0);
    f.angle = angle;                       // einer links, einer rechts ...
    f.hold = FLIPPER.holdSide + 0.3 * i;   // ... leicht versetzt im Takt
    f.moveDir = toward;                    // beide auf den Spieler zu
    f.rotDir = i === 0 ? 1 : -1;
    return f;
  });
}

// Ein Simulationsschritt: wandern (an den Gang-Enden wenden) und flippen.
// An den Seiten wird die naechste Drehrichtung gewuerfelt (zu Boden ODER
// Decke), oben/unten klappt es in DERSELBEN Richtung direkt weiter durch.
export function flippersStep(flippers, dt, cell) {
  for (const f of flippers) {
    if (!f.alive) continue;
    f.prevAlong = f.along;
    f.along += f.moveDir * FLIPPER.speed * cell * dt;
    if (f.along > f.max) { f.along = f.max; f.moveDir = -1; }
    else if (f.along < f.min) { f.along = f.min; f.moveDir = 1; }

    if (f.mode === 'hold') {
      f.hold -= dt;
      if (f.hold <= 0) {
        f.mode = 'flip';
        f.from = f.angle;
        f.flipT = 0;
        if (orientIndex(f.angle) % 2 === 1) f.rotDir = nextRnd(f) < 0.5 ? -1 : 1;
        f.delta = f.rotDir * QUARTER;
      }
    } else {
      f.flipT += dt;
      if (f.flipT >= FLIPPER.flipTime) {
        f.angle = ((f.from + f.delta) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        f.mode = 'hold';
        f.hold = orientIndex(f.angle) % 2 === 1
          ? FLIPPER.holdSide + FLIPPER.holdJitter * (2 * nextRnd(f) - 1)
          : FLIPPER.holdShort;
      } else {
        f.angle = f.from + f.delta * (f.flipT / FLIPPER.flipTime);
      }
    }
  }
}

// Projektil-Treffer an (x,z): NUR in eingerasteter Links-/Rechts-Stellung --
// dort kreuzt das hochkant stehende X die Schusshoehe nahe der Wand; man
// zielt mit dem Lenk-Ausschlag dorthin. Unten/oben (und mitten im Flip)
// fliegen Schuesse ungehindert vorbei. Liefert das Ereignis oder null.
export function flipperShotHit(flippers, x, z, cell) {
  for (const f of flippers) {
    if (!f.alive) continue;
    const side = flipperSide(f);
    if (side === 0) continue;
    const q = f.cross + side * (0.5 - FLIPPER.lift) * cell;
    const [hx, hz] = f.axis === 'x' ? [f.along, q] : [q, f.along];
    if (Math.hypot(x - hx, z - hz) < FLIPPER.shotRadius * cell) {
      f.alive = false;
      return { type: 'flipper', x: hx, z: hz, flipper: f };
    }
  }
  return null;
}

// Spieler-Kollision mit der Flipper-EBENE: der ganze Gang-Querschnitt an
// der Flipper-Position ist toedlich (unabhaengig von der Stellung) --
// Beruehren (Abstand laengs < radius) oder Kreuzen (Vorzeichenwechsel der
// Laengs-Differenz, beide Seiten bewegen sich: prev + prevAlong). Quer
// zaehlt nur der eigene Gang (halbe Gangbreite). Liefert
// { x, z, flipper } oder null.
export function flipperPlayerHit(flippers, px, pz, radius, cell, prev) {
  const ppx = prev?.px ?? px;
  const ppz = prev?.pz ?? pz;
  for (const f of flippers) {
    if (!f.alive) continue;
    const along = f.axis === 'x' ? px : pz;
    const crossP = f.axis === 'x' ? pz : px;
    if (Math.abs(crossP - f.cross) >= 0.5 * cell) continue;
    const gNow = along - f.along;
    const gPrev = (f.axis === 'x' ? ppx : ppz) - f.prevAlong;
    if (Math.abs(gNow) < radius || (gPrev > 0) !== (gNow > 0)) {
      const [x, z] = flipperPos(f);
      return { x, z, flipper: f };
    }
  }
  return null;
}

// Marker-Positionen fuer die Kartensicht (lebende Flipper).
export function flipperMarkers(flippers) {
  if (!flippers) return null;
  return flippers.filter((f) => f.alive).map((f) => {
    const [x, z] = flipperPos(f);
    return { x, z, alive: true };
  });
}

// Geometrie eines Flippers als Liniensegmente (lokale Flaechen-Welt): die
// gestreckte X-Kontur (zwei sich kreuzende Diagonalen mit gekerbten
// Pfeil-Spitzen, wie Boris' Skizze) im GANG-QUERSCHNITT an `along`. Der
// Winkel dreht die Figur um die Gang-Laengsachse: die X-Mitte sitzt
// (0.5 - lift) Gangbreiten von der Gangmitte Richtung Boden/Wand/Decke,
// die lange Achse steht senkrecht dazu ("zwischen zwei Gangkanten").
// opts = { cell }.
export function flipperSegments(f, opts) {
  const { cell } = opts;
  const L = FLIPPER.length * cell;
  const W = FLIPPER.width * cell;
  const N = FLIPPER.notch * cell;
  const d = (0.5 - FLIPPER.lift) * cell;
  const cu = Math.cos(f.angle);
  const su = Math.sin(f.angle);
  // Querschnitt: u = quer zur Gangmitte, v = Hoehe ueber dem Boden.
  const C = [d * su, 0.5 * cell - d * cu]; // X-Mitte
  const E1 = [cu, su];                     // lange Achse
  const E2 = [-su, cu];                    // kurze Achse (zeigt zur Gangmitte)
  const pt = (a, b) => {
    const u = C[0] + a * E1[0] + b * E2[0];
    const v = C[1] + a * E1[1] + b * E2[1];
    return f.axis === 'x' ? [f.along, v, f.cross + u] : [f.cross + u, v, f.along];
  };
  // Kontur: Diagonale hoch, rechte Pfeil-Kerbe, Diagonale zurueck, linke Kerbe.
  const ring = [
    pt(-L, -W), pt(L, W), pt(L - N, 0), pt(L, -W), pt(-L, W), pt(-L + N, 0),
  ];
  const segs = [];
  for (let i = 0; i < ring.length; i++) {
    segs.push([ring[i], ring[(i + 1) % ring.length]]);
  }
  return segs;
}

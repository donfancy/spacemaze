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
// - Seit dem STURM-Branch (Boris, 3.9.2026) entstehen sie NUR noch als
//   PAAR (links + rechts) aus JEDEM Tanker-Abschuss (spawnFlipperPair);
//   createFlippers bleibt als Platzierungs-Baustein fuer Tests/Experimente.
// - RETTUNGSSCHUSS (Sturm): spaetestens `flipDist` vor dem Spieler klappt
//   ein Flipper IMMER (Zwangs-Flip, aus jeder Stellung, einmal pro
//   Annaeherung). WAEHREND des Klappens -- in der Diagonale (45 Grad +-
//   diagWindow) -- zerstoert ihn ein GERADER Schuss (Gangmitte). Das
//   Fenster ist kurz (+-12 Grad = 0.08 s der 0.3-s-Drehung), und der
//   Treffer ist ein exaktes KREUZEN der Flipper-Ebene (Vorzeichenwechsel
//   zwischen zwei Substeps; ein Treffer-Radius verlaengerte das Fenster
//   zeitlich und machte Dauerfeuer zum Selbstlaeufer): wer beim Klappbeginn
//   gezielt drueckt, trifft sicher (Flugzeit 1.2 Gangbreiten / 8 = 0.15 s,
//   der Flipper kommt entgegen -> Ankunft ~0.135 s, mitten im Fenster);
//   Dauerfeuer (5/s, Ebenen-Kreuzungen alle ~0.18 s, Phase zufaellig zum
//   Klappbeginn) erwischt es nur etwa jedes zweite Mal -- Glueck, kein
//   Verlass (abgesichert per Monte-Carlo-Test).

import { cellAt, cellCenter } from './mazeWorld.js';
import { randInt } from '../util/rng.js';
import {
  corridorCandidates, foeMarkers, openSpan, QUARTER, orientIndex, sideOf, nextRnd,
} from './foePlacement.js';

export const FLIPPER = {
  minChambers: 3,  // so viele Kammern braucht ein Gangstueck fuer einen Flipper
  exclude: 3,      // so viele Weg-Kammern um S und G bleiben flipperfrei
  speed: 0.7,      // Wander-Tempo (Gangbreiten/s) -- fliehbar (DRIVE.cruise 1.5);
                   // Sturm-Tuning 0.85 -> 0.7: seit JEDER Tanker-Abschuss ein
                   // Paar spawnt, kommen bis zu 12 pro Alley -- der Messlauf
                   // starb fast nur an Flippern (PLAN-STURM.md)
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
  pairGap: 0.6,    // Versatz des zweiten Paar-Flippers (Gangbreiten)
  flipDist: 1.2,   // Gangbreiten: spaetestens hier vor dem Spieler klappt er (Zwangs-Flip)
  flipReset: 1.8,  // Gangbreiten: ab diesem Abstand ist der Zwangs-Flip wieder scharf
  diagWindow: Math.PI / 15, // rad: Diagonal-Fenster um 45 Grad (+-12) fuer den Rettungsschuss
  diagTol: 0.06,   // Gangbreiten: Laengs-Toleranz des Diagonal-Treffers, wenn der
                   // Aufrufer keine Vor-Lage des Schusses liefert (Schuss-Substep 0.1)
};

// Eingerastete Seiten-Stellung: +1 (rechts) / -1 (links) / 0 (unten, oben
// oder mitten im Flip) -- nur in einer Seiten-Stellung ist er abschiessbar.
// (Winkel-Raster und LCG-Zufall: foePlacement.js, geteilt mit den Pulsaren.)
export const flipperSide = sideOf;

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
    forced: false, // Zwangs-Flip dieser Annaeherung schon verbraucht?
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
// pendelt, waere unlesbar). Platzierung via corridorCandidates
// (foePlacement.js, wie Spinner/Pulsare); der Flipper startet in der
// Gang-MITTE. Deterministisch bei gleichem rng.
export function createFlippers(maze, config, opts) {
  const { unit, cell, rng, avoid = [] } = opts;
  const count = config.count ?? 0;
  const candidates = corridorCandidates(maze, {
    minChambers: FLIPPER.minChambers, exclude: FLIPPER.exclude, unit, cell, avoid,
  });
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

  // Spanne des Gangs entlang der Achse (Kammer-Mitten), ausgehend von der
  // AKTUELLEN Zelle des Tankers -- ein patrouillierender Tanker kann beim
  // Abschuss Kammern von seiner Geburtszelle (gx/gy) entfernt stehen, und
  // quer abgeschossen laege die Spanne sonst im falschen Gang.
  const [egx, egy] = cellAt(maze, enemy.x, enemy.z, unit);
  const [ax, ay] = axis === 'x' ? [1, 0] : [0, 1];
  const [back, fwd] = openSpan(maze, egx, egy, ax, ay);
  const lo = cellCenter(maze, egx - back * ax, egy - back * ay, unit);
  const hi = cellCenter(maze, egx + fwd * ax, egy + fwd * ay, unit);
  const min = axis === 'x' ? lo[0] : lo[1];
  const max = axis === 'x' ? hi[0] : hi[1];
  const center = cellCenter(maze, egx, egy, unit);
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

// Flip beginnen: an den Seiten wird die Drehrichtung gewuerfelt (zu Boden
// ODER Decke), oben/unten klappt es in DERSELBEN Richtung weiter durch.
function beginFlip(f) {
  f.mode = 'flip';
  f.from = f.angle;
  f.flipT = 0;
  if (orientIndex(f.angle) % 2 === 1) f.rotDir = nextRnd(f) < 0.5 ? -1 : 1;
  f.delta = f.rotDir * QUARTER;
}

// Steht der Flipper in der DIAGONALE (45 Grad +- diagWindow zwischen zwei
// Rast-Stellungen)? Nur dort trifft ihn der gerade Rettungsschuss.
export function flipperDiagonal(f) {
  if (f.mode !== 'flip') return false;
  const r = ((f.angle % QUARTER) + QUARTER) % QUARTER;
  return Math.abs(r - QUARTER / 2) <= FLIPPER.diagWindow;
}

// Ein Simulationsschritt: wandern (an den Gang-Enden wenden) und flippen.
// `player` = { px, pz } (optional): ZWANGS-FLIP -- steht der Spieler im
// Gang des Flippers und ist er naeher als flipDist, klappt der Flipper
// sofort aus jeder Rast-Stellung (einmal pro Annaeherung; erst ab
// flipReset Abstand wieder scharf). So gibt es vor JEDEM Kontakt genau
// ein Diagonal-Fenster fuer den Rettungsschuss.
export function flippersStep(flippers, dt, cell, player = null) {
  for (const f of flippers) {
    if (!f.alive) continue;
    f.prevAlong = f.along;
    f.along += f.moveDir * FLIPPER.speed * cell * dt;
    if (f.along > f.max) { f.along = f.max; f.moveDir = -1; }
    else if (f.along < f.min) { f.along = f.min; f.moveDir = 1; }

    if (player) {
      const alongP = f.axis === 'x' ? player.px : player.pz;
      const crossP = f.axis === 'x' ? player.pz : player.px;
      const gap = Math.abs(alongP - f.along);
      if (Math.abs(crossP - f.cross) >= 0.5 * cell || gap > FLIPPER.flipReset * cell) {
        f.forced = false;
      } else if (!f.forced && gap <= FLIPPER.flipDist * cell && f.mode === 'hold') {
        f.forced = true;
        beginFlip(f);
      }
    }

    if (f.mode === 'hold') {
      f.hold -= dt;
      if (f.hold <= 0) beginFlip(f);
    } else {
      f.flipT += dt;
      if (f.flipT >= FLIPPER.flipTime) {
        // Exakt im 90-Grad-Raster einrasten (wie Pulsare/Gyro) statt
        // Float-Modulo -- kein Winzrest, der sich aufsummieren koennte.
        f.angle = orientIndex(f.from + f.delta) * QUARTER;
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

// Projektil-Treffer an (x,z): in eingerasteter Links-/Rechts-Stellung --
// dort kreuzt das hochkant stehende X die Schusshoehe nahe der Wand; man
// zielt mit dem Lenk-Ausschlag dorthin -- ODER in der DIAGONALE waehrend
// des Klappens (Rettungsschuss, Sturm-Branch): dann trifft jeder Schuss,
// der die Flipper-Ebene im eigenen Gang KREUZT (die Diagonale spannt sich
// quer durch den Gang) -- `prev` = { x, z } ist die Schuss-Lage vor dem
// Substep (shots.js reicht das Schuss-Objekt), ohne prev gilt die
// Toleranz diagTol. Unten/oben und ausserhalb des Diagonal-Fensters
// fliegen Schuesse ungehindert vorbei. Liefert das Ereignis oder null
// (`diagonal: true` beim Rettungsschuss).
// WAND SCHUETZT: nur Treffer im EIGENEN Gang zaehlen (Quer-Check wie beim
// Spieler) -- der Substep-Punkt eines Schusses aus dem Nachbargang kann bis
// zu 0.5 Einheiten in der Trennwand liegen und kaeme dem Seiten-Trefferpunkt
// (0.5-lift Gangbreiten vor der Wand) sonst naeher als shotRadius.
export function flipperShotHit(flippers, x, z, cell, prev = null) {
  for (const f of flippers) {
    if (!f.alive || f.zapAt != null) continue; // gezappt (Superzapper): wartet nur noch auf die Explosion
    const crossS = f.axis === 'x' ? z : x;
    if (Math.abs(crossS - f.cross) >= 0.5 * cell) continue;
    if (flipperDiagonal(f)) {
      const g = (f.axis === 'x' ? x : z) - f.along;
      const crossed = prev
        ? ((f.axis === 'x' ? prev.x : prev.z) - f.along) * g <= 0
        : Math.abs(g) < FLIPPER.diagTol * cell;
      if (crossed) {
        f.alive = false;
        const [hx, hz] = flipperPos(f);
        return { type: 'flipper', x: hx, z: hz, flipper: f, diagonal: true };
      }
      continue;
    }
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
    if (!f.alive || f.zapAt != null) continue; // gezappt: entschaerft
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
  return foeMarkers(flippers, flipperPos);
}

// Geometrie eines Flippers als Liniensegmente (lokale Flaechen-Welt): die
// gestreckte X-Kontur (zwei sich kreuzende Diagonalen mit gekerbten
// Pfeil-Spitzen, wie Boris' Skizze) im GANG-QUERSCHNITT an `along`. Der
// Winkel dreht die Figur um die Gang-Laengsachse: die X-Mitte sitzt
// (0.5 - lift) Gangbreiten von der Gangmitte Richtung Boden/Wand/Decke,
// die lange Achse steht senkrecht dazu ("zwischen zwei Gangkanten").
// opts = { cell }.
export function flipperSegments(f, opts) {
  const { ring } = flipperShape(f, opts.cell);
  const segs = [];
  for (let i = 0; i < ring.length; i++) {
    segs.push([ring[i], ring[(i + 1) % ring.length]]);
  }
  return segs;
}

// Eck-Punkte der X-Kontur + Kreuzungsmitte (gemeinsame Basis fuer Kontur
// und Flaeche): Reihenfolge [A, B, KerbeR, D, E, KerbeL] -- A->B und D->E
// sind die langen Diagonalen (laufen durch die Mitte), dazwischen die
// gekerbten Pfeil-Spitzen.
function flipperShape(f, cell) {
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
  return {
    ring: [pt(-L, -W), pt(L, W), pt(L - N, 0), pt(L, -W), pt(-L, W), pt(-L + N, 0)],
    center: pt(0, 0),
  };
}

// Gefuellte X-Flaeche als VIER Dreiecke (2026-Engine -- 1980 zeichnet nur
// die Kontur): die Kontur ist bei der Kreuzungsmitte selbstschneidend,
// eine normale Triangulation scheitert. Die Fuellung sind die beiden
// "Schmetterlings-Fluegel" um die Mitte Z: rechts (Z,B,KerbeR),(Z,KerbeR,D),
// links (Z,E,KerbeL),(Z,KerbeL,A). opts = { cell }.
export function flipperTriangles(f, opts) {
  const { ring, center } = flipperShape(f, opts.cell);
  const [a, b, notchR, d, e, notchL] = ring;
  return [
    [center, b, notchR], [center, notchR, d],
    [center, e, notchL], [center, notchL, a],
  ];
}

// Gemeinsame Bausteine der Gang-Feinde (Spinner ab 16, Flipper ab 21,
// Pulsare ab 26). Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// 1) PLATZIERUNG (corridorCandidates): alle drei Arten bewachen lange
//    gerade Gangstuecke -- Loesungsweg-Gaenge zuerst, laengere zuerst,
//    Schutzzone um S und G bleibt frei, bereits belegte Gangstuecke
//    (`avoid`) werden uebersprungen. Vorher lebte dieser Scan als
//    Drilling in createSpinners/createFlippers/createPulsars.
// 2) QUERSCHNITTS-KINEMATIK: Flipper und Pulsare stehen im Gang-
//    Querschnitt und klappen um 90 Grad um die Gang-Laengsachse --
//    Winkel-Raster, Seiten-Stellung und der winzige LCG-Zufall pro Feind
//    sind identisch und wohnen hier.

import { isChamber, isOpenCell, findPath } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { randInt } from '../util/rng.js';

// --- Platzierung ------------------------------------------------------------

// Offene Spanne (in Grid-Zellen) durch (gx,gy) entlang einer Achse:
// [rueckwaerts, vorwaerts] offene Zellen.
export function openSpan(maze, gx, gy, ax, ay) {
  let a = 0;
  while (isOpenCell(maze, gx - (a + 1) * ax, gy - (a + 1) * ay)) a++;
  let b = 0;
  while (isOpenCell(maze, gx + (b + 1) * ax, gy + (b + 1) * ay)) b++;
  return [a, b];
}

// Maximale gerade offene Spannen (Gangstuecke) entlang beider Achsen.
// Spannen beginnen und enden immer auf Kammern (Kammern sind stets offen,
// ein offenes Zwischenwand-Feld verbindet zwei offene Kammern). Liefert
// [{ axis, fix, lo, hi, chambers }] mit Grid-Spanne [lo..hi] auf der Achse.
export function straightRuns(maze) {
  const runs = [];
  for (const axis of ['x', 'z']) {
    for (let fix = 1; fix <= maze.n - 2; fix += 2) {
      let lo = -1;
      for (let i = 1; i <= maze.n - 1; i++) {
        const open = axis === 'x' ? isOpenCell(maze, i, fix) : isOpenCell(maze, fix, i);
        if (open && lo < 0) lo = i;
        if (!open && lo >= 0) {
          const hi = i - 1;
          runs.push({ axis, fix, lo, hi, chambers: (hi - lo) / 2 + 1 });
          lo = -1;
        }
      }
    }
  }
  return runs;
}

// Belegte Laengs-Spanne eines Feinds -- die Formen unterscheiden sich:
// Flipper/Pulsare haben min/max, Spinner Wand + Laufrichtung + Ganglaenge.
export function spanOf(s) {
  if ('min' in s) return [s.min, s.max];
  const a = s.wall;
  const b = s.wall + s.dir * s.runLen;
  return [Math.min(a, b), Math.max(a, b)];
}

// Kandidaten-Gangstuecke fuer eine Feindart, fertig sortiert (Weg-Gaenge
// zuerst, dann laengere, dann deterministische Tiebreaker). opts =
// { minChambers, exclude, unit, cell, avoid } -- `avoid` sind bereits
// platzierte Feinde anderer Arten: deren Gangstuecke (gleiche Achse,
// gleiche Gangmitte, ueberlappende Spanne) werden uebersprungen.
// Jeder Kandidat: { axis, fix, lo, hi, chambers, onPath, visits, min,
// max, cross } -- min/max sind die Kammermitten der Endzellen (Welt),
// cross die Gangmitte quer, visits die Weg-Kammern auf dem Gang als
// { i: Grid-Koordinate laengs, idx: Position auf dem Loesungsweg }.
export function corridorCandidates(maze, opts) {
  const { minChambers, exclude, unit, cell, avoid = [] } = opts;

  const path = (findPath(maze, maze.start, maze.goal) ?? []).filter(([x, y]) => isChamber(x, y));
  const key = (x, y) => x + ',' + y;
  const pathIdx = new Map(path.map(([x, y], i) => [key(x, y), i]));
  const guard = new Set([...path.slice(0, exclude), ...path.slice(-exclude)]
    .map(([x, y]) => key(x, y)));

  const candidates = [];
  for (const run of straightRuns(maze)) {
    if (run.chambers < minChambers) continue;
    let guarded = false;
    const visits = [];
    for (let i = run.lo; i <= run.hi; i += 2) {
      const k = run.axis === 'x' ? key(i, run.fix) : key(run.fix, i);
      if (pathIdx.has(k)) visits.push({ i, idx: pathIdx.get(k) });
      if (guard.has(k)) guarded = true;
    }
    if (guarded) continue;
    // Spannweite in Welt-Koordinaten (Kammermitten der Endzellen).
    const centerOf = (i) => (run.axis === 'x'
      ? cellCenter(maze, i, run.fix, unit)
      : cellCenter(maze, run.fix, i, unit));
    const a = centerOf(run.lo);
    const b = centerOf(run.hi);
    const min = run.axis === 'x' ? a[0] : a[1];
    const max = run.axis === 'x' ? b[0] : b[1];
    const cross = run.axis === 'x' ? a[1] : a[0];
    const taken = avoid.some((s) => {
      if (s.axis !== run.axis || Math.abs(s.cross - cross) >= 1e-9) return false;
      const [lo, hi] = spanOf(s);
      return lo < max + cell && hi > min - cell;
    });
    if (taken) continue;
    candidates.push({ ...run, onPath: visits.length > 0, visits, min, max, cross });
  }
  candidates.sort((a, b) => (b.onPath - a.onPath)
    || (b.chambers - a.chambers) || (a.fix - b.fix) || (a.lo - b.lo) || (a.axis < b.axis ? -1 : 1));
  return candidates;
}

// Welches Gang-Ende liegt VORAUS? Auf Loesungsweg-Gaengen das Ende in
// Laufrichtung des Wegs (die Begegnung ist frontal), bei blosser Querung
// das fernere Ende (mehr Zeit zum Reagieren), abseits des Wegs wuerfelt
// der rng. Liefert true fuer das hohe Ende (run.hi). Geteilt von Spinnern
// (End-Wand) und Tanker-Alleys (Lauer-Krone).
export function aheadEnd(run, rng) {
  if (run.visits.length >= 2) {
    const byIdx = [...run.visits].sort((u, v) => u.idx - v.idx);
    return byIdx[byIdx.length - 1].i > byIdx[0].i; // Weg laeuft aufwaerts -> hohes Ende
  }
  if (run.visits.length === 1) {
    const c = run.visits[0].i;
    return c - run.lo < run.hi - c ? true
      : c - run.lo > run.hi - c ? false : randInt(rng, 2) === 1;
  }
  return randInt(rng, 2) === 1;
}

// Marker-Positionen fuer die Kartensicht: lebende Feinde, Position via
// `posOf(feind) -> [x, z]` (spinnerPos/flipperPos/pulsarPos).
export function foeMarkers(list, posOf) {
  if (!list) return null;
  return list.filter((f) => f.alive).map((f) => {
    const [x, z] = posOf(f);
    return { x, z, alive: true };
  });
}

// --- Querschnitts-Kinematik (Flipper + Pulsare) -----------------------------

export const QUARTER = Math.PI / 2;

// Winkel-Konvention (Drehung um die Gang-Laengsachse): 0 = unten,
// PI/2 = rechts (+quer), PI = oben, 3*PI/2 = links (-quer).
export function orientIndex(angle) {
  return ((Math.round(angle / QUARTER) % 4) + 4) % 4;
}

// Eingerastete Seiten-Stellung eines Querschnitts-Feinds ({mode, angle}):
// +1 (rechts) / -1 (links) / 0 (unten, oben oder mitten im Flip).
export function sideOf(f) {
  if (f.mode !== 'hold') return 0;
  const k = orientIndex(f.angle);
  return k === 1 ? 1 : k === 3 ? -1 : 0;
}

// Winziger deterministischer Zufall pro Feind (LCG auf f.rnd) -- die
// Flip-Entscheidungen brauchen zur Laufzeit keinen externen rng.
export function nextRnd(f) {
  f.rnd = (Math.imul(f.rnd, 1664525) + 1013904223) >>> 0;
  return f.rnd / 4294967296;
}

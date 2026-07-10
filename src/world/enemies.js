// Feinde (ab Level 11): schwebende, pulsierende rote Rauten in den Gaengen.
// Beruehrung = Game Over; abschiessen laesst sie in Splitter zerplatzen (weg
// ist weg). Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// Platzierung (Boris' Vorgabe): bevorzugt AUF dem Loesungsweg -- rund die
// Haelfte sitzt garantiert auf dem Weg zum Ziel (gleichmaessig verteilt,
// mit Sicherheitsabstand zu S und G), der Rest zufaellig im Labyrinth.
// Ein Teil (Level-Feld `patrol`) patrouilliert langsam den eigenen Gang
// auf und ab, der Rest schwebt an Ort und Stelle.

import { OPEN, isChamber, findPath } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { randInt } from '../util/rng.js';

export const ENEMY = {
  size: 0.3,        // Rauten-Halbhoehe (Gangbreiten)
  hitRadius: 0.32,  // Kollisionsradius gegen den Spieler (Gangbreiten)
  shotRadius: 0.4,  // Trefferradius fuer Projektile (Gangbreiten)
  pulseFreq: 1.4,   // Pulsieren (Hz)
  pulseAmp: 0.18,   // Pulsier-Hub (Anteil der Groesse)
  patrolSpeed: 0.6, // Patrouillen-Tempo (Gangbreiten/s)
  exclude: 3,       // so viele Weg-Kammern um S und G bleiben feindfrei
};

function isOpen(maze, x, y) {
  return x >= 0 && x < maze.n && y >= 0 && y < maze.n && maze.grid[y][x] === OPEN;
}

// Offene Spanne (in Grid-Zellen) durch (gx,gy) entlang einer Achse.
function openSpan(maze, gx, gy, ax, ay) {
  let a = 0;
  while (isOpen(maze, gx - (a + 1) * ax, gy - (a + 1) * ay)) a++;
  let b = 0;
  while (isOpen(maze, gx + (b + 1) * ax, gy + (b + 1) * ay)) b++;
  return [a, b]; // Zellen rueckwaerts / vorwaerts
}

// Patrouillen-Strecke fuer eine Kammer: die Achse mit der laengeren offenen
// Spanne, Grenzen = Zellmitten der Endzellen (so bleibt die Raute sicher im
// Gang). Liefert null, wenn die Kammer nach keiner Seite offen ist.
function patrolRoute(maze, gx, gy, unit, cell) {
  const [xa, xb] = openSpan(maze, gx, gy, 1, 0);
  const [za, zb] = openSpan(maze, gx, gy, 0, 1);
  const axis = xa + xb >= za + zb ? 'x' : 'z';
  const [back, fwd] = axis === 'x' ? [xa, xb] : [za, zb];
  if (back + fwd === 0) return null;
  const lo = axis === 'x'
    ? cellCenter(maze, gx - back, gy, unit)[0]
    : cellCenter(maze, gx, gy - back, unit)[1];
  const hi = axis === 'x'
    ? cellCenter(maze, gx + fwd, gy, unit)[0]
    : cellCenter(maze, gx, gy + fwd, unit)[1];
  return { axis, min: lo, max: hi, dir: 1, speed: ENEMY.patrolSpeed * cell };
}

// Erzeugt die Feinde eines Levels. config = { count, patrol } (Level-Daten),
// opts = { unit, cell, rng }. Deterministisch bei gleichem rng (Tests).
export function createEnemies(maze, config, opts) {
  const { unit, cell, rng } = opts;
  const count = config.count ?? 0;
  const used = new Set();
  const key = (x, y) => x + ',' + y;

  // 1) Loesungsweg-Kammern (ohne die Schutzzonen um S und G).
  const path = (findPath(maze, maze.start, maze.goal) ?? []).filter(([x, y]) => isChamber(x, y));
  const usable = path.slice(ENEMY.exclude, Math.max(ENEMY.exclude, path.length - ENEMY.exclude));
  const cells = [];
  const onPath = Math.min(usable.length, Math.ceil(count / 2));
  for (let i = 0; i < onPath; i++) {
    // gleichmaessig ueber den Weg verteilt -- man begegnet ihnen unterwegs.
    const c = usable[Math.floor(((i + 0.5) / onPath) * usable.length)];
    if (!used.has(key(c[0], c[1]))) {
      used.add(key(c[0], c[1]));
      cells.push(c);
    }
  }

  // 2) Rest zufaellig auf freie Kammern (nicht doppelt, nicht bei S/G).
  const guard = new Set([...path.slice(0, ENEMY.exclude), ...path.slice(-ENEMY.exclude)]
    .map(([x, y]) => key(x, y)));
  const free = [];
  for (let y = 1; y <= maze.n - 2; y += 2) {
    for (let x = 1; x <= maze.n - 2; x += 2) {
      if (!used.has(key(x, y)) && !guard.has(key(x, y))) free.push([x, y]);
    }
  }
  while (cells.length < count && free.length > 0) {
    const [c] = free.splice(randInt(rng, free.length), 1);
    cells.push(c);
  }

  // 3) Feinde bauen; der konfigurierte Anteil patrouilliert (zufaellige Auswahl).
  const wantPatrol = Math.round((config.patrol ?? 0) * cells.length);
  const patrolPick = cells.map((_, i) => i);
  for (let i = patrolPick.length - 1; i > 0; i--) { // Fisher-Yates
    const j = randInt(rng, i + 1);
    [patrolPick[i], patrolPick[j]] = [patrolPick[j], patrolPick[i]];
  }
  const patrolSet = new Set(patrolPick.slice(0, wantPatrol));

  return cells.map(([gx, gy], i) => {
    const [x, z] = cellCenter(maze, gx, gy, unit);
    return {
      gx, gy, x, z,
      alive: true,
      phase: rng() * 2 * Math.PI, // individuelles Pulsieren
      patrol: patrolSet.has(i) ? patrolRoute(maze, gx, gy, unit, cell) : null,
    };
  });
}

// Ein Simulationsschritt: Patrouillen bewegen sich, an den Enden wird gewendet.
export function enemiesStep(enemies, dt) {
  for (const e of enemies) {
    if (!e.alive || !e.patrol) continue;
    const p = e.patrol;
    const coord = p.axis === 'x' ? 'x' : 'z';
    let v = e[coord] + p.dir * p.speed * dt;
    if (v > p.max) { v = p.max; p.dir = -1; }
    else if (v < p.min) { v = p.min; p.dir = 1; }
    e[coord] = v;
  }
}

// Liefert den ersten lebenden Feind im Umkreis `radius` (Welt-Einheiten) um
// (x,z) -- oder null. Der Aufrufer waehlt den Radius (Spieler vs. Projektil).
export function enemyHit(enemies, x, z, radius) {
  for (const e of enemies) {
    if (!e.alive) continue;
    if (Math.hypot(e.x - x, e.z - z) < radius) return e;
  }
  return null;
}

// Rauten-Geometrie eines Feindes als Liniensegmente (lokale Flaechen-Welt):
// Doppel-Kontur (aussen + innen), pulsierend, als Billboard um die Hochachse
// zum Spieler gedreht. Die Segmente laufen durch dieselbe Hidden-Line-
// Pipeline wie die Waende (renderFaceOverlay) -- nur eben in Rot.
// opts = { cell, px, pz, height } (height = Schwebe-Hoehe der Rauten-Mitte).
export function enemySegments(enemy, time, opts) {
  const { cell, px, pz, height } = opts;
  const pulse = 1 + ENEMY.pulseAmp * Math.sin(2 * Math.PI * ENEMY.pulseFreq * time + enemy.phase);
  const s = ENEMY.size * cell * pulse;
  const w = 0.75 * s; // Rauten etwas schlanker als hoch
  // Querachse senkrecht zur Sichtlinie Spieler -> Feind (zylindrisches Billboard).
  const dx = enemy.x - px;
  const dz = enemy.z - pz;
  const d = Math.hypot(dx, dz);
  const ux = d > 1e-9 ? -dz / d : 1;
  const uz = d > 1e-9 ? dx / d : 0;
  const segs = [];
  for (const k of [1, 0.45]) { // Aussen- und Innen-Kontur
    const top = [enemy.x, height + s * k, enemy.z];
    const bot = [enemy.x, height - s * k, enemy.z];
    const left = [enemy.x - ux * w * k, height, enemy.z - uz * w * k];
    const right = [enemy.x + ux * w * k, height, enemy.z + uz * w * k];
    segs.push([top, right], [right, bot], [bot, left], [left, top]);
  }
  return segs;
}

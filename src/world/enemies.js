// Tanker (ab Level 11): pulsierende Rauten -- seit dem STURM-Branch (Boris'
// Tempest-Mechanik, 3.9.2026) als LAUERER an langen Gaengen ("shooting
// alleys"). Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// Zustands-Automat pro Tanker:
//   lurk  -- sitzt VERKLEINERT oben auf einer Wand-KRONE (End-Wand des
//            Gangs, bis drei nebeneinander; weitere auf den Seitenwand-
//            Kronen weiter hinten) und schiebt sich langsam hin und her.
//            Unverwundbar und harmlos (ausser Reichweite).
//   drop  -- purzelt in den Gang (Groesse waechst auf 1), einer nach dem
//            anderen (dropGap), sobald die Gruppe "in Sicht" kommt: der
//            Spieler ist IM Gang und hat die Lauer-Wand VOR sich
//            (Blick-Halbebene -- wer mit dem Ruecken einfaehrt, loest
//            nichts aus).
//   hunt  -- jagt GANGBUNDEN auf die Laengs-Position des Spielers zu
//            (huntSpeed < DRIVE.cruise: fliehbar) und FEUERT dieselben
//            sirrenden Schuesse wie die Spinner (world/spinners.js --
//            gangbreit toedlich, abfangbar per eigenem Feuer). Feuer
//            braucht nur den Spieler im Gang, NICHT seinen Blick: wer sich
//            umdreht, kriegt es in den Ruecken (Boris' Entscheid). Verlaesst
//            der Spieler den Gang, laeuft der Jaeger zur letzten bekannten
//            Stelle und wartet. Beruehrung = Crash (wie immer).
// Ein Abschuss hinterlaesst IMMER ein Flipper-Paar (playing.js) -- Flipper
// entstehen nie anders.
//
// Platzierung: corridorCandidates (foePlacement.js) -- Weg-Gaenge zuerst,
// laengste zuerst, Schutzzone um S/G; `count` Tanker werden in Gruppen bis
// `group` (nie mehr als Kammern) auf die Gaenge verteilt. KEINE Gang-Sperre
// gegen Spinner/Pulsare: in langen Gaengen tauchen ALLE Feinde auf.

import { isOpenCell } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { mazeMetric } from './metric.js';
import { corridorCandidates, aheadEnd } from './foePlacement.js';

export const ENEMY = {
  size: 0.3,        // Rauten-Halbhoehe (Gangbreiten)
  hitRadius: 0.32,  // Kollisionsradius gegen den Spieler (Gangbreiten)
  shotRadius: 0.4,  // Trefferradius fuer Projektile (Gangbreiten)
  pulseFreq: 1.4,   // Pulsieren (Hz)
  pulseAmp: 0.18,   // Pulsier-Hub (Anteil der Groesse)
  exclude: 3,       // so viele Weg-Kammern um S und G bleiben feindfrei
  minChambers: 3,   // so viele Kammern braucht ein Gangstueck fuer eine Alley
  group: 6,         // maximale Gruppengroesse pro Gang (Level-Feld enemies.group)
  lurkScale: 0.3,   // Groesse beim Lauern (Anteil der vollen Raute)
  lurkSway: 0.12,   // Gangbreiten: Hin-und-her-Schieben auf der Krone (Amplitude)
  lurkFreq: 0.3,    // Hz des Schiebens
  endSlots: [0, -0.3, 0.3], // Quer-Versatz (Gangbreiten) der Plaetze auf der End-Krone
  landing: 0.5,     // Gangbreiten: Landeplatz der End-Lauerer vor der Wand
  sideLanding: 0.2, // Gangbreiten: Quer-Versatz der Seiten-Lauerer beim Landen
  dropTime: 0.6,    // s Purzeln (Krone -> Gang)
  dropGap: 0.6,     // s zwischen zwei Purzlern einer Gruppe
  huntSpeed: 1.0,   // Jagd-Tempo (Gangbreiten/s) -- unter DRIVE.cruise 1.5
  fireRate: 0.4,    // mittlere Schuesse/s pro Jaeger bei Spieler im Gang
};

// --- Platzierung ------------------------------------------------------------

// Erzeugt die Tanker eines Levels. config = { count, group? } (Level-Daten),
// opts = { unit, cell, rng }. Deterministisch bei gleichem rng (Tests).
export function createEnemies(maze, config, opts) {
  const { unit, cell, rng } = opts;
  const groupMax = config.group ?? ENEMY.group;
  let remaining = config.count ?? 0;
  const wt = mazeMetric(maze).wall * unit; // Wand-Dicke (Welt)
  const candidates = corridorCandidates(maze, {
    minChambers: ENEMY.minChambers, exclude: ENEMY.exclude, unit, cell,
  });
  const enemies = [];
  for (const run of candidates) {
    if (remaining <= 0) break;
    const size = Math.min(groupMax, run.chambers, remaining);
    const highEnd = aheadEnd(run, rng);
    const dir = highEnd ? -1 : 1;                              // Blickrichtung Wand -> Gang
    const wall = highEnd ? run.max + 0.5 * cell : run.min - 0.5 * cell; // Wandflaeche (Welt)
    const endIdx = highEnd ? run.hi : run.lo;                 // Grid-Index der Endkammer laengs
    const along = (i) => (run.axis === 'x'
      ? cellCenter(maze, i, run.fix, unit)[0]
      : cellCenter(maze, run.fix, i, unit)[1]);
    const gridOf = (i) => (run.axis === 'x' ? [i, run.fix] : [run.fix, i]);
    const worldOf = (along, cross) => (run.axis === 'x' ? [along, cross] : [cross, along]);
    const seats = [];
    // End-Krone: bis drei nebeneinander (die Krone ist wt dick, der Gang
    // eine Gangbreite breit).
    for (let k = 0; k < Math.min(ENEMY.endSlots.length, size); k++) {
      seats.push({
        seat: 'end', side: 0, crossOff: ENEMY.endSlots[k],
        along: wall - dir * 0.5 * wt,
        land: worldOf(wall + dir * ENEMY.landing * cell, run.cross + ENEMY.endSlots[k] * cell),
        cell: gridOf(endIdx - dir), // die End-WAND hinter der Endkammer
      });
    }
    // Seitenwand-Kronen "weiter hinten": von der Endkammer aus Kammer fuer
    // Kammer in den Gang hinein (nur die Zwischenwand-Stuecke NEBEN den
    // Kammern -- eine Gangbreite lang, das Schieben bleibt auf der Krone;
    // die 1-Einheit-Pfeiler dazwischen sind zu schmal), abwechselnd
    // links/rechts -- nur ueber WAND-Zellen (an einer Einmuendung schwebte
    // der Lauerer sonst ueber dem Quergang).
    for (let k = 2; seats.length < size && endIdx + dir * k >= run.lo && endIdx + dir * k <= run.hi; k += 2) {
      const i = endIdx + dir * k;
      for (const side of (k % 4 === 2 ? [-1, 1] : [1, -1])) {
        if (seats.length >= size) break;
        const [gx, gy] = run.axis === 'x' ? [i, run.fix + side] : [run.fix + side, i];
        if (isOpenCell(maze, gx, gy)) continue;
        seats.push({
          seat: 'side', side, crossOff: side * (0.5 + 0.5 * wt / cell),
          along: along(i),
          land: worldOf(along(i), run.cross + side * ENEMY.sideLanding * cell),
          cell: [gx, gy],
        });
      }
    }
    seats.forEach((st, order) => {
      const lurk = { along: st.along, cross: run.cross + st.crossOff * cell, seat: st.seat, side: st.side };
      const e = {
        axis: run.axis, cross: run.cross, min: run.min, max: run.max, dir, wall,
        lurk, order,
        x: 0, z: 0,
        mode: 'lurk', wait: null, dropT: 0, t: 0,
        from: null, to: st.land, target: run.axis === 'x' ? st.land[0] : st.land[1],
        alive: true,
        phase: rng() * 2 * Math.PI, // individuelles Pulsieren
        gx: st.cell[0], gy: st.cell[1],
      };
      placeLurker(e, cell);
      enemies.push(e);
    });
    remaining -= seats.length;
  }
  return enemies;
}

// Welt-Lage aus Gang-Koordinaten (laengs, quer).
function setPos(e, along, cross) {
  if (e.axis === 'x') { e.x = along; e.z = cross; } else { e.x = cross; e.z = along; }
}

// Lauer-Lage auf der Krone: End-Krone schiebt sich QUER (ueber die
// Gangbreite), Seiten-Krone LAENGS (den Gang entlang).
function placeLurker(e, cell) {
  const sway = ENEMY.lurkSway * cell * Math.sin(2 * Math.PI * ENEMY.lurkFreq * e.t + e.phase);
  if (e.lurk.seat === 'end') setPos(e, e.lurk.along, e.lurk.cross + sway);
  else setPos(e, e.lurk.along + sway, e.lurk.cross);
}

// Steht der Spieler in der Alley dieses Tankers? (quer in der Gangbreite,
// laengs in der Spanne bis an die Wandflaechen)
function playerInAlley(e, px, pz, cell) {
  const along = e.axis === 'x' ? px : pz;
  const crossP = e.axis === 'x' ? pz : px;
  return Math.abs(crossP - e.cross) < 0.5 * cell
    && along > e.min - 0.5 * cell && along < e.max + 0.5 * cell;
}

// --- Simulation ---------------------------------------------------------------

// Ein Simulationsschritt. player = { px, pz, yaw }. Lauerer schwingen und
// werden ausgeloest (Spieler im Gang + Lauer-Wand vor ihm), Purzler fallen,
// Jaeger laufen gangbunden auf die Spieler-Laengslage zu. Liefert Ereignisse
// [{ type: 'drop', enemy }] fuer Sound/Effekte.
export function enemiesStep(enemies, dt, opts) {
  const { cell, player } = opts;
  const events = [];
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  for (const e of enemies) {
    if (!e.alive) continue;
    const pAlong = e.axis === 'x' ? player.px : player.pz;
    const inAlley = playerInAlley(e, player.px, player.pz, cell);
    if (e.mode === 'lurk') {
      e.t += dt;
      placeLurker(e, cell);
      if (e.wait == null && inAlley) {
        // Lauer-Wand VOR dem Spieler (Blick-Halbebene laengs)?
        const f = e.axis === 'x' ? fx : fz;
        if (f * (e.wall - pAlong) > 0) e.wait = e.order * ENEMY.dropGap;
      }
      if (e.wait != null) {
        e.wait -= dt;
        if (e.wait <= 0) {
          e.mode = 'drop';
          e.dropT = 0;
          e.from = [e.x, e.z];
          events.push({ type: 'drop', enemy: e });
        }
      }
    } else if (e.mode === 'drop') {
      e.dropT = Math.min(1, e.dropT + dt / ENEMY.dropTime);
      const p = dropEase(e.dropT);
      e.x = e.from[0] + (e.to[0] - e.from[0]) * p;
      e.z = e.from[1] + (e.to[1] - e.from[1]) * p;
      if (e.dropT >= 1) {
        e.mode = 'hunt';
        e.target = e.axis === 'x' ? e.to[0] : e.to[1];
      }
    } else {
      if (inAlley) e.target = pAlong;
      const along = e.axis === 'x' ? e.x : e.z;
      const gap = e.target - along;
      const step = Math.min(Math.abs(gap), ENEMY.huntSpeed * cell * dt);
      const next = Math.min(e.max, Math.max(e.min, along + Math.sign(gap) * step));
      setPos(e, next, e.axis === 'x' ? e.z : e.x);
    }
  }
  return events;
}

// Purzel-Verlauf (0..1 -> 0..1): beschleunigt wie ein Fall.
function dropEase(t) {
  return t * t;
}

// Groesse/Hoehe/Taumel eines Tankers fuer die Zeichner (beide Engines).
// opts = { hover, crown, size } in den Einheiten des Aufrufers: hover =
// Schwebe-Hoehe der Rauten-Mitte im Gang, crown = Wandkronen-Hoehe, size =
// Halbhoehe der vollen Raute. Liefert { scale, y (Mitte), tumble (rad um die
// Quer-Achse des Gangs) } -- Lauerer SITZEN auf der Krone (Mitte = Krone +
// halbe verkleinerte Raute), Purzler fallen und ueberschlagen sich einmal.
export function enemyLift(e, opts) {
  const { hover, crown, size } = opts;
  if (e.mode === 'hunt') return { scale: 1, y: hover, tumble: 0 };
  // Sitz-Hoehe mit Puls-Reserve: auch die aufgeblaehte Raute taucht nie
  // in die Krone ein.
  const seatY = crown + ENEMY.lurkScale * size * (1 + ENEMY.pulseAmp);
  if (e.mode === 'lurk') return { scale: ENEMY.lurkScale, y: seatY, tumble: 0 };
  const p = dropEase(e.dropT);
  return {
    scale: ENEMY.lurkScale + (1 - ENEMY.lurkScale) * p,
    y: seatY + (hover - seatY) * p,
    tumble: 2 * Math.PI * p,
  };
}

// Feuern: jeder JAEGER loest mit fireRate (Wahrscheinlichkeit pro Sekunde)
// einen sirrenden Schuss in Spinner-Schuss-Form aus (world/spinners.js:
// t waechst von `wall` aus in Richtung dir, runLen bis zur Gang-Endwand) --
// NUR bei Spieler im Gang, die Blickrichtung ist egal (Ruecken-Schuesse
// erlaubt). player = { px, pz }. Neue Schuesse an `shots` angehaengt und
// zurueckgegeben; rng haelt es deterministisch testbar.
export function enemyFire(enemies, shots, dt, rng, player, cell) {
  const fired = [];
  for (const e of enemies) {
    if (!e.alive || e.mode !== 'hunt' || e.zapAt != null) continue; // gezappt: entschaerft
    if (!playerInAlley(e, player.px, player.pz, cell)) continue;
    const along = e.axis === 'x' ? e.x : e.z;
    const pAlong = e.axis === 'x' ? player.px : player.pz;
    const dir = Math.sign(pAlong - along);
    if (dir === 0) continue;
    if (rng() >= ENEMY.fireRate * dt) continue;
    const runLen = dir > 0 ? e.max + 0.5 * cell - along : along - (e.min - 0.5 * cell);
    const shot = {
      axis: e.axis, dir, wall: along, cross: e.cross, runLen,
      t: 0, prevT: 0, phase: rng() * 2 * Math.PI,
    };
    shots.push(shot);
    fired.push(shot);
  }
  return fired;
}

// Liefert den ersten lebenden JAEGER im Umkreis `radius` (Welt-Einheiten)
// um (x,z) -- oder null. Lauerer und Purzler sind unverwundbar und harmlos,
// gezappte Jaeger (Superzapper, zapAt) ebenso -- bis sie explodieren.
// Der Aufrufer waehlt den Radius (Spieler vs. Projektil).
export function enemyHit(enemies, x, z, radius) {
  for (const e of enemies) {
    if (!e.alive || e.mode !== 'hunt' || e.zapAt != null) continue;
    if (Math.hypot(e.x - x, e.z - z) < radius) return e;
  }
  return null;
}

// Rauten-Geometrie eines Feindes als Liniensegmente (lokale Flaechen-Welt):
// Doppel-Kontur (aussen + innen), pulsierend, als Billboard um die Hochachse
// zum Spieler gedreht. Die Segmente laufen durch dieselbe Hidden-Line-
// Pipeline wie die Waende (renderFaceOverlay) -- nur eben in Rot.
// opts = { cell, px, pz, height, crown? } (height = Schwebe-Hoehe der
// Rauten-Mitte im Gang, crown = Wandkronen-Hoehe fuer die Lauerer; ohne
// crown sitzen Lauerer auf Schwebehoehe -- 1980-Minimum).
export function enemySegments(enemy, time, opts) {
  const { cell, px, pz, height } = opts;
  const pulse = 1 + ENEMY.pulseAmp * Math.sin(2 * Math.PI * ENEMY.pulseFreq * time + enemy.phase);
  const lift = enemyLift(enemy, { hover: height, crown: opts.crown ?? height, size: ENEMY.size * cell });
  const s = ENEMY.size * cell * pulse * lift.scale;
  const w = 0.75 * s; // Rauten etwas schlanker als hoch
  const y = lift.y;
  // Querachse senkrecht zur Sichtlinie Spieler -> Feind (zylindrisches Billboard).
  const dx = enemy.x - px;
  const dz = enemy.z - pz;
  const d = Math.hypot(dx, dz);
  const ux = d > 1e-9 ? -dz / d : 1;
  const uz = d > 1e-9 ? dx / d : 0;
  const segs = [];
  for (const k of [1, 0.45]) { // Aussen- und Innen-Kontur
    const top = [enemy.x, y + s * k, enemy.z];
    const bot = [enemy.x, y - s * k, enemy.z];
    const left = [enemy.x - ux * w * k, y, enemy.z - uz * w * k];
    const right = [enemy.x + ux * w * k, y, enemy.z + uz * w * k];
    segs.push([top, right], [right, bot], [bot, left], [left, top]);
  }
  return segs;
}

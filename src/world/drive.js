// Fahrdynamik fuer die "Auto-Bewegung" (ab Level 6): der Spieler faehrt von
// selbst mit Reisegeschwindigkeit, gelenkt wird nur mit links/rechts. Beim
// Aufprall auf eine Wand federt er zurueck (Geschwindigkeit kehrt sich
// anteilig um und erholt sich dann wieder auf Reisetempo).
// Reine Berechnung, kein Canvas -> headless testbar.
//
// Laengen-Konvention wie ueberall: Weltkoordinaten; `unit` ist die Weltgroesse
// einer Achsen-Einheit der Metrik, `cell` die Gangbreite (Gameplay-Massstab).
// Geschwindigkeiten in DRIVE sind in Gangbreiten pro Sekunde.

import { OPEN } from './maze.js';
import { rectWalkable, cellAt } from './mazeWorld.js';
import { mazeMetric } from './metric.js';

export const DRIVE = {
  cruise: 1.5,     // Reisegeschwindigkeit (Gangbreiten/s)
  turn: 3.0,       // maximale Lenkrate (rad/s)
  steerRamp: 3.5,  // Lenk-RAMPE (1/s): die Gierrate beschleunigt von 0 auf voll
                   // in ~0.3 s statt sofort maximal zu sein (und ebenso zurueck)
  accel: 2.0,      // Beschleunigungs-Rampe (Gangbreiten/s^2): Anfahren nach dem
                   // Reinfallen und Erholung nach dem Abprall
  brake: 4.0,      // Brems-Rampe (Gangbreiten/s^2): Q -> kurz abbremsen
  bounce: 0.6,     // Rueckstoss beim Aufprall, Anteil der REISEgeschwindigkeit
  minImpact: 0.3,  // Mindest-Aufprallstaerke fuer Abprall/Effekte (sonst Gleiten)
  cooldown: 0.3,   // s Sperrzeit zwischen zwei Abprall-Ereignissen
};

export function createDriveState() {
  return { vel: 0, steer: 0, cooldown: 0 };
}

// Bewegt `value` ratenbegrenzt auf `target` zu (lineare Rampe).
function rampToward(value, target, rate, dt) {
  const dv = target - value;
  const step = rate * dt;
  return Math.abs(dv) <= step ? target : value + Math.sign(dv) * step;
}

function isOpenCell(maze, x, y) {
  return x >= 0 && x < maze.n && y >= 0 && y < maze.n && maze.grid[y][x] === OPEN;
}

// Ein Simulationsschritt. pose = {px,pz,yaw}, turn in [-1,1] (links positiv,
// gleiche Konvention wie die Tank-Steuerung). opts = { unit, cell, radius,
// targetSpeed? } -- targetSpeed (Gangbreiten/s, Standard cruise) erlaubt das
// Abbremsen vor dem Abheben (Q): 0 uebergeben, bis vel 0 erreicht.
// Liefert { px, pz, yaw, collision }; collision ist null oder
// { axis:'x'|'z', side:+1|-1, plane, wallCell:[gx,gy], point:[lx,lz], impact }
// mit plane = Welt-Koordinate der getroffenen Wandebene und impact in 0..1
// (Anteil der Reisegeschwindigkeit senkrecht in die Wand).
export function driveStep(maze, state, pose, turn, dt, opts) {
  const { unit, cell, radius } = opts;
  const params = { ...DRIVE, ...(opts.params ?? {}) };

  state.cooldown = Math.max(0, state.cooldown - dt);

  // Lenk-Rampe: die Gierrate faehrt von 0 hoch (und wieder herunter) statt
  // beim Tastendruck sofort maximal zu sein.
  const turnTarget = Math.max(-1, Math.min(1, turn));
  state.steer = rampToward(state.steer, turnTarget, params.steerRamp, dt);
  const yaw = pose.yaw + state.steer * params.turn * dt;

  // Tempo-Rampe: konstante Beschleunigung Richtung Zieltempo (Anfahren nach
  // dem Reinfallen, Erholung nach dem Abprall); bergab -- z.B. Bremsen vor dem
  // Abheben -- mit der staerkeren Brems-Rampe.
  const target = opts.targetSpeed ?? params.cruise;
  const rate = target < state.vel ? params.brake : params.accel;
  state.vel = rampToward(state.vel, target, rate, dt);

  const speed = state.vel * cell;
  const dx = -Math.sin(yaw) * speed * dt;
  const dz = -Math.cos(yaw) * speed * dt;

  // Achsweise bewegen wie tryMove (ganzes Spieler-Quadrat via rectWalkable,
  // Gleiten an Waenden), aber mit Buchfuehrung, WELCHE Achse blockiert hat.
  let nx = pose.px;
  let nz = pose.pz;
  let blockedX = false;
  let blockedZ = false;
  if (dx !== 0) {
    const cx = pose.px + dx;
    if (rectWalkable(maze, cx - radius, cx + radius, pose.pz - radius, pose.pz + radius, unit)) nx = cx;
    else blockedX = true;
  }
  if (dz !== 0) {
    const cz = pose.pz + dz;
    if (rectWalkable(maze, nx - radius, nx + radius, cz - radius, cz + radius, unit)) nz = cz;
    else blockedZ = true;
  }

  let collision = null;
  if ((blockedX || blockedZ) && state.cooldown <= 0 && state.vel > 0) {
    // Staerkere der blockierten Komponenten bestimmt Achse und Wucht.
    const axis = blockedX && (!blockedZ || Math.abs(dx) >= Math.abs(dz)) ? 'x' : 'z';
    const comp = axis === 'x' ? dx : dz;
    const impact = Math.min(1, Math.abs(comp) / dt / (params.cruise * cell));
    if (impact >= params.minImpact) {
      collision = collisionInfo(maze, axis, dx, dz, nx, nz, impact, unit, radius);
      // Entschiedener Rueckstoss relativ zur REISEgeschwindigkeit -- NICHT zur
      // Restgeschwindigkeit: sonst wird der Rueckstoss bei wiederholtem Anliegen
      // immer schwaecher und der Spieler "zittert" an der Wand (Treffer im
      // Cooldown-Takt knapp ueber der Schwelle statt sauberem Abprallen).
      state.vel = -params.bounce * params.cruise;
      state.cooldown = params.cooldown;
    }
  }

  return { px: nx, pz: nz, yaw, collision };
}

// Baut die Kollisions-Beschreibung: getroffene Wandebene, Wandzelle, Auftreffpunkt.
// Der Auftreffpunkt ist der Schnitt der SICHTLINIE (= Fahrtrichtung) mit der
// Wandebene, vom Standort nach dem Schritt aus: frontal liegt er damit exakt in
// der Bildmitte, bei schraegem Aufprall genau da, wo man hinschaut -- nicht am
// Lotpunkt seitlich versetzt.
function collisionInfo(maze, axis, dx, dz, nx, nz, impact, unit, radius) {
  const { toUnits, toGrid } = mazeMetric(maze);
  const cellOf = (w) => Math.floor(toGrid(w / unit));
  const [pgx, pgy] = cellAt(maze, nx, nz, unit);

  if (axis === 'x') {
    const side = Math.sign(dx);
    const wallX = pgx + side;
    const plane = toUnits(side > 0 ? pgx + 1 : pgx) * unit;
    const pz = nz + (dz / dx) * (plane - nx); // Sichtlinie trifft die Wandebene
    // Welche Zeile blockiert? Sichtpunkt zuerst, dann Mitte und die Ecken.
    const rows = [pz, nz, nz - radius, nz + radius].map(cellOf);
    const wallY = rows.find((r) => !isOpenCell(maze, wallX, r)) ?? pgy;
    return { axis, side, plane, wallCell: [wallX, wallY], point: [plane, pz], impact };
  }
  const side = Math.sign(dz);
  const wallY = pgy + side;
  const plane = toUnits(side > 0 ? pgy + 1 : pgy) * unit;
  const px = nx + (dx / dz) * (plane - nz); // Sichtlinie trifft die Wandebene
  const cols = [px, nx, nx - radius, nx + radius].map(cellOf);
  const wallX = cols.find((c) => !isOpenCell(maze, c, wallY)) ?? pgx;
  return { axis, side, plane, wallCell: [wallX, wallY], point: [px, plane], impact };
}

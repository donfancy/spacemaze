// Geh-Kinetik fuer die Tank-Steuerung (Level 1-5): vor/zurueck + drehen, aber
// mit RAMPEN wie im Fahr-Modus -- das Tempo faehrt mit konstanter
// Beschleunigung hoch (Anfahren) und mit der staerkeren Brems-Rampe herunter
// (Loslassen/Gegensteuern), die Drehrate ebenso (Lenk-Rampe). Zusaetzlich wird
// gemeldet, wenn man gegen eine Wand laeuft (fuer den Bump-Sound) -- als
// FLANKE: ein Ereignis beim Auftreffen, kein Dauerfeuer beim Anliegen.
// Reine Berechnung, kein Canvas/Audio -> headless testbar.
//
// Laengen-Konvention wie in drive.js: Weltkoordinaten; `unit` ist die
// Weltgroesse einer Achsen-Einheit, `cell` die Gangbreite (Gameplay-Massstab).
// Geschwindigkeiten in WALK sind in Gangbreiten pro Sekunde.

import { rectWalkable } from './mazeWorld.js';
import { rampToward } from './drive.js';

export const WALK = {
  speed: 2.2,      // Gehtempo (Gangbreiten/s, vorher MOVE_RATIO)
  turn: 2.2,       // Drehrate (rad/s, vorher TURN_SPEED)
  accel: 6.0,      // Anfahr-Rampe (Gangbreiten/s^2): volles Tempo in ~0.37 s
  brake: 9.0,      // Brems-Rampe (Loslassen/Gegensteuern): steht in ~0.24 s
  steerRamp: 8.0,  // Lenk-Rampe (1/s): volle Drehrate in ~0.25 s
  minImpact: 0.3,  // Mindest-Aufprallwucht fuer die Kollisions-Meldung (sonst Streifen)
};

export function createWalkState() {
  // contact: pro Achse "liegt gerade an einer Wand an" -- fuer die Flanken-
  // Erkennung der Kollisions-Meldung.
  return { vel: 0, steer: 0, contact: { x: false, z: false } };
}

// Ein Simulationsschritt. pose = {px,pz,yaw}, input = { move, turn } jeweils
// in [-1,1] (move vorwaerts positiv, turn links positiv wie ueberall).
// opts = { unit, cell, radius, params? }.
// Liefert { px, pz, yaw, collision, speed }:
//   collision -- null oder { axis:'x'|'z', side:+1|-1, impact } (impact 0..1,
//     Anteil des Gehtempos senkrecht in die Wand), nur beim AUFTREFFEN.
//   speed -- tatsaechlich erreichtes Tempo (Gangbreiten/s), fuer das
//     Fahrgeraeusch: an der Wand angedrueckt ist es 0, beim Gleiten anteilig.
export function walkStep(maze, state, pose, input, dt, opts) {
  const { unit, cell, radius } = opts;
  const params = { ...WALK, ...(opts.params ?? {}) };

  // Lenk-Rampe: Drehrate faehrt von 0 hoch und wieder herunter.
  const turnTarget = Math.max(-1, Math.min(1, input.turn ?? 0));
  state.steer = rampToward(state.steer, turnTarget, params.steerRamp, dt);
  const yaw = pose.yaw + state.steer * params.turn * dt;

  // Tempo-Rampe: Beschleunigen Richtung Wunschtempo; wird das Tempo kleiner
  // (Loslassen) oder kehrt es um (Gegensteuern), bremst die staerkere Rampe.
  const target = Math.max(-1, Math.min(1, input.move ?? 0)) * params.speed;
  const slowing = target * state.vel < 0 || Math.abs(target) < Math.abs(state.vel);
  state.vel = rampToward(state.vel, target, slowing ? params.brake : params.accel, dt);

  // vel ist das ANGESTREBTE Tempo entlang der Blickrichtung -- Waende
  // blockieren die Bewegung achsweise (klassisches Gleiten), aendern das
  // Tempo aber nicht: sonst kollabiert das Gleiten Schritt fuer Schritt.
  const dx = -Math.sin(yaw) * state.vel * cell * dt;
  const dz = -Math.cos(yaw) * state.vel * cell * dt;

  // Achsweise bewegen wie tryMove (ganzes Spieler-Quadrat), mit Buchfuehrung,
  // welche Achse blockiert hat.
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

  // Kollisions-Meldung nur an der FLANKE (frisch aufgetroffen): solange man
  // angedrueckt bleibt, haelt `contact` die Achse still. Bei einem Eck-Treffer
  // (beide Achsen im selben Schritt) zaehlt die staerkere Komponente.
  let collision = null;
  if (blockedX || blockedZ) {
    const axis = blockedX && (!blockedZ || Math.abs(dx) >= Math.abs(dz)) ? 'x' : 'z';
    const fresh = !state.contact[axis];
    if (fresh && dt > 0) {
      const comp = axis === 'x' ? dx : dz;
      const impact = Math.min(1, Math.abs(comp) / dt / (params.speed * cell));
      if (impact >= params.minImpact) {
        collision = { axis, side: Math.sign(comp), impact };
      }
    }
  }
  state.contact.x = blockedX;
  state.contact.z = blockedZ;

  const speed = dt > 0 ? Math.hypot(nx - pose.px, nz - pose.pz) / (cell * dt) : 0;
  return { px: nx, pz: nz, yaw, collision, speed };
}

// Schiessen (ab Level 11), Tempest-Regel: die Feuertaste darf gehalten
// werden, aber es sind nie mehr als `max` Projektile gleichzeitig unterwegs.
// Projektile fliegen geradeaus in der ZIELRICHTUNG zum Abschusszeitpunkt
// (Blickrichtung + Lenk-Ausschlag) und "verpuffen" an der ersten Wand.
// Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// Zielrichtung/Fadenkreuz: beim Lenken schlaegt das Fadenkreuz um `deflect`
// (bei vollem Lenk-Ausschlag) weiter aus als die Flugbahn -- `steer` ist die
// GERAMPTE Lenkgroesse aus drive.js/walk.js, dadurch schwingt das Fadenkreuz
// gratis genauso weich wie die Lenkung selbst.

import { isWalkable } from './mazeWorld.js';
import { enemyHit } from './enemies.js';

export const SHOTS = {
  max: 8,        // maximal gleichzeitig unterwegs (Tempest)
  rate: 5,       // Schuesse/s bei Dauerfeuer
  speed: 8,      // Flugtempo (Gangbreiten/s)
  life: 4,       // s Sicherheits-Lebensdauer (falls nie eine Wand kommt)
  deflect: 0.35, // rad: Fadenkreuz-/Ziel-Ausschlag bei vollem Lenkeinschlag
  spin: 10,      // rad/s: Rotation des Projektil-Sterns
  size: 0.08,    // Stern-Halbgroesse (Gangbreiten)
  substep: 0.1,  // maximale Substep-Weite (Gangbreiten): schmale Waende
                 // (1 Einheit = 0.2 Gangbreiten) duerfen nicht uebersprungen werden
};

export function createShotsState() {
  return { shots: [], cooldown: 0, fired: 0 };
}

// Zielrichtung aus Blickrichtung + Lenk-Ausschlag (steer in [-1,1], links
// positiv wie ueberall): Lenken links -> Fadenkreuz schlaegt nach links aus.
export function aimYaw(yaw, steer, params = SHOTS) {
  return yaw + steer * params.deflect;
}

// Feuert ein Projektil, wenn Feuerrate und Tempest-Limit es erlauben.
// pose = {px,pz,yaw}; steer wie bei aimYaw. Liefert true, wenn geschossen wurde.
export function fireShot(state, pose, steer, opts = {}) {
  const params = { ...SHOTS, ...(opts.params ?? {}) };
  if (state.cooldown > 0 || state.shots.length >= params.max) return false;
  const a = aimYaw(pose.yaw, steer, params);
  state.fired++;
  state.shots.push({
    x: pose.px, z: pose.pz,
    dx: -Math.sin(a), dz: -Math.cos(a), // Einheitsrichtung (Konvention wie forward)
    age: 0,
    phase: state.fired * 2.4, // jeder Stern rotiert individuell versetzt
  });
  state.cooldown = 1 / params.rate;
  return true;
}

// Ein Simulationsschritt: Projektile fliegen, verpuffen an Waenden, treffen
// Feinde (markiert sie tot). opts = { unit, cell, enemies?, enemyRadius?,
// hitTest?, params? }. `hitTest(x, z)` erlaubt weitere Ziele (z.B. Spinner/
// Spikes): liefert es ein Ereignis-Objekt, stirbt der Schuss und das Ereignis
// wird durchgereicht. Liefert Ereignisse [{ type: 'wall'|'enemy'|..., x, z }]
// fuer Effekte/Sound.
export function shotsStep(maze, state, dt, opts) {
  const { unit, cell, enemies = [], enemyRadius = 0, hitTest = null } = opts;
  const params = { ...SHOTS, ...(opts.params ?? {}) };
  state.cooldown = Math.max(0, state.cooldown - dt);

  const events = [];
  const alive = [];
  for (const shot of state.shots) {
    shot.age += dt;
    if (shot.age > params.life) continue; // still verglueht
    // Substeps gegen Tunneln: kein Schritt weiter als `substep` Gangbreiten.
    const dist = params.speed * cell * dt;
    const steps = Math.max(1, Math.ceil(dist / (params.substep * cell)));
    const d = dist / steps;
    let dead = false;
    for (let i = 0; i < steps; i++) {
      const nx = shot.x + shot.dx * d;
      const nz = shot.z + shot.dz * d;
      const hit = enemies.length ? enemyHit(enemies, nx, nz, enemyRadius) : null;
      if (hit) {
        hit.alive = false; // weg ist weg
        events.push({ type: 'enemy', x: hit.x, z: hit.z, enemy: hit });
        dead = true;
        break;
      }
      const custom = hitTest ? hitTest(nx, nz) : null;
      if (custom) {
        events.push(custom);
        dead = true;
        break;
      }
      if (!isWalkable(maze, nx, nz, unit)) {
        // Verpuffen AN der Wand: an der letzten offenen Position.
        events.push({ type: 'wall', x: shot.x, z: shot.z });
        dead = true;
        break;
      }
      shot.x = nx;
      shot.z = nz;
    }
    if (!dead) alive.push(shot);
  }
  state.shots = alive;
  return events;
}

// Projektil-Geometrie: weisser rotierender Stern (*) aus drei Linien durch
// den Mittelpunkt, als Billboard in der Bildebene des Spielers (Ebene aus
// lokaler Rechts-Richtung der Blickrichtung + Hochachse -- Projektile fliegen
// fast immer nahe der Blickachse, der Restfehler ist unsichtbar).
// opts = { cell, yaw, height, time }.
export function shotSegments(shot, time, opts) {
  const { cell, yaw, height } = opts;
  const s = SHOTS.size * cell;
  const rx = Math.cos(yaw); // lokale Rechts-Richtung (xz) zur Blickrichtung yaw
  const rz = -Math.sin(yaw);
  const spin = SHOTS.spin * time + shot.phase;
  const segs = [];
  for (let k = 0; k < 3; k++) {
    const a = spin + (k * Math.PI) / 3;
    const ox = Math.cos(a) * rx * s;
    const oy = Math.sin(a) * s;
    const oz = Math.cos(a) * rz * s;
    segs.push([
      [shot.x - ox, height - oy, shot.z - oz],
      [shot.x + ox, height + oy, shot.z + oz],
    ]);
  }
  return segs;
}

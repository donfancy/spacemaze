// SUPERZAPPER (Sturm-Branch, Boris' Tempest-Hommage, 3.9.2026): EIN Mal pro
// Leben (= pro Anlauf; Retry laedt neu, Resume von der Karte behaelt den
// Verbrauch) zerstoert er alle AKTIVEN Feinde im Sichtfeld -- jagende
// Tanker, Flipper in jeder Stellung, Spinner-Koerper -- und loescht alle
// Feind-Schuesse sofort. NICHT: lauernde Tanker auf den Kronen, die Spikes
// (bleiben stehen), Pulsare (unzerstoerbar). Sichtfeld = Blickkegel der
// Kamera (halbes fov) + freie Sichtlinie (hasLineOfSight), ohne
// Distanzgrenze. Die Feinde explodieren VON NAH NACH FERN mit kleinem
// Versatz (sieht toller aus, Boris): sie sind ab dem Zap sofort entschaerft
// und unverwundbar (`zapAt` -- die Treffer-/Feuer-Funktionen der Feind-
// Module ueberspringen gezappte Feinde) und sterben, wenn ihre Zeit kommt.
// Reine Daten + Berechnung, kein Canvas -> headless testbar.

import { hasLineOfSight } from './mazeWorld.js';
import { spinnerPos } from './spinners.js';
import { flipperPos } from './flippers.js';

export const ZAPPER = {
  cone: Math.PI / 4.8, // rad: halber Sichtkegel (= halbes Kamera-fov von 75 Grad)
  stagger: 0.08,       // s: Versatz der Explosionen von nah nach fern
  flash: 0.35,         // s: weisser Blitz
};

// Ist der Feind schon gezappt (entschaerft, wartet auf seine Explosion)?
export function zapped(f) {
  return f.zapAt != null;
}

// Ziele im Sichtfeld, nah -> fern: [{ kind, foe, x, z, dist }]. pose =
// { px, pz, yaw }, foes = { enemies, spinners, flippers } (die game-Listen),
// opts = { unit }.
export function zapTargets(maze, pose, foes, opts) {
  const { unit } = opts;
  const fx = -Math.sin(pose.yaw);
  const fz = -Math.cos(pose.yaw);
  const out = [];
  const consider = (kind, foe, x, z) => {
    if (zapped(foe)) return;
    const dx = x - pose.px;
    const dz = z - pose.pz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-9) {
      const cos = Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d));
      if (Math.acos(cos) > ZAPPER.cone) return;
    }
    if (!hasLineOfSight(maze, pose.px, pose.pz, x, z, unit)) return;
    out.push({ kind, foe, x, z, dist: d });
  };
  for (const e of foes.enemies ?? []) {
    if (e.alive && e.mode === 'hunt') consider('enemy', e, e.x, e.z);
  }
  for (const s of foes.spinners ?? []) {
    if (!s.alive) continue;
    const [x, z] = spinnerPos(s);
    consider('spinner', s, x, z);
  }
  for (const f of foes.flippers ?? []) {
    if (!f.alive) continue;
    const [x, z] = flipperPos(f);
    consider('flipper', f, x, z);
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

// Zap starten: jedes Ziel bekommt seinen Explosions-Zeitpunkt (nah zuerst)
// und ist ab jetzt entschaerft. Liefert die Warteschlange [{ ...ziel, at }].
export function startZap(targets, now) {
  return targets.map((t, i) => {
    t.foe.zapAt = now + i * ZAPPER.stagger;
    return { ...t, at: t.foe.zapAt };
  });
}

// Faellige Explosionen (at <= now) aus der Warteschlange holen -- diese
// Feinde sterben JETZT (alive = false). Kompaktiert `queue` in place.
export function zapStep(queue, now) {
  const due = [];
  let w = 0;
  for (const item of queue) {
    if (item.at <= now) {
      item.foe.alive = false;
      due.push(item);
    } else {
      queue[w++] = item;
    }
  }
  queue.length = w;
  return due;
}

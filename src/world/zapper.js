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
  flash: 0.35,         // s: weisser Vollbild-Blitz
  lines: 0.9,          // s: weisses DURCHFLIMMERN der Kanten-Linien (Tempest-Superzapper)
  flickerHz: 30,       // Flimmer-Takt der Linien (harte Wechsel, kein Blenden)
  blast: 0.12,         // s: am Anfang stehen die Linien durchgehend weiss
};

// TASTEN (13.9.2026, Boris: "wenn es hektisch wird, verfehle ich die Taste"):
// die ganze untere Buchstabenreihe zappt -- Y X C V B N M (deutsch) bzw.
// Z X C V B N M (US), damit passen fast alle Layouts. AUSGENOMMEN X (= Exit,
// Tasten-Stringenz) und M (= globaler Stumm-Schalter in main.js, faellt nie
// ins Spiel durch). Info-Seite und Steuer-Zeile nennen weiter nur Z / Y.
export const ZAP_KEYS = new Set(['Z', 'Y', 'C', 'V', 'B', 'N']);

export function isZapKey(key) {
  return ZAP_KEYS.has(key);
}

// Ist eine Zap-Taste gehalten (game.keys bzw. Autopilot-Tasten)?
export function hasZapKey(keys) {
  for (const k of ZAP_KEYS) if (keys.has(k)) return true;
  return false;
}

// Weisser Vollbild-Blitz: Deckkraft-Anteil 0..1 zur Zeit t seit dem Zap
// (quadratisch ausklingend, 0 ausserhalb des Fensters -- die Zeichner
// multiplizieren ihre Engine-Amplitude drauf).
export function zapFlash(t) {
  if (!(t >= 0) || t >= ZAPPER.flash) return 0;
  return (1 - t / ZAPPER.flash) ** 2;
}

// Weiss-Anteil der KANTEN-LINIEN zur Zeit t seit dem Zap (0..1): erst
// `blast` lang durchgehend weiss, dann flimmert es mit flickerHz hart
// zwischen voll und fast aus (LCG-Hash des Frame-Index: deterministisch,
// beide Engines und das Replay flimmern identisch), unter einer linear
// ausklingenden Huelle bis `lines`. 0 ausserhalb des Fensters.
export function zapLineMix(t) {
  if (!(t >= 0) || t >= ZAPPER.lines) return 0;
  const env = 1 - t / ZAPPER.lines;
  if (t < ZAPPER.blast) return env;
  const frame = Math.floor(t * ZAPPER.flickerHz);
  const h = (Math.imul(frame, 1103515245) + 12345 >>> 0) / 4294967296;
  return env * (h < 0.55 ? 1 : 0.2);
}

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

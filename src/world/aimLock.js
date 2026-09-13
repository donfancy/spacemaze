// ZIEL-AUTOMATIK gegen Flipper (Boris' Spec, 13.9.2026 -- "leichter"): wer
// im Fahrt-Modus KURZ auf links oder rechts tippt, waehrend auf dieser
// Seite ein seitlich eingerasteter Flipper steht, wird automatisch auf ihn
// AUSGERICHTET -- die Lenkung fuehrt das Fadenkreuz (aimYaw = yaw +
// steer*deflect) auf seinen Seiten-Trefferpunkt und haelt es dort, bis er
// abgeschossen ist oder wegklappt. Feuern bleibt Handarbeit (Space).
// Reine Berechnung, kein Canvas -> headless testbar; die Szene (playing.js)
// haelt den Lock-Zustand und ruft pro Frame aimTurn.
//
// NUR "ZENTRIERT IM GANG" (Boris' Spec-Wortlaut; 13.9.2026 nachgeschaerft,
// weil die Automatik das normale Kurvenlenken kaperte: jeder Lenk-Druck
// mit irgendeinem Seiten-Flipper voraus war ein "Tipp" -- "ich uebersteuere
// an jeder Ecke"): ein Tipp zielt nur, wenn der Blick nahe am Gang-Kurs
// liegt (straight), das Schiff nahe der Gangmitte fliegt (centered) und
// der Lenkausschlag ruht (steerMax) -- mitten in einer Kurve oder beim
// Zurechtruecken greift nichts. Und nur als EINZELNER Tipp: ein Druck kurz
// nach dem vorigen ist Puls-Lenken (pulseGap), kein Zielbefehl. Jeder
// Lenk-Druck beendet einen laufenden Lock samt Nachrichten sofort (der
// Spieler uebernimmt) -- die Szene setzt das um (playing.js, steerTap).
//
// Wie der Ausricht-Assistent (world/align.js) liefert die Automatik NUR
// eine Lenk-Eingabe in [-1,1] durch die normale Lenk-Rampe: sie kann
// nichts, was der Spieler (oder der Autopilot im Duell) nicht auch koennte
// -- der Sollwert ist exakt der des Autopilot-Duells (autopilot.js,
// flipperDuel): steer = Winkelfehler / deflect. Folge der Physik: wer
// seitlich zielt, dreht das Schiff mit -- nach dem Abschuss zeigt es ein
// paar Grad zur Wand. Darum RECOVER: nach dem Ende des Zielens richtet die
// Automatik kurz per Ausricht-Assistent wieder gerade (die Szene rechnet
// ihn, weil er das Maze braucht), bis der Kurs stimmt oder recoverMax
// verstrichen ist. Gehaltene Lenktasten gewinnen jederzeit.

import { flipperAimPoint } from './flippers.js';
import { SHOTS } from './shots.js';
import { shortestRoll } from './gyro.js';

export const AIM_LOCK = {
  maxDist: 7,       // Gangbreiten: nur so nahe Flipper sind ein Ziel (Sichtweite des Duells)
  reach: 2,         // Vielfaches von SHOTS.deflect: liegt der Trefferpunkt weiter
                    // seitlich, erreicht ihn das Fadenkreuz nicht -> kein Ziel
  straight: 0.2,    // rad: so nah am Gang-Kurs muss der Blick beim Tipp liegen ("zentriert")
  centered: 0.25,   // Gangbreiten: so nah an der Gangmitte muss das Schiff beim Tipp sein
  steerMax: 0.15,   // Lenkausschlag (steer) darunter gilt als "nicht am Lenken"
  pulseGap: 0.4,    // s: ein Lenk-Druck so kurz nach dem vorigen ist Puls-Lenken, kein Tipp
  tapHold: 0.25,    // s: laenger gehaltene Lenktaste = Handarbeit, loest die Automatik
  recover: true,    // nach dem Zielen wieder gerade richten (Ausricht-Assistent)
  recoverMax: 1.2,  // s: laengstens so lange richtet die Automatik nach
  recoverDone: 0.15, // Ausricht-Eingabe (Betrag), ab der der Kurs als gerade gilt
};

// Ziel eines Tipps: der NAECHSTE lebende, seitlich eingerastete Flipper im
// eigenen Gang voraus, dessen Trefferpunkt auf der getippten Seite liegt --
// dir = +1 links / -1 rechts (Lenk-Konvention: yaw waechst nach links).
// pose = {px,pz,yaw, steer?} (steer = gerampter Lenkausschlag, 0 ohne
// Angabe). Nur "zentriert im Gang": Blick nahe am Gang-Kurs, Schiff nahe
// der Gangmitte, Lenkung in Ruhe -- sonst null, ebenso ohne Flipper
// (normale Lenkung).
export function aimTarget(pose, flippers, dir, cell) {
  if (Math.abs(pose.steer ?? 0) >= AIM_LOCK.steerMax) return null; // mitten im Lenken
  let best = null;
  let bestDist = Infinity;
  for (const f of flippers ?? []) {
    const a = aimAngles(pose, f, cell);
    if (!a || a.dist >= bestDist) continue;
    if (Math.sign(a.off) !== Math.sign(dir)) continue; // andere Seite
    if (!inLane(pose, f, cell)) continue;               // nicht zentriert im Gang
    best = f;
    bestDist = a.dist;
  }
  return best;
}

// "Zentriert im Gang" gegenueber dem Gang des Flippers: Kurs innerhalb
// `straight` der Gang-Achse (in Richtung Flipper) und Lage innerhalb
// `centered` der Gangmitte.
function inLane(pose, f, cell) {
  const crossP = f.axis === 'x' ? pose.pz : pose.px;
  if (Math.abs(crossP - f.cross) >= AIM_LOCK.centered * cell) return false;
  const pAlong = f.axis === 'x' ? pose.px : pose.pz;
  const sgn = Math.sign(f.along - pAlong) || 1;
  // Gang-Kurs als yaw (forward = (-sin yaw, -cos yaw) soll auf die Achse zeigen).
  const axisYaw = f.axis === 'x' ? Math.atan2(-sgn, 0) : Math.atan2(0, -sgn);
  return Math.abs(shortestRoll(pose.yaw - axisYaw)) < AIM_LOCK.straight;
}

// Lenk-Eingabe der Automatik fuer den gelockten Flipper: der Sollwert des
// gerampten steer, der das Fadenkreuz auf seinen Seiten-Trefferpunkt legt --
// oder null, wenn das Ziel weg ist (tot, gezappt, geklappt, hinter mir,
// fremder Gang, zu weit, ausserhalb des Ausschlags): dann endet der Lock.
export function aimTurn(pose, flipper, cell) {
  const a = aimAngles(pose, flipper, cell);
  return a ? Math.max(-1, Math.min(1, a.off / SHOTS.deflect)) : null;
}

// Geometrie Spieler -> Seiten-Trefferpunkt: { dist, off } (off = Winkel-
// fehler Ziel minus Blick, links positiv) oder null, wenn der Flipper kein
// gueltiges Ziel ist.
function aimAngles(pose, f, cell) {
  if (!f || !f.alive || f.zapAt != null) return null;
  const crossP = f.axis === 'x' ? pose.pz : pose.px;
  if (Math.abs(crossP - f.cross) >= 0.5 * cell) return null; // fremder Gang
  const pt = flipperAimPoint(f, cell);
  if (!pt) return null; // unten/oben/im Flip: kein Seitenpunkt
  const dx = pt[0] - pose.px;
  const dz = pt[1] - pose.pz;
  if (dx * -Math.sin(pose.yaw) + dz * -Math.cos(pose.yaw) <= 0) return null; // hinter mir
  const dist = Math.hypot(dx, dz);
  if (dist > AIM_LOCK.maxDist * cell) return null;
  const off = shortestRoll(Math.atan2(-dx, -dz) - pose.yaw);
  if (Math.abs(off) >= AIM_LOCK.reach * SHOTS.deflect) return null; // zu quer
  return { dist, off };
}

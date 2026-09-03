// AUTOPILOT fuer den Animate-/Attract-Mode: faehrt den Loesungsweg des
// Labyrinths ab und erzeugt dafuer pro Frame eine TASTEN-Menge -- exakt die
// Namen, die playing.js aus game.keys liest (Pfeiltasten, Space).
// So laeuft die Demo durch die UNVERAENDERTE Spiel-Logik (walk/drive,
// Schiessen, Feinde, Crash): kein zweiter Bewegungs-Code, nichts driftet.
// Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// Verfolgungs-Idee (pure pursuit): Ziel ist der erste Loesungsweg-Punkt
// mindestens `lookahead` Gangbreiten voraus; gelenkt wird auf den Winkel
// dorthin. Im Fahrt-Modus lenkt der Autopilot aber nur noch echte KURVEN
// selbst (|dyaw| > driveSteer) -- auf der Geraden haelt der Ausricht-
// Assistent (logisch Pfeil runter, world/align.js) die Spur: kein
// Schlingerkurs von Wand zu Wand mehr. Wie ein Profi feuert er NUR, wenn
// wirklich ein Feind in Sicht ist (foeInSight: Distanz + Blickkegel), und
// BOOSTET (logisch Pfeil hoch) auf freien langen Geraden. Stirbt er im
// Kampf trotzdem, ist das arcade-authentisch: die Demo endet im GAME OVER
// und die naechste beginnt.
//
// Blick-Verdrehung (Pulsar-Gyro, ab 26): der Autopilot will WELT-links/
// rechts bzw. logisch Boost/Ausrichten -- die Pfeiltaste dafuer liefert
// die Inverse des gyroTurn-/gyroDirs-Mappings (gleiche Quelle
// world/gyro.js, kein zweites Vorzeichen-Wissen).
//
// FLIPPER-DUELL (31.8.2026): die toedliche Flipper-Ebene versperrt den Gang,
// abschiessbar ist das X nur seitlich eingerastet -- und der Trefferpunkt
// sitzt (0.5 - lift) Gangbreiten NEBEN der Gangmitte: der brave
// Gangmitte-Geradeaus-Schuss verfehlt ihn IMMER knapp (shotRadius 0.3).
// Der Autopilot zielt deshalb wie ein Mensch mit dem Fadenkreuz-
// Lenkausschlag (aimYaw = yaw + steer*deflect) auf den Seitenpunkt:
// flipperDuel liefert den noetigen Lenk-Zustand, die Tasten pulsen den
// gerampten steer der Fahrt (mode.steer) dorthin (Bang-Bang), gefeuert
// wird erst, wenn das Fadenkreuz den Trefferpunkt im Radius hat. Steht
// das X unten/oben oder klappt es gerade, ist es untreffbar: dann faehrt
// er normal weiter (die Seiten-Stellung haelt am laengsten, die naechste
// kommt schnell), aber ohne Boost und ohne sinnloses Feuer.
//
// TANK-KURVENGEFUEHL (31.8.2026): in der Blockwelt zog der Vorausblick
// schon ~0.9 Gangbreiten VOR der Kurvenkammer auf den Quergang-Wegpunkt --
// die Diagonale dorthin laeuft praktisch exakt ueber die Innenecke (Bump
// an jeder Kurve). Jetzt klemmt der Vorausblick im Tank-Modus an
// KNICK-Wegpunkten (isTurnPoint), aufgerueckt wird dort erst dicht an der
// Kammermitte (turnAdvance), und losgefahren erst fast ausgerichtet
// (walkAlign enger): reinfahren, auf der Stelle drehen, sauber raus --
// klassisches Tank-Manoever, keine Ecken-Bumps.

import { findPath } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { gyroTurn, gyroDirs } from './gyro.js';
import { FLIPPER, flipperSide, flipperPos, flipperDiagonal } from './flippers.js';
import { SHOTS } from './shots.js';

export const AUTOPILOT = {
  lookahead: 0.9,   // Gangbreiten: Vorausblick der Verfolgung
  advance: 0.55,    // Gangbreiten: naeher dran -> naechster Wegpunkt
  doneRadius: 0.2,  // Gangbreiten: erst SO nah an der Zielmitte ist Schluss
                    // (die Ziel-Zone verlangt 0.25 Feldgroesse "drinnen")
  turnDead: 0.06,   // rad: darunter wird nicht gelenkt (kein Zappeln)
  walkAlign: 0.35,  // rad: erst drehen, ab hier auch vorwaerts (Tank-Modus) --
                    // eng genug, dass der Anlauf aus der Kurvenkammer die
                    // Innenecke verfehlt (0.6 lief fast genau darueber)
  turnAdvance: 0.25,// Gangbreiten: KNICK-Wegpunkte gibt der Tank-Modus erst
                    // so dicht an der Kammermitte auf (advance 0.55 liess ihn
                    // die Kurve diagonal anschneiden -> Bump an der Innenecke)
  driveSteer: 0.35, // rad: ab hier lenkt der Autopilot im Fahrt-Modus selbst
                    // (Kurven) -- darunter uebernimmt der Ausricht-Assistent
  zapCount: 3,      // ab so vielen Feinden im Sichtfeld zuendet die Demo den Superzapper
  rescueLead: 0.03, // s: Rettungsschuss -- so frisch muss das Klappen des nahen
                    // Flippers sein (Flugzeit ~0.135 s landet im Diagonal-Fenster)
  fireDist: 7,      // Gangbreiten: nur so nahe Feinde gelten als "in Sicht"
  fireCone: 0.5,    // rad: halber Oeffnungswinkel des Sicht-Kegels um die
                    // Blickrichtung (deckt den eigenen Gang ab)
  boostRun: 3.0,    // Gangbreiten: mindestens so viel freie Gerade bis zur
                    // naechsten Kurve -> Boost (Brems-Rampe schafft den Abbau
                    // von boost*cruise auf cruise in ~0.85 Gangbreiten)
  boostAlign: 0.12, // rad: geboostet wird nur, wenn der Kurs schon stimmt
  aimTol: 0.08,     // steer-Einheiten: Totzone der Duell-Ziel-Regelung (der
                    // gerampte steer pendelt so eng um den Sollwert)
  duelFire: 0.28,   // Gangbreiten: Quer-Toleranz des Fadenkreuzes am Flipper-
                    // Trefferpunkt, ab der gefeuert wird -- knapp unter dem
                    // shotRadius 0.3 (Rest fuer Wander-/Rampen-Fehler): die
                    // knappen Drive-by-Fenster hinter Kurven sind nur 1-2
                    // Frames lang, zu viel Vorsicht verschenkt sie
  duelWindow: 1.0,  // Gangbreiten: Quer-Fenster der Duell-Erkennung um die
                    // Flipper-Gangmitte -- weiter als die toedliche Ebene
                    // (0.5), damit das Duell beim EINBIEGEN und an QUERUNGEN
                    // frueh genug beginnt (die Seiten-Phase muss abgewartet
                    // werden koennen), aber unter dem PARALLELEN Nachbargang
                    // (Mitte 1.2 bei wall 1/corridor 5 -- Wand schuetzt dort,
                    // ein Duell durch die Wand waere sinnlos)
};

// Winkel auf (-PI, PI] normalisieren (yaw akkumuliert frei).
export function wrapAngle(a) {
  const w = a % (2 * Math.PI);
  return w > Math.PI ? w - 2 * Math.PI : w <= -Math.PI ? w + 2 * Math.PI : w;
}

// Die Pfeiltaste, die unter der aktuellen Blick-Verdrehung `orient` den
// gewuenschten Lenk-Sinn ergibt (turn +1 = Welt-links, -1 = Welt-rechts).
export function keyForTurn(orient, turn) {
  const names = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
  for (const dir of Object.keys(names)) {
    if (gyroTurn(orient ?? 0, { [dir]: true }) === turn) return names[dir];
  }
  return turn > 0 ? 'ArrowLeft' : 'ArrowRight';
}

// Die Pfeiltaste, die unter der Blick-Verdrehung `orient` die logische
// ROLLE ergibt ('up' = Boost, 'down' = Ausrichten im Fahrt-Modus) --
// Inverse von gyroDirs, analog zu keyForTurn.
export function keyForRole(orient, role) {
  const names = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
  for (const dir of Object.keys(names)) {
    if (gyroDirs(orient ?? 0, { [dir]: true })[role]) return names[dir];
  }
  return names[role];
}

// Ist ein Feind "in Sicht"? Nah genug UND ungefaehr in Blickrichtung --
// der Kegel deckt den eigenen Gang ab (ein Feind im Nachbargang faellt
// selten hinein; ein Fehlschuss in die Wand ist arcade-ok).
// foes = [[x,z], ...] (Welt-Koordinaten), null/leer = nichts in Sicht.
export function foeInSight(pose, foes, cell) {
  if (!foes) return false;
  for (const [fx, fz] of foes) {
    const dx = fx - pose.px;
    const dz = fz - pose.pz;
    if (Math.hypot(dx, dz) > AUTOPILOT.fireDist * cell) continue;
    if (Math.abs(wrapAngle(Math.atan2(-dx, -dz) - pose.yaw)) < AUTOPILOT.fireCone) return true;
  }
  return false;
}

// Rettungsschuss-Gelegenheit: ein lebender Flipper im eigenen Gang, vor
// dem Spieler, naeher als flipDist, der GERADE zu klappen beginnt (flipT
// unter rescueLead) oder schon diagonal steht.
export function rescueChance(pose, flippers, cell) {
  for (const f of flippers ?? []) {
    if (!f.alive || f.mode !== 'flip') continue;
    const crossP = f.axis === 'x' ? pose.pz : pose.px;
    if (Math.abs(crossP - f.cross) >= 0.5 * cell) continue;
    const [fx, fz] = flipperPos(f);
    const dx = fx - pose.px;
    const dz = fz - pose.pz;
    if (dx * -Math.sin(pose.yaw) + dz * -Math.cos(pose.yaw) <= 0) continue;
    if (Math.hypot(dx, dz) > FLIPPER.flipDist * cell * 1.2) continue;
    if (f.flipT <= AUTOPILOT.rescueLead || flipperDiagonal(f)) return true;
  }
  return false;
}

// Das FLIPPER-DUELL: der naechste lebende Flipper, der dem Autopiloten IM
// WEG steht -- Spieler im Quer-Fenster des Flipper-Gangs, Flipper vor der
// Blick-HALBEBENE (kein enger Kegel: nah am Flipper und beim Einbiegen in
// seinen Gang waere jeder Kegel sofort verlassen, das Duell braech genau
// dann ab, wenn es zaehlt) und naeher als `maxDist` (der Aufrufer uebergibt
// die freie Gerade des Loesungswegs: ein Flipper HINTER der eigenen
// Abbiegung ist kein Gegner, die Kurve gewinnt). Liefert null oder
// { dist, steer, aim }: `aim` ist der Zielwinkel auf den SEITEN-Trefferpunkt
// (f.cross + side*(0.5-lift), die Stelle, an der das hochkant stehende X
// die Schusshoehe kreuzt), `steer` der Lenk-Ausschlag, der das Fadenkreuz
// (aimYaw = yaw + steer*deflect) dorthin legt -- oder beide null, wenn der
// Flipper nicht seitlich eingerastet ist (untreffbar) oder der Punkt
// ausserhalb des Fadenkreuz-Ausschlags liegt (zu quer, nicht verfolgen).
export function flipperDuel(pose, flippers, cell, maxDist = Infinity) {
  const limit = Math.min(AUTOPILOT.fireDist * cell, maxDist);
  let best = null;
  for (const f of flippers ?? []) {
    if (!f.alive) continue;
    const crossP = f.axis === 'x' ? pose.pz : pose.px;
    if (Math.abs(crossP - f.cross) >= AUTOPILOT.duelWindow * cell) continue; // fremder Gang
    const [fx, fz] = flipperPos(f);
    const dx = fx - pose.px;
    const dz = fz - pose.pz;
    const dist = Math.hypot(dx, dz);
    if (dist > limit) continue;
    if (dx * -Math.sin(pose.yaw) + dz * -Math.cos(pose.yaw) <= 0) continue; // hinter mir
    if (best && dist >= best.dist) continue;
    const side = flipperSide(f);
    let steer = null;
    let aim = null;
    if (side !== 0) {
      const q = f.cross + side * (0.5 - FLIPPER.lift) * cell;
      const [hx, hz] = f.axis === 'x' ? [f.along, q] : [q, f.along];
      aim = Math.atan2(-(hx - pose.px), -(hz - pose.pz));
      const off = wrapAngle(aim - pose.yaw);
      // Verfolgt (angesteuert) wird der Punkt nur, wenn der Fadenkreuz-
      // Ausschlag ihn ueberhaupt erreichen kann -- `aim` bleibt trotzdem
      // gesetzt: der Drive-by-Schuss beim Einbiegen (das Kreuz streicht
      // waehrend der Kurvenfahrt ueber den Punkt) braucht ihn.
      if (Math.abs(off) < 2 * SHOTS.deflect) {
        steer = Math.max(-1, Math.min(1, off / SHOTS.deflect));
      }
    }
    best = { dist, steer, aim };
  }
  return best;
}

// Distanz (Luftlinie) zum naechsten KNICK des Loesungswegs voraus -- der
// Deckel des Flipper-Duells. Absichtlich NICHT straightRunAhead: dessen
// approach-Zweig kollabiert bei seitlichem Versatz (und genau den erzeugt
// das Duell-Zielen selbst) auf unter eine Gangbreite -- das Duell wuergte
// sich damit selbst ab. Die Knick-Luftlinie ist gegen Quer-Versatz
// unempfindlich.
function nextTurnDist(ap, pose) {
  const { path } = ap;
  for (let j = ap.idx; j < path.length - 1; j++) {
    if (isTurnPoint(path, j)) {
      return Math.hypot(path[j][0] - pose.px, path[j][1] - pose.pz);
    }
  }
  return Infinity; // keine Kurve mehr: fireDist/done deckeln
}

// Knick-Wegpunkt: der Loesungsweg aendert bei i die Richtung (Kurve).
function isTurnPoint(path, i) {
  if (i <= 0 || i >= path.length - 1) return false;
  const ax = path[i][0] - path[i - 1][0];
  const az = path[i][1] - path[i - 1][1];
  const bx = path[i + 1][0] - path[i][0];
  const bz = path[i + 1][1] - path[i][1];
  return Math.abs(ax * bz - az * bx) > 1e-9;
}

// Freie Gerade voraus (Welt-Einheiten): Weglaenge von der Spielerlage bis
// zur naechsten RICHTUNGSAENDERUNG des Loesungswegs (das Weg-Ende zaehlt
// wie eine Kurve -- so endet der Boost rechtzeitig vor dem Ziel).
function straightRunAhead(ap, pose) {
  const { path } = ap;
  const last = path.length - 1;
  if (ap.idx >= last) {
    return Math.hypot(path[last][0] - pose.px, path[last][1] - pose.pz);
  }
  const dir = (j) => {
    const dx = path[j + 1][0] - path[j][0];
    const dz = path[j + 1][1] - path[j][1];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  const [dx0, dz0] = dir(ap.idx);
  const ax = path[ap.idx][0] - pose.px;
  const az = path[ap.idx][1] - pose.pz;
  const approach = Math.hypot(ax, az);
  // Anlauf zum naechsten Wegpunkt zaehlt nur mit, wenn er in Lauf-Richtung
  // liegt -- quer dazu (mitten in einer Kurve) endet die Gerade dort.
  if (approach > 1e-9 && (ax * dx0 + az * dz0) / approach < 0.99) return approach;
  let dist = approach;
  for (let j = ap.idx; j < last; j++) {
    const [dx, dz] = dir(j);
    if (dx * dx0 + dz * dz0 < 0.99) break; // Kurve
    dist += Math.hypot(path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1]);
  }
  return dist;
}

// Autopilot fuer ein Labyrinth anlegen. opts = { unit, cell }.
export function createAutopilot(maze, { unit, cell }) {
  const path = (findPath(maze, maze.start, maze.goal) ?? [])
    .map(([gx, gy]) => cellCenter(maze, gx, gy, unit));
  return { path, idx: 0, cell };
}

// Ein Schritt: liefert { keys: Set<string>, done }. pose = {px,pz,yaw};
// mode = { drive, shoot, orient, foes, flippers, steer } (orient =
// gyro.orient der Szene, 0 ohne Verdrehung; foes = Ziel-Positionen
// [[x,z],...] fuer foeInSight -- ohne foes wird nie gefeuert; flippers =
// die Flipper-Objekte des Levels fuers Duell; steer = der geraempte
// Lenk-Zustand der Fahrt fuer die Ziel-Regelung). WICHTIG: der Aufrufer
// reicht nur Ziele MIT freier Sichtlinie herein (playing filtert foes UND
// flippers per hasLineOfSight) -- der Autopilot selbst kennt kein Maze
// und wuerde sonst sichtbar sinnlos auf Feinde hinter Waenden feuern.
// Der Aufrufer schreibt keys nach game.keys.
export function autopilotStep(ap, pose, mode = {}) {
  const keys = new Set();
  const { path } = ap;
  if (!path.length) return { keys, done: true };

  // Wegpunkte aufruecken, Ziel = erster Punkt ausreichend weit voraus.
  // Tank-Modus: KNICK-Punkte klemmen den Vorausblick (nicht diagonal um die
  // Ecke ziehen) und werden erst dicht an der Kammermitte aufgegeben --
  // sonst schneidet die Diagonale zum Quergang-Punkt die Innenecke.
  const turnPt = (i) => !mode.drive && isTurnPoint(path, i);
  const distTo = (i) => Math.hypot(path[i][0] - pose.px, path[i][1] - pose.pz);
  const advanceOf = (i) => (turnPt(i) ? AUTOPILOT.turnAdvance : AUTOPILOT.advance);
  while (ap.idx < path.length - 1 && distTo(ap.idx) < advanceOf(ap.idx) * ap.cell) ap.idx++;
  let t = ap.idx;
  while (t < path.length - 1 && !turnPt(t) && distTo(t) < AUTOPILOT.lookahead * ap.cell) t++;
  // Fertig erst dicht an der ZIELMITTE (die Ziel-Zone verlangt 0.25
  // Feldgroesse "drinnen" -- advance allein stoppte knapp davor).
  const done = distTo(path.length - 1) < AUTOPILOT.doneRadius * ap.cell;

  const [tx, tz] = path[t];
  const want = Math.atan2(-(tx - pose.px), -(tz - pose.pz)); // Konvention: forward = (-sin, -cos)
  const dyaw = wrapAngle(want - pose.yaw);

  const foe = !done && !!mode.shoot && foeInSight(pose, mode.foes, ap.cell);
  const duel = !done && mode.drive ? flipperDuel(pose, mode.flippers, ap.cell) : null;
  // ANGESTEUERT (Ziel-Lenkung) wird ein Flipper nur bis kurz hinter die
  // naechste Kurve des Loesungswegs: wer weiter hinten lauert, steht (noch)
  // nicht im Weg, und auf ihn zuzulenken wuerde die Kurvenfahrt verderben.
  // Der Drive-by-Schuss unten kennt diesen Deckel nicht.
  const duelNear = duel != null && duel.dist < nextTurnDist(ap, pose) + 0.5 * ap.cell;

  if (!done) {
    if (mode.drive) {
      if (Math.abs(dyaw) > AUTOPILOT.driveSteer) {
        // Fahrt-Modus: echte Kurven lenkt der Autopilot selbst -- und die
        // Kurve gewinnt auch gegen ein Duell (geradeaus zielen statt
        // abbiegen endet an der Kreuzungswand).
        keys.add(keyForTurn(mode.orient, dyaw > 0 ? 1 : -1));
      } else if (duelNear && duel.steer != null) {
        // FLIPPER-DUELL: mit dem Fadenkreuz-Lenkausschlag seitlich auf den
        // Trefferpunkt zielen -- die Tasten pulsen den gerampten steer der
        // Fahrt (mode.steer) auf den Sollwert.
        const diff = duel.steer - (mode.steer ?? 0);
        if (Math.abs(diff) > AUTOPILOT.aimTol) {
          keys.add(keyForTurn(mode.orient, diff > 0 ? 1 : -1));
        }
      } else {
        keys.add(keyForRole(mode.orient, 'down'));
        // BOOST wie ein Profi: Kurs stimmt, freie lange Gerade, kein Feind
        // und kein Flipper im Weg (vor beiden faellt er auf cruise zurueck
        // -- ein untreffbar geklappter Flipper braucht die Zeitreserve).
        if (!foe && !duelNear && Math.abs(dyaw) < AUTOPILOT.boostAlign
          && straightRunAhead(ap, pose) > AUTOPILOT.boostRun * ap.cell) {
          keys.add(keyForRole(mode.orient, 'up'));
        }
      }
      // RETTUNGSSCHUSS (Sturm): klappt ein naher Flipper im eigenen Gang
      // gerade los (Zwangs-Flip vor dem Spieler), geht sofort ein gerader
      // Schuss raus -- Flugzeit ~0.135 s trifft die Diagonale (Experten-
      // Timing, das die Demo herzeigt). Nur bei neutralem Fadenkreuz.
      if (mode.shoot && Math.abs(mode.steer ?? 0) < AUTOPILOT.aimTol
        && rescueChance(pose, mode.flippers, ap.cell)) keys.add(' ');
      // DRIVE-BY-Feuer in JEDER Fahrlage (auch mitten in der Kurve): sobald
      // das Fadenkreuz einen treffbaren Flipper-Punkt in Quer-Toleranz hat,
      // geht ein Schuss raus -- beim Einbiegen in einen bewachten Gang
      // streicht das Kreuz zwangslaeufig ueber den Punkt, und genau dieser
      // Schuss rettet die knappen Begegnungen direkt hinter der Kurve.
      // (Erst-wenn-es-passt statt Dauerfeuer: kein Munition-Leeren an der
      // Endwand, Tempest-Limit max 8.)
      if (mode.shoot && duel?.aim != null) {
        const err = Math.abs(wrapAngle(pose.yaw + (mode.steer ?? 0) * SHOTS.deflect - duel.aim));
        if (err * duel.dist < AUTOPILOT.duelFire * ap.cell) keys.add(' ');
      }
    } else {
      if (Math.abs(dyaw) > AUTOPILOT.turnDead) {
        keys.add(keyForTurn(mode.orient, dyaw > 0 ? 1 : -1));
      }
      if (Math.abs(dyaw) < AUTOPILOT.walkAlign) {
        keys.add('ArrowUp'); // Tank-Modus: erst ausrichten, dann vorwaerts
      }
    }
  }
  if (foe) keys.add(' '); // gezieltes Feuer statt Dauerfeuer
  // SUPERZAPPER wie ein Profi: wenn es eng wird (mode.zapWorth = genug
  // Feinde im Sichtfeld, vom Aufrufer per zapTargets bestimmt) und er noch
  // geladen ist (mode.zap) -- die Demo zeigt die Mechanik her.
  if (!done && mode.zap && mode.zapWorth) keys.add('Z');

  return { keys, done };
}

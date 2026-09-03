// Spinner (ab Level 16): gruene oktagonale Spiralen, die aus den End-Waenden
// langer gerader Gangstuecke hervorkommen und einen Spike entlang der
// Gangmitte "erzeugen", der den Spieler aufspiesst. Reine Daten +
// Berechnung, kein Canvas -> headless testbar.
//
// STURM-Modell (Boris' Tempest-Mechanik, 3.9.2026): der Spike ist an der
// WAND verankert (Spitze bei t = spike, gemessen von der Wandflaeche). Der
// Spinner WANDERT vor und zurueck (Wand <-> Spitze) und kommt bei jedem
// Vorlauf um `step` weiter als beim vorigen -- SO verlaengert er den Spike
// (kein Wachstum ohne Wandern; beim Vorlaufen ist der Koerper die Spitze).
// Das beginnt erst, wenn der Spieler sich NAEHERT: hoechstens `wakeTurns`
// Ecken (Knicke des eindeutigen Wegs) vor dem Spike-Gang (wakeSpinners,
// BFS pro Spinner, gecacht) -- darum braucht es keinen Laengen-Deckel mehr,
// nur der Gang-Einstieg bleibt frei (capMargin).
//
// Verwundbar ist der Koerper NUR "vorne am Spike": wenn er an der Spitze
// steht (Vorlauf) oder der Spike unter seine Lage gekuerzt wurde (Rueckzug
// hinter einem zu kurzen Spike) -- sonst faengt der Spike jeden Schuss ab
// und wird um `shorten` gekuerzt. Ein toter Spinner laesst seinen SPIKE
// stehen (eingefroren, weiter kuerzbar, Spitze weiter eine Einbahn-Sperre;
// Superzapper-konsistent). NUR der Spinner schiesst (aus dem Koerper, durch
// den eigenen Spike), in ALLEN Spinner-Levels -- sirrende Schuesse die
// Gangmitte entlang, gangbreit toedlich, abfangbar per eigenem Feuer.
//
// Der Spike ist eine EINBAHN-SPERRE (12.7.2026): toedlich ist die SPITZE
// von vorn ueber die GANZE Gangbreite; Schaft und Ueberfahren von hinten
// sind harmlos (die Ecken-Falle: hinter der Spitze eingestiegen und in
// Spike-Richtung gezwungen). Die Durchkommens-Garantie haengt an den
// Konstanten: Kuerz-Rate bei Dauerfeuer (SHOTS.rate * shorten) gegen das
// Vorruecken der Spitze -- abgesichert per Test.

import { OPEN } from './maze.js';
import { cellAt } from './mazeWorld.js';
import { corridorCandidates, foeMarkers, aheadEnd } from './foePlacement.js';

export const SPINNER = {
  minChambers: 3,   // so viele Kammern muss ein gerades Gangstueck mindestens haben
  size: 0.32,       // Aussenradius der Spirale (Gangbreiten)
  turns: 2,         // Spiral-Windungen (8 Ecken je Windung)
  spin: 3.2,        // rad/s Drehung (Vorzeichen folgt der Blickrichtung)
  height: 0.35,     // Schwebe-Hoehe der Spiralen-Mitte (Gangbreiten) -- etwas
                    // unter der Augenhoehe (EYE_RATIO 0.5), damit der Spike
                    // auch frontal sichtbar bleibt, aber nah genug fuer
                    // glaubhafte Treffer (Schuesse fliegen auf Augenhoehe)
  hitRadius: 0.32,  // Koerper-Kollision gegen den Spieler (Gangbreiten)
  shotRadius: 0.38, // Koerper-Trefferradius fuer Projektile (Gangbreiten)
  spikeHitRadius: 0.35, // Quer-Toleranz Projektil vs. Spike (Gangbreiten)
  blockRadius: 0.5, // Quer-Reichweite der SPITZE gegen den Spieler: die HALBE
                    // Gangbreite -- frontal sperrt sie den Gang, ausweichen
                    // geht nicht (von hinten ist der Spike harmlos, s.o.)
  advance: 0.5,     // Vorlauf-Tempo (Gangbreiten/s) -- der Koerper schiebt die Spitze
  retreat: 0.8,     // Rueckzugs-Tempo (Gangbreiten/s)
  step: 0.4,        // Gangbreiten: jeder Vorlauf reicht so viel weiter als der vorige
  shorten: 0.45,    // Spike-Kuerzung pro Treffer (Gangbreiten) -- die Kuerz-Rate
                    // bei Dauerfeuer (SHOTS.rate x shorten = 2.25 Gangbreiten/s)
                    // muss die Reisegeschwindigkeit (DRIVE.cruise 1.5) DEUTLICH
                    // schlagen: im Fahrt-Modus kann man nicht bremsen, und jeder
                    // Schuss, der einen Spinner-Schuss abfaengt, kuerzt nicht --
                    // mit 0.35 (Rate 1.75) lief der reitende Spieler in die Spitze
  capMargin: 1.0,   // der Spike laesst mindestens so viel vom Gangstueck frei
  exclude: 3,       // so viele Weg-Kammern um S und G bleiben spinnerfrei
  wakeTurns: 2,     // Ecken: so nah muss der Spieler kommen, bevor der Spinner loslegt
  // Spinner-SCHUSS: steht der Spieler im GANG des Spinners und hat ihn VOR
  // sich, loest sich gelegentlich ein sirrender Schuss aus dem KOERPER und
  // fliegt die Gangmitte entlang (durch den eigenen Spike) -- unabhaengig
  // von Vorlauf/Rueckzug. Toedlich ueber die ganze Gangbreite (blockRadius,
  // wie die Spitze), aber ABFANGBAR: eigene Projektile zerstoeren ihn.
  fireRate: 0.3,     // mittlere Schuesse/s im Duell ("gelegentlich")
  shotSpeed: 2.2,    // Flugtempo des Spinner-Schusses (Gangbreiten/s)
  shotSize: 0.14,    // Funken-Halbgroesse des Schusses (Gangbreiten)
  intercept: 0.3,    // Abfang-Radius eigener Projektile gegen den Schuss (Gangbreiten)
};

// Erzeugt die Spinner eines Levels. config = { count } (Level-Daten),
// opts = { unit, cell, rng }. Deterministisch bei gleichem rng (Tests).
// Platzierung via corridorCandidates (foePlacement.js): Weg-Gaenge zuerst,
// laengere zuerst, Schutzzone um S und G bleibt frei, pro Gangstueck
// hoechstens EIN Spinner. Wand-Ende: das Ende VORAUS (aheadEnd -- auf dem
// Loesungsweg in Laufrichtung, die Begegnung ist frontal).
export function createSpinners(maze, config, opts) {
  const { unit, cell, rng } = opts;
  const count = config.count ?? 0;
  const candidates = corridorCandidates(maze, {
    minChambers: SPINNER.minChambers, exclude: SPINNER.exclude, unit, cell,
  });

  return candidates.slice(0, count).map((run) => {
    // Welt-Koordinaten des Gangstuecks: Wandflaechen an beiden Enden
    // (min/max sind die Kammermitten der Endzellen).
    const cross = run.cross;
    const lowWall = run.min - 0.5 * cell;
    const highWall = run.max + 0.5 * cell;
    const runLen = highWall - lowWall;
    const highEnd = aheadEnd(run, rng);
    return {
      axis: run.axis,
      dir: highEnd ? -1 : 1,             // Blickrichtung Wand -> Gang
      wall: highEnd ? highWall : lowWall, // Welt-Koordinate der Wandflaeche
      cross,                              // Gangmitte quer (Welt)
      runLen,
      cap: runLen - SPINNER.capMargin * cell, // Spike-Deckel: der Einstieg bleibt frei
      offset: 0,   // Koerper-Abstand von der Wand
      spike: 0,    // Spike-Laenge ab der Wand (Spitze bei t = spike)
      reach: 0,    // Weite des laufenden/naechsten Vorlaufs
      mode: 'idle',   // idle (schlaeft an der Wand) | advance | retreat
      active: false,  // geweckt durch Annaeherung (wakeSpinners)
      alive: true,
      phase: rng() * 2 * Math.PI,
      gx: run.axis === 'x' ? (highEnd ? run.hi : run.lo) : run.fix, // Endkammer
      gy: run.axis === 'x' ? run.fix : (highEnd ? run.hi : run.lo),
    };
  });
}

// Koerper-Mitte (Welt x,z): an der Wand halb versenkt, beim Wandern im Gang.
export function spinnerPos(s) {
  const along = s.wall + s.dir * s.offset;
  return s.axis === 'x' ? [along, s.cross] : [s.cross, along];
}

// Spike-Spitze (Welt x,z) -- gemessen von der Wand.
export function spinnerTip(s) {
  const along = s.wall + s.dir * s.spike;
  return s.axis === 'x' ? [along, s.cross] : [s.cross, along];
}

// Sichtbar/wirksam: lebender Spinner ODER ein stehen gebliebener Spike.
export function spinnerShown(s) {
  return s.alive || s.spike > 0;
}

// Position in Gang-Koordinaten: t = Abstand von der Wand entlang der
// Blickrichtung des Spinners, q = Quer-Abstand von der Gangmitte.
function runCoords(s, x, z) {
  const along = s.axis === 'x' ? x : z;
  const cross = s.axis === 'x' ? z : x;
  return [(along - s.wall) * s.dir, Math.abs(cross - s.cross)];
}

// --- Wecken durch Annaeherung -------------------------------------------------

// Ecken-Karte eines Spinner-Gangs: fuer jede offene Zelle die Zahl der
// Richtungswechsel (Knicke) auf dem eindeutigen Weg vom Gangstueck dorthin
// (das Labyrinth ist ein Baum). Seitliches Verlassen des Gangs zaehlt als
// Knick (Achsenwechsel), Verlassen durch die Enden nicht. Unerreichbar = -1.
// Gecacht pro Spinner (WeakMap -- nie in die Spinner-Daten, die klont der
// Recorder 30x pro Sekunde).
const turnMaps = new WeakMap();

function turnMap(maze, s) {
  const n = maze.n;
  // Rohes Grid (ohne Pulsar-Wandphantome, maze.openings): die Karte wird
  // einmal gebaut und gecacht, ein gerade offenes Phantom darf sie nicht praegen.
  const isOpenCell = (m, x, y) => x >= 0 && x < n && y >= 0 && y < n && m.grid[y][x] === OPEN;
  const turns = new Int16Array(n * n).fill(-1);
  const axes = new Int8Array(n * n); // 0 = x-Achse, 1 = y-Achse der Ankunft
  const queue = [];
  // Seeds: alle offenen Zellen des Gangstuecks ab der Endkammer in dir.
  const [dx, dy] = s.axis === 'x' ? [s.dir, 0] : [0, s.dir];
  const runAxis = s.axis === 'x' ? 0 : 1;
  for (let x = s.gx, y = s.gy; isOpenCell(maze, x, y); x += dx, y += dy) {
    turns[y * n + x] = 0;
    axes[y * n + x] = runAxis;
    queue.push([x, y]);
  }
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    const c = y * n + x;
    for (const [sx, sy, ax] of [[1, 0, 0], [-1, 0, 0], [0, 1, 1], [0, -1, 1]]) {
      const nx = x + sx, ny = y + sy;
      if (!isOpenCell(maze, nx, ny) || turns[ny * n + nx] >= 0) continue;
      turns[ny * n + nx] = turns[c] + (axes[c] !== ax ? 1 : 0);
      axes[ny * n + nx] = ax;
      queue.push([nx, ny]);
    }
  }
  return turns;
}

// Ecken-Abstand des Spielers zum Gang dieses Spinners (-1 = unerreichbar).
export function spinnerTurnsAway(maze, s, px, pz, unit) {
  let map = turnMaps.get(s);
  if (!map) {
    map = turnMap(maze, s);
    turnMaps.set(s, map);
  }
  const [gx, gy] = cellAt(maze, px, pz, unit);
  if (gx < 0 || gx >= maze.n || gy < 0 || gy >= maze.n) return -1;
  return map[gy * maze.n + gx];
}

// Weckt schlafende Spinner, denen der Spieler auf hoechstens wakeTurns
// Ecken nahe gekommen ist. Liefert die frisch geweckten.
export function wakeSpinners(spinners, maze, px, pz, unit) {
  const woken = [];
  for (const s of spinners) {
    if (!s.alive || s.active) continue;
    const t = spinnerTurnsAway(maze, s, px, pz, unit);
    if (t >= 0 && t <= SPINNER.wakeTurns) {
      s.active = true;
      woken.push(s);
    }
  }
  return woken;
}

// --- Simulation ---------------------------------------------------------------

// Ein Simulationsschritt: geweckte Spinner wandern -- Vorlauf bis `reach`
// (der Koerper schiebt dabei die Spitze vor sich her), Rueckzug bis zur
// Wand, dann der naechste Vorlauf um `step` weiter (bis cap). `prevTip`
// merkt sich die Spitzen-Lage VOR dem Schritt -- spinnerPlayerHit erkennt
// Aufspiessen als KREUZEN der Spitze (nur die Eigenbewegung zaehlt hinein;
// das Kuerzen durch Schuesse passiert nach dem Spieler-Check und laesst die
// zurueckspringende Spitze nie toedlich werden). Tote Spinner: der Spike
// steht still.
export function spinnersStep(spinners, dt, cell) {
  for (const s of spinners) {
    s.prevTip = s.spike;
    if (!s.alive || !s.active) continue;
    if (s.mode === 'idle') {
      s.reach = Math.min(s.cap, SPINNER.step * cell);
      s.mode = 'advance';
    }
    if (s.mode === 'advance') {
      s.offset = Math.min(s.reach, s.offset + SPINNER.advance * cell * dt);
      s.spike = Math.max(s.spike, s.offset); // die Spitze wandert mit dem Koerper vor
      if (s.offset >= s.reach - 1e-9) s.mode = 'retreat';
    } else {
      s.offset = Math.max(0, s.offset - SPINNER.retreat * cell * dt);
      if (s.offset <= 0) {
        s.reach = Math.min(s.cap, s.reach + SPINNER.step * cell);
        s.mode = 'advance';
      }
    }
  }
}

// Steht der Koerper "vorne am Spike" (an der Spitze oder davor, weil der
// Spike unter seine Lage gekuerzt wurde)? Nur dann ist er verwundbar.
export function spinnerExposed(s) {
  return s.offset >= s.spike - 1e-9;
}

// Projektil-Treffer an (x,z). Ein exponierter Koerper (spinnerExposed)
// stirbt; sonst faengt der Spike ab (jeder Treffer kuerzt ihn). Auch der
// Spike eines toten Spinners faengt weiter ab. `foeShots` (optional): die
// sirrenden Schuesse -- ein Treffer schneidet das Spitzen-Stueck ab, und
// ein Spinner-Schuss, der gerade in diesem Stueck fliegt (plus den
// Abfang-Radius dahinter -- das Stueck zerplatzt), wird MIT zerstoert (er
// laeuft zwar ungehindert durch den eigenen Spike, aber nicht durch ein
// abgeschossenes Stueck; sonst sind die aus dem Koerper gefeuerten
// Schuesse fuer den dicht hinter der Spitze reitenden Spieler
// unabfangbar -- sie tauchten erst 0.1 s vor ihm aus der Spitze auf).
// Liefert das Ereignis fuer Effekte/Sound oder null:
// { type: 'spike'|'spinner', x, z, spinner, zapped? }.
export function spinnerShotHit(spinners, x, z, cell, foeShots = null) {
  for (const s of spinners) {
    if (!spinnerShown(s)) continue;
    const [t, q] = runCoords(s, x, z);
    if (t < 0) continue; // hinter der Spinner-Wand: die Wand schuetzt
    if (s.alive && spinnerExposed(s)) {
      const [bx, bz] = spinnerPos(s);
      if (Math.hypot(x - bx, z - bz) < SPINNER.shotRadius * cell) {
        s.alive = false;
        return { type: 'spinner', x: bx, z: bz, spinner: s };
      }
    }
    if (s.spike > 0 && q < SPINNER.spikeHitRadius * cell && t <= s.spike) {
      const [tx, tz] = spinnerTip(s); // Funken an der (alten) Spitze
      const oldTip = s.spike;
      s.spike = Math.max(0, s.spike - SPINNER.shorten * cell);
      let zapped = 0;
      if (foeShots && foeShots.length) {
        for (let i = foeShots.length - 1; i >= 0; i--) {
          const sh = foeShots[i];
          if (sh.axis !== s.axis || sh.cross !== s.cross || sh.dir !== s.dir) continue;
          const st = (sh.wall + sh.dir * sh.t - s.wall) * s.dir; // Lage ab der Spinner-Wand
          if (st >= s.spike - SPINNER.intercept * cell && st <= oldTip) {
            foeShots.splice(i, 1);
            zapped++;
          }
        }
      }
      return { type: 'spike', x: tx, z: tz, spinner: s, zapped };
    }
  }
  return null;
}

// Spieler-Kollision: Koerper-Beruehrung (rundum, nur lebend) ODER
// Aufspiessen an der SPITZE von vorn. Aufgespiesst wird, wessen Vorderkante
// die Spitze im letzten Schritt entgegen ihrer Richtung kreuzt -- oder in
// wen die Spitze hineinlaeuft (beides: g wechselt von >0 auf <=0). Quer
// wirkt die Spitze ueber die halbe Gangbreite (blockRadius) -- frontal gibt
// es kein seitliches Vorbeimogeln. HINTER der Spitze (auf dem Schaft) und
// beim Ueberholen von hinten ist man sicher: der Spike ist eine Einbahn-
// Sperre -- auch der eines toten Spinners. `prev` = Spieler-Lage {px,pz}
// vor dem Schritt (ohne prev: nur die Spinner-Bewegung via prevTip kann
// kreuzen). Liefert { x, z, spinner, impale } oder null.
export function spinnerPlayerHit(spinners, px, pz, radius, cell, prev) {
  const ppx = prev?.px ?? px;
  const ppz = prev?.pz ?? pz;
  for (const s of spinners) {
    if (!spinnerShown(s)) continue;
    const [t, q] = runCoords(s, px, pz);
    // Die Wand schuetzt: der Koerper an der Wand sitzt AUF der Wand-
    // flaeche, und die End-Wand ist duenner als sein Trefferradius -- ohne
    // diese Schranke toetet er den Spieler im Gang DAHINTER durch die Wand.
    // Im eigenen Gang haelt der Kollisionsradius den Spieler stets bei t > 0.
    if (t < 0) continue;
    if (s.alive) {
      const [bx, bz] = spinnerPos(s);
      if (Math.hypot(px - bx, pz - bz) < radius + SPINNER.hitRadius * cell) {
        return { x: bx, z: bz, spinner: s, impale: false };
      }
    }
    if (s.spike <= 0) continue;
    if (q >= SPINNER.blockRadius * cell) continue;
    const tip = s.spike;
    const [tPrev] = runCoords(s, ppx, ppz);
    const gNow = (t - radius) - tip;
    const gPrev = (tPrev - radius) - (s.prevTip ?? tip);
    if (gPrev > 0 && gNow <= 0) {
      const [tx, tz] = spinnerTip(s);
      return { x: tx, z: tz, spinner: s, impale: true };
    }
  }
  return null;
}

// Marker-Positionen fuer die Kartensicht (lebende Spinner, Koerper-Mitte).
export function spinnerMarkers(spinners) {
  return foeMarkers(spinners, spinnerPos);
}

// --- Spinner-Schuesse -----------------------------------------------------
// Ein Schuss lebt in Gang-Koordinaten seines Spinners: t = Abstand von der
// Spinner-Wand entlang dir (waechst beim Flug), cross/axis/runLen kopiert.
// Dieselbe Form nutzen die Tanker-Jaeger (world/enemies.js).

// Welt-Position (x,z) eines Spinner-Schusses.
export function spinnerShotPos(shot) {
  const along = shot.wall + shot.dir * shot.t;
  return shot.axis === 'x' ? [along, shot.cross] : [shot.cross, along];
}

// Feuern: ein lebender Spinner loest mit fireRate (Wahrscheinlichkeit pro
// Sekunde) einen Schuss aus dem KOERPER -- aber NUR, wenn der Spieler in
// SEINEM Gang steht und ihn vor sich hat (Blick-Halbebene): das Duell,
// nicht die Ferne. Vorlauf/Rueckzug sind egal -- er sirrt auch von der
// Wand aus. `player` = { px, pz, yaw }. Neue Schuesse werden an `shots`
// angehaengt und (fuer Sound/Effekte) zurueckgegeben. rng haelt es
// deterministisch testbar.
export function spinnerFire(spinners, shots, dt, rng, player, cell) {
  const fired = [];
  const fx = -Math.sin(player.yaw); // Blickrichtung (Konvention wie forward)
  const fz = -Math.cos(player.yaw);
  for (const s of spinners) {
    if (!s.alive) continue;
    // Spieler im Gang des Spinners? (quer in der Gangbreite, laengs in der
    // Spanne; t < 0 waere der Nachbargang hinter der End-Wand)
    const [tp, qp] = runCoords(s, player.px, player.pz);
    if (qp >= 0.5 * cell) continue;
    if (tp < 0 || tp > s.runLen) continue;
    // ... und der Spinner liegt VOR dem Spieler (wer wegschaut/flieht,
    // wird nicht in den Ruecken geschossen).
    const [bx, bz] = spinnerPos(s);
    if (fx * (bx - player.px) + fz * (bz - player.pz) <= 0) continue;
    if (rng() >= SPINNER.fireRate * dt) continue;
    const t = s.offset;
    const shot = {
      axis: s.axis, dir: s.dir, wall: s.wall, cross: s.cross, runLen: s.runLen,
      t, prevT: t, phase: rng() * 2 * Math.PI,
    };
    shots.push(shot);
    fired.push(shot);
  }
  return fired;
}

// Ein Simulationsschritt: Schuesse fliegen die Gangmitte entlang; am fernen
// Gang-Ende verpuffen sie an der Wand (Ereignis wie bei eigenen Schuessen).
// Kompaktiert `shots` in place, liefert die Ereignisse.
export function spinnerShotsStep(shots, dt, cell) {
  const events = [];
  let w = 0;
  for (const sh of shots) {
    sh.prevT = sh.t;
    sh.t += SPINNER.shotSpeed * cell * dt;
    if (sh.t >= sh.runLen) {
      const [x, z] = spinnerShotPos({ ...sh, t: sh.runLen });
      events.push({ type: 'wall', x, z });
    } else {
      shots[w++] = sh;
    }
  }
  shots.length = w;
  return events;
}

// Spieler-Kollision: wie die Spike-Spitze wirkt der Schuss quer ueber die
// GANZE Gangbreite (blockRadius) -- ausweichen geht nicht, nur abfangen.
// Kreuzen ueber prev/prevT (beide bewegen sich), die Wand schuetzt (t<0).
// Liefert { x, z, shot } oder null.
export function spinnerShotPlayerHit(shots, px, pz, radius, cell, prev) {
  const ppx = prev?.px ?? px;
  const ppz = prev?.pz ?? pz;
  for (const sh of shots) {
    const along = sh.axis === 'x' ? px : pz;
    const crossP = sh.axis === 'x' ? pz : px;
    if (Math.abs(crossP - sh.cross) >= SPINNER.blockRadius * cell) continue;
    const t = (along - sh.wall) * sh.dir;
    if (t < 0) continue; // Nachbargang hinter der Spinner-Wand
    const tPrev = ((sh.axis === 'x' ? ppx : ppz) - sh.wall) * sh.dir;
    const gNow = (t - radius) - sh.t;
    const gPrev = (tPrev - radius) - (sh.prevT ?? sh.t);
    if (gPrev > 0 && gNow <= 0) {
      const [x, z] = spinnerShotPos(sh);
      return { x, z, shot: sh };
    }
  }
  return null;
}

// Abfangen: ein eigenes Projektil bei (x,z) zerstoert den ersten Spinner-
// Schuss in Reichweite -- beide verpuffen ('zap'-Ereignis) -- oder null.
export function spinnerShotIntercept(shots, x, z, cell) {
  for (let i = 0; i < shots.length; i++) {
    const [sx, sz] = spinnerShotPos(shots[i]);
    if (Math.hypot(x - sx, z - sz) < SPINNER.intercept * cell) {
      shots.splice(i, 1);
      return { type: 'zap', x: sx, z: sz };
    }
  }
  return null;
}

// Geometrie eines Spinner-Schusses: gezackter Funken-Stern QUER zum Gang
// (er fliegt auf den Spieler zu), sirrend schnell rotierend -- die
// flirrenden FARBEN wechselt der Aufrufer pro Frame (Arcade-Palette).
export function spinnerShotSegments(shot, time, opts) {
  const { cell } = opts;
  const [x, z] = spinnerShotPos(shot);
  const h = SPINNER.height * cell;
  const r = SPINNER.shotSize * cell;
  const a0 = 14 * time + (shot.phase ?? 0);
  const pt = (u, v) => (shot.axis === 'x' ? [x, h + v, shot.cross + u] : [shot.cross + u, h + v, z]);
  const segs = [];
  let prev = null;
  const K = 6;
  for (let k = 0; k <= K; k++) {
    const a = a0 + (k / K) * 2 * Math.PI;
    const rr = k % 2 === 0 ? r : 0.4 * r; // Zacken innen/aussen
    const p = pt(rr * Math.cos(a), rr * Math.sin(a));
    if (prev) segs.push([prev, p]);
    prev = p;
  }
  return segs;
}

// Geometrie eines Spinners als Liniensegmente (lokale Flaechen-Welt), fuer
// die normale Hidden-Line-Pipeline (renderFaceOverlay, wie die Rauten):
// oktagonale Spirale in der Ebene QUER zum Gang (sie blickt den Gang entlang,
// kein Billboard noetig) am Koerper plus der Spike von der WAND bis zur
// Spitze -- Mittellinie und eine "Bohrer"-Wendel darum, die sich mit der
// Spirale dreht. Tote Spinner: nur der Spike. opts = { cell }.
export function spinnerSegments(s, time, opts) {
  const { cell } = opts;
  const h = SPINNER.height * cell;
  const a0 = SPINNER.spin * s.dir * time + s.phase;
  // Punkt im Quer-Schnitt des Gangs: u = quer, v = Hoehe.
  const pt = (u, v, along) => (s.axis === 'x'
    ? [along, h + v, s.cross + u]
    : [s.cross + u, h + v, along]);
  const segs = [];

  // Spirale: 8 Ecken je Windung, Radius waechst linear -- die Ecken springen
  // beim Drehen sichtbar im Oktagon-Raster.
  if (s.alive) {
    const V = Math.round(SPINNER.turns * 8);
    const R = SPINNER.size * cell;
    const bodyAlong = s.wall + s.dir * s.offset;
    let prev = pt(0, 0, bodyAlong);
    for (let k = 1; k <= V; k++) {
      const a = a0 + (k * Math.PI) / 4;
      const r = (R * k) / V;
      const p = pt(r * Math.cos(a), r * Math.sin(a), bodyAlong);
      segs.push([prev, p]);
      prev = p;
    }
  }

  // Spike: Mittellinie plus Wendel von der Wand bis zur Spitze (an beiden
  // Enden auf Radius 0).
  if (s.spike > 0.01 * cell) {
    const tipAlong = s.wall + s.dir * s.spike;
    segs.push([pt(0, 0, s.wall), pt(0, 0, tipAlong)]);
    const N = Math.max(2, Math.ceil(s.spike / (0.3 * cell)));
    const rr = 0.07 * cell;
    let pv = pt(0, 0, s.wall);
    for (let i = 1; i <= N; i++) {
      const f = i / N;
      const r = i === N ? 0 : rr;
      const a = 2 * a0 + i * 2.4;
      const p = pt(r * Math.cos(a), r * Math.sin(a), s.wall + s.dir * s.spike * f);
      segs.push([pv, p]);
      pv = p;
    }
  }
  return segs;
}

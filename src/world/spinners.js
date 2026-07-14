// Spinner (ab Level 16): gruene oktagonale Spiralen, die aus den End-Waenden
// langer gerader Gangstuecke hervorkommen. Beim Drehen "erzeugen" sie einen
// Spike entlang der Gangmitte, der den Spieler aufspiesst. Reine Daten +
// Berechnung, kein Canvas -> headless testbar.
//
// Der Spike ist eine EINBAHN-SPERRE (12.7.2026 entschaerft, s.u.): toedlich
// ist die SPITZE von vorn -- ueber die GANZE Gangbreite (kein seitliches
// Vorbeimogeln), frontal hilft nur Dauerfeuer (jeder Treffer auf die Spitze
// kuerzt um `shorten`). Der Schaft dahinter und das Ueberfahren der Spitze
// VON HINTEN sind dagegen harmlos (eine Spitze sticht nur nach vorn).
// FALLE, die das behebt: kommt der Spieler an einer Ecke HINTER der Spitze
// in den Gang und muss in Spike-Richtung weiter, waere ein rundum toedlicher
// Spike unentrinnbar (Kuerzen zieht die Spitze zu ihm HIN). Zusaetzlich
// sitzt der Spinner auf Loesungsweg-Gaengen immer am Ende VORAUS in
// Laufrichtung -- die Pflicht-Begegnung ist immer der frontale Kampf.
//
// Verhalten (Boris' Spec): der Spinner laeuft vor, solange sein Spike kurz
// ist -- NUR dann ist er verwundbar. Ab `spikeRetreat` Laenge zieht er sich
// zur Wand zurueck und ist dort geschuetzt (Schuesse auf den Koerper prallen
// ab); erst wenn der Spike unter `spikeAdvance` gekuerzt ist, traut er sich
// wieder vor. Die Durchkommens-Garantie haengt an den Konstanten: Kuerz-Rate
// bei Dauerfeuer (SHOTS.rate * shorten) minus Wachstum (grow) muss etwa die
// Reisegeschwindigkeit (DRIVE.cruise) erreichen -- abgesichert per Test.
//
// Ab Level 21 (config.shoot) SCHIESSEN Spinner im Duell: steht der Spieler
// im Gang des Spinners und hat ihn vor sich, loest sich gelegentlich ein
// sirrender Schuss von der Spike-Spitze (s. SPINNER.fireRate und die
// spinnerShot*-Funktionen unten) -- abfangbar per eigenem Feuer, sonst
// toedlich ueber die ganze Gangbreite. Die Durchkommens-Garantie gilt
// weiter: der Test simuliert das Duell MIT feuerndem Spinner.

import { OPEN, isChamber, findPath } from './maze.js';
import { cellCenter } from './mazeWorld.js';
import { randInt } from '../util/rng.js';

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
  advance: 0.4,     // Vorlauf-Tempo (Gangbreiten/s)
  retreat: 0.8,     // Rueckzugs-Tempo (Gangbreiten/s)
  maxOffset: 0.9,   // maximaler Vorlauf aus der Wand (Gangbreiten)
  grow: 0.3,        // Spike-Wachstum (Gangbreiten/s)
  shorten: 0.35,    // Spike-Kuerzung pro Treffer (Gangbreiten)
  spikeRetreat: 2.0, // ab dieser Spike-Laenge laeuft der Spinner zurueck
  spikeAdvance: 0.7, // unter dieser Laenge laeuft er wieder vor
  spikeCap: 2.4,     // absolute Maximallaenge des Spikes (Gangbreiten)
  capMargin: 1.0,    // der Spike laesst mindestens so viel vom Gangstueck frei
  exclude: 3,        // so viele Weg-Kammern um S und G bleiben spinnerfrei
  // Spinner-SCHUSS (ab Level 21, Level-Feld spinners.shoot): steht der
  // Spieler im GANG des Spinners und hat ihn VOR sich, loest sich
  // gelegentlich ein sirrender Schuss von der Spike-Spitze und fliegt die
  // Gangmitte entlang -- unabhaengig von Vorlauf/Rueckzug (14.7.2026: an
  // den Vorlauf gekoppelt schossen alle nur am Level-Anfang, sagt Boris).
  // Toedlich ueber die ganze Gangbreite (blockRadius, wie die Spitze), aber
  // ABFANGBAR: eigene Projektile zerstoeren ihn (wer im Duell feuert, ist
  // sicher).
  fireRate: 0.3,     // mittlere Schuesse/s im Duell ("gelegentlich")
  shotSpeed: 2.2,    // Flugtempo des Spinner-Schusses (Gangbreiten/s)
  shotSize: 0.14,    // Funken-Halbgroesse des Schusses (Gangbreiten)
  intercept: 0.3,    // Abfang-Radius eigener Projektile gegen den Schuss (Gangbreiten)
};

function isOpen(maze, x, y) {
  return x >= 0 && x < maze.n && y >= 0 && y < maze.n && maze.grid[y][x] === OPEN;
}

// Maximale gerade offene Spannen (Gangstuecke) entlang beider Achsen.
// Spannen beginnen und enden immer auf Kammern (Kammern sind stets offen,
// ein offenes Zwischenwand-Feld verbindet zwei offene Kammern). Liefert
// [{ axis, fix, lo, hi, chambers }] mit Grid-Spanne [lo..hi] auf der Achse.
export function straightRuns(maze) {
  const runs = [];
  for (const axis of ['x', 'z']) {
    for (let fix = 1; fix <= maze.n - 2; fix += 2) {
      let lo = -1;
      for (let i = 1; i <= maze.n - 1; i++) {
        const open = axis === 'x' ? isOpen(maze, i, fix) : isOpen(maze, fix, i);
        if (open && lo < 0) lo = i;
        if (!open && lo >= 0) {
          const hi = i - 1;
          runs.push({ axis, fix, lo, hi, chambers: (hi - lo) / 2 + 1 });
          lo = -1;
        }
      }
    }
  }
  return runs;
}

// Erzeugt die Spinner eines Levels. config = { count } (Level-Daten),
// opts = { unit, cell, rng }. Deterministisch bei gleichem rng (Tests).
// Bevorzugt Gangstuecke, die den Loesungsweg kreuzen (man begegnet ihnen),
// laengere zuerst; die Schutzzone um S und G (erste/letzte Weg-Kammern wie
// bei den Rauten) bleibt frei. Pro Gangstueck hoechstens EIN Spinner.
// Wand-Ende: auf dem Loesungsweg sitzt der Spinner VORAUS in Laufrichtung
// (die Begegnung ist frontal -- von hinten waere der Spike nur eine harmlose
// Einbahn-Sperre); bei blosser Querung moeglichst fern der Kreuzung (mehr
// Zeit zum Kuerzen), abseits des Wegs wuerfelt der rng.
export function createSpinners(maze, config, opts) {
  const { unit, cell, rng } = opts;
  const count = config.count ?? 0;

  const path = (findPath(maze, maze.start, maze.goal) ?? []).filter(([x, y]) => isChamber(x, y));
  const key = (x, y) => x + ',' + y;
  const pathIdx = new Map(path.map(([x, y], i) => [key(x, y), i]));
  const guard = new Set([...path.slice(0, SPINNER.exclude), ...path.slice(-SPINNER.exclude)]
    .map(([x, y]) => key(x, y)));

  const candidates = [];
  for (const run of straightRuns(maze)) {
    if (run.chambers < SPINNER.minChambers) continue;
    let guarded = false;
    const visits = []; // Weg-Kammern auf dem Gang: { i: Grid-Koordinate laengs, idx: Position auf dem Weg }
    for (let i = run.lo; i <= run.hi; i += 2) {
      const k = run.axis === 'x' ? key(i, run.fix) : key(run.fix, i);
      if (pathIdx.has(k)) visits.push({ i, idx: pathIdx.get(k) });
      if (guard.has(k)) guarded = true;
    }
    if (!guarded) candidates.push({ ...run, onPath: visits.length > 0, visits });
  }
  // Weg-Gaenge zuerst, dann die laengeren -- deterministisch sortiert.
  candidates.sort((a, b) => (b.onPath - a.onPath)
    || (b.chambers - a.chambers) || (a.fix - b.fix) || (a.lo - b.lo) || (a.axis < b.axis ? -1 : 1));

  return candidates.slice(0, count).map((run) => {
    // Welt-Koordinaten des Gangstuecks: Wandflaechen an beiden Enden.
    const centerOf = (i) => (run.axis === 'x'
      ? cellCenter(maze, i, run.fix, unit)
      : cellCenter(maze, run.fix, i, unit));
    const a = centerOf(run.lo);
    const b = centerOf(run.hi);
    const aAlong = run.axis === 'x' ? a[0] : a[1];
    const bAlong = run.axis === 'x' ? b[0] : b[1];
    const cross = run.axis === 'x' ? a[1] : a[0];
    const lowWall = aAlong - 0.5 * cell;
    const highWall = bAlong + 0.5 * cell;
    const runLen = highWall - lowWall;
    // Wand-Ende: Laufrichtung des Wegs ueber den Gang bestimmt das Ende
    // VORAUS; einzelne Querung -> fern der Kreuzung; abseits -> rng.
    let highEnd;
    if (run.visits.length >= 2) {
      const byIdx = [...run.visits].sort((u, v) => u.idx - v.idx);
      highEnd = byIdx[byIdx.length - 1].i > byIdx[0].i; // Weg laeuft aufwaerts -> Spinner am hohen Ende
    } else if (run.visits.length === 1) {
      const c = run.visits[0].i;
      highEnd = c - run.lo < run.hi - c ? true
        : c - run.lo > run.hi - c ? false : randInt(rng, 2) === 1;
    } else {
      highEnd = randInt(rng, 2) === 1;
    }
    return {
      axis: run.axis,
      dir: highEnd ? -1 : 1,             // Blickrichtung Wand -> Gang
      wall: highEnd ? highWall : lowWall, // Welt-Koordinate der Wandflaeche
      cross,                              // Gangmitte quer (Welt)
      runLen,
      shoot: !!config.shoot,              // ab Level 21: feuert beim Vorlaufen
      // Spike-Deckel: nie den ganzen Gang -- am Einstieg bleibt Luft.
      cap: Math.min(SPINNER.spikeCap * cell,
        runLen - (SPINNER.maxOffset + SPINNER.capMargin) * cell),
      offset: 0,
      spike: 0,
      mode: 'advance',
      alive: true,
      phase: rng() * 2 * Math.PI,
      gx: run.axis === 'x' ? (highEnd ? run.hi : run.lo) : run.fix, // Endkammer
      gy: run.axis === 'x' ? run.fix : (highEnd ? run.hi : run.lo),
    };
  });
}

// Koerper-Mitte (Welt x,z): an der Wand halb versenkt, beim Vorlaufen im Gang.
export function spinnerPos(s) {
  const along = s.wall + s.dir * s.offset;
  return s.axis === 'x' ? [along, s.cross] : [s.cross, along];
}

// Spike-Spitze (Welt x,z).
export function spinnerTip(s) {
  const along = s.wall + s.dir * (s.offset + s.spike);
  return s.axis === 'x' ? [along, s.cross] : [s.cross, along];
}

// Position in Gang-Koordinaten: t = Abstand von der Wand entlang der
// Blickrichtung des Spinners, q = Quer-Abstand von der Gangmitte.
function runCoords(s, x, z) {
  const along = s.axis === 'x' ? x : z;
  const cross = s.axis === 'x' ? z : x;
  return [(along - s.wall) * s.dir, Math.abs(cross - s.cross)];
}

// Ein Simulationsschritt: Spike waechst mit dem Drehen, der Spinner pendelt
// zwischen Vorlaufen (verwundbar) und Rueckzug an die Wand (geschuetzt).
// `prevTip` merkt sich die Spitzen-Lage VOR dem Schritt -- spinnerPlayerHit
// erkennt Aufspiessen als KREUZEN der Spitze (nur die Eigenbewegung des
// Spinners zaehlt hinein; das Kuerzen durch Schuesse passiert nach dem
// Spieler-Check und laesst die zurueckspringende Spitze nie toedlich werden).
export function spinnersStep(spinners, dt, cell) {
  for (const s of spinners) {
    if (!s.alive) continue;
    s.prevTip = s.offset + s.spike;
    s.spike = Math.min(s.cap, s.spike + SPINNER.grow * cell * dt);
    if (s.mode === 'advance') {
      s.offset = Math.min(SPINNER.maxOffset * cell, s.offset + SPINNER.advance * cell * dt);
      if (s.spike >= SPINNER.spikeRetreat * cell) s.mode = 'retreat';
    } else {
      s.offset = Math.max(0, s.offset - SPINNER.retreat * cell * dt);
      if (s.spike <= SPINNER.spikeAdvance * cell) s.mode = 'advance';
    }
  }
}

// Projektil-Treffer an (x,z). Der Spike faengt Schuesse zuerst ab (jeder
// Treffer kuerzt ihn); den Koerper toetet ein Treffer nur beim VORLAUFEN --
// an der Wand prallt er ab ('shield'). Liefert das Ereignis fuer Effekte/
// Sound oder null: { type: 'spike'|'spinner'|'shield', x, z, spinner }.
export function spinnerShotHit(spinners, x, z, cell) {
  for (const s of spinners) {
    if (!s.alive) continue;
    const [t, q] = runCoords(s, x, z);
    if (t < 0) continue; // hinter der Spinner-Wand: die Wand schuetzt
    if (s.spike > 0 && q < SPINNER.spikeHitRadius * cell
      && t >= s.offset && t <= s.offset + s.spike) {
      const [tx, tz] = spinnerTip(s); // Funken an der (alten) Spitze
      s.spike = Math.max(0, s.spike - SPINNER.shorten * cell);
      return { type: 'spike', x: tx, z: tz, spinner: s };
    }
    const [bx, bz] = spinnerPos(s);
    if (Math.hypot(x - bx, z - bz) < SPINNER.shotRadius * cell) {
      if (s.mode === 'advance') {
        s.alive = false;
        return { type: 'spinner', x: bx, z: bz, spinner: s };
      }
      return { type: 'shield', x, z, spinner: s };
    }
  }
  return null;
}

// Spieler-Kollision: Koerper-Beruehrung (rundum) ODER Aufspiessen an der
// SPITZE von vorn. Aufgespiesst wird, wessen Vorderkante die Spitze im
// letzten Schritt entgegen ihrer Richtung kreuzt -- oder in wen die Spitze
// hineinwaechst/-laeuft (beides: g wechselt von >0 auf <=0). Quer wirkt die
// Spitze ueber die halbe Gangbreite (blockRadius) -- frontal gibt es kein
// seitliches Vorbeimogeln. HINTER der Spitze (auf dem Schaft) und beim
// Ueberholen von hinten ist man sicher: der Spike ist eine Einbahn-Sperre.
// `prev` = Spieler-Lage {px,pz} vor dem Schritt (ohne prev: nur die
// Spinner-Bewegung via prevTip kann kreuzen). Liefert
// { x, z, spinner, impale } oder null.
export function spinnerPlayerHit(spinners, px, pz, radius, cell, prev) {
  const ppx = prev?.px ?? px;
  const ppz = prev?.pz ?? pz;
  for (const s of spinners) {
    if (!s.alive) continue;
    const [t, q] = runCoords(s, px, pz);
    // Die Wand schuetzt: der zurueckgezogene Koerper sitzt AUF der Wand-
    // flaeche, und die End-Wand ist duenner als sein Trefferradius -- ohne
    // diese Schranke toetet er den Spieler im Gang DAHINTER durch die Wand.
    // Im eigenen Gang haelt der Kollisionsradius den Spieler stets bei t > 0.
    if (t < 0) continue;
    const [bx, bz] = spinnerPos(s);
    if (Math.hypot(px - bx, pz - bz) < radius + SPINNER.hitRadius * cell) {
      return { x: bx, z: bz, spinner: s, impale: false };
    }
    if (s.spike <= 0) continue;
    if (q >= SPINNER.blockRadius * cell) continue;
    const tip = s.offset + s.spike;
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
  if (!spinners) return null;
  return spinners.filter((s) => s.alive).map((s) => {
    const [x, z] = spinnerPos(s);
    return { x, z, alive: true };
  });
}

// --- Spinner-Schuesse (ab Level 21, config.shoot) -------------------------
// Ein Schuss lebt in Gang-Koordinaten seines Spinners: t = Abstand von der
// Spinner-Wand entlang dir (waechst beim Flug), cross/axis/runLen kopiert.

// Welt-Position (x,z) eines Spinner-Schusses.
export function spinnerShotPos(shot) {
  const along = shot.wall + shot.dir * shot.t;
  return shot.axis === 'x' ? [along, shot.cross] : [shot.cross, along];
}

// Feuern: ein Spinner mit shoot-Flag loest mit fireRate (Wahrscheinlichkeit
// pro Sekunde) einen Schuss von der Spike-Spitze -- aber NUR, wenn der
// Spieler in SEINEM Gang steht und ihn vor sich hat (Blick-Halbebene):
// das Duell, nicht die Ferne. Vorlauf/Rueckzug sind egal -- er sirrt auch
// von der Wand aus. `player` = { px, pz, yaw }. Neue Schuesse werden an
// `shots` angehaengt und (fuer Sound/Effekte) zurueckgegeben. rng haelt
// es deterministisch testbar.
export function spinnerFire(spinners, shots, dt, rng, player, cell) {
  const fired = [];
  const fx = -Math.sin(player.yaw); // Blickrichtung (Konvention wie forward)
  const fz = -Math.cos(player.yaw);
  for (const s of spinners) {
    if (!s.alive || !s.shoot) continue;
    // Spieler im Gang des Spinners? (quer in der Gangbreite, laengs in der
    // Spanne; t < 0 waere der Nachbargang hinter der End-Wand)
    const along = s.axis === 'x' ? player.px : player.pz;
    const crossP = s.axis === 'x' ? player.pz : player.px;
    if (Math.abs(crossP - s.cross) >= 0.5 * cell) continue;
    const tp = (along - s.wall) * s.dir;
    if (tp < 0 || tp > s.runLen) continue;
    // ... und der Spinner liegt VOR dem Spieler (wer wegschaut/flieht,
    // wird nicht in den Ruecken geschossen).
    const [bx, bz] = spinnerPos(s);
    if (fx * (bx - player.px) + fz * (bz - player.pz) <= 0) continue;
    if (rng() >= SPINNER.fireRate * dt) continue;
    const t = s.offset + s.spike;
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
// kein Billboard noetig) plus Spike -- Mittellinie und eine "Bohrer"-Wendel
// darum, die sich mit der Spirale dreht. opts = { cell }.
export function spinnerSegments(s, time, opts) {
  const { cell } = opts;
  const h = SPINNER.height * cell;
  const [bx, bz] = spinnerPos(s);
  const a0 = SPINNER.spin * s.dir * time + s.phase;
  // Punkt im Quer-Schnitt des Gangs: u = quer, v = Hoehe.
  const pt = (u, v, along) => (s.axis === 'x'
    ? [along, h + v, s.cross + u]
    : [s.cross + u, h + v, along]);
  const segs = [];

  // Spirale: 8 Ecken je Windung, Radius waechst linear -- die Ecken springen
  // beim Drehen sichtbar im Oktagon-Raster.
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

  // Spike: Mittellinie plus Wendel (an Koerper und Spitze auf Radius 0).
  if (s.spike > 0.01 * cell) {
    const tipAlong = s.wall + s.dir * (s.offset + s.spike);
    segs.push([pt(0, 0, bodyAlong), pt(0, 0, tipAlong)]);
    const N = Math.max(2, Math.ceil(s.spike / (0.3 * cell)));
    const rr = 0.07 * cell;
    let pv = pt(0, 0, bodyAlong);
    for (let i = 1; i <= N; i++) {
      const f = i / N;
      const r = i === N ? 0 : rr;
      const a = 2 * a0 + i * 2.4;
      const p = pt(r * Math.cos(a), r * Math.sin(a), bodyAlong + s.dir * s.spike * f);
      segs.push([pv, p]);
      pv = p;
    }
  }
  return segs;
}

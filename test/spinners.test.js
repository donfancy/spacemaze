// Tests fuer die Spinner (world/spinners.js): Platzierung an End-Waenden
// langer Gangstuecke, der Vorlauf/Rueckzug-Zyklus, Verwundbarkeit nur beim
// Vorlaufen, Spike-Kuerzen per Treffer, Aufspiessen -- und die DURCHKOMMENS-
// GARANTIE: mit Dauerfeuer bei voller Reisegeschwindigkeit muss man an einem
// Spinner mit maximalem Spike vorbeikommen (Simulation mit den ECHTEN
// Konstanten aus shots.js und drive.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL, OPEN, isChamber, generateMaze } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { createRng } from '../src/util/rng.js';
import { createShotsState, fireShot, shotsStep } from '../src/world/shots.js';
import { DRIVE } from '../src/world/drive.js';
import {
  SPINNER, straightRuns, createSpinners, spinnersStep, spinnerShotHit,
  spinnerPlayerHit, spinnerPos, spinnerTip, spinnerSegments, spinnerMarkers,
  spinnerFire, spinnerShotsStep, spinnerShotPlayerHit, spinnerShotIntercept,
  spinnerShotPos, spinnerShotSegments,
} from '../src/world/spinners.js';

const THIN = { wall: 1, corridor: 5 };

// Hand-Maze: langes Gangstueck (6 Kammern) in Reihe y=1, dazu ein kurzer
// Seitengang auf Spalte x=1 mit S und G -- so liegt die Schutzzone um S/G
// NICHT auf dem langen Gang, und genau ein Spinner-Kandidat bleibt uebrig.
function corridorMaze() {
  const n = 13;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 11; x++) grid[1][x] = OPEN; // langes Gangstueck
  for (let y = 1; y <= 5; y++) grid[y][1] = OPEN;  // Seitengang mit S/G
  return { n, grid, start: [1, 5], goal: [1, 3], seed: 42, metric: createMetric(THIN) };
}

function makeSpinner(seed = 7) {
  const maze = corridorMaze();
  const spinners = createSpinners(maze, { count: 3 }, { unit: 1, cell: 5, rng: createRng(seed) });
  return { maze, spinners };
}

test('straightRuns findet die maximalen geraden Gangstuecke beider Achsen', () => {
  const runs = straightRuns(corridorMaze());
  const long = runs.find((r) => r.axis === 'x' && r.fix === 1 && r.lo === 1 && r.hi === 11);
  const side = runs.find((r) => r.axis === 'z' && r.fix === 1 && r.lo === 1 && r.hi === 5);
  assert.ok(long, 'langes Gangstueck gefunden');
  assert.equal(long.chambers, 6);
  assert.ok(side, 'Seitengang gefunden');
  assert.equal(side.chambers, 3);
});

test('createSpinners: sitzt an einer End-Wand des langen Gangs, S/G-Gang bleibt frei', () => {
  const { spinners } = makeSpinner();
  assert.equal(spinners.length, 1, 'nur der lange Gang ist unbewacht und lang genug');
  const s = spinners[0];
  assert.equal(s.axis, 'x');
  assert.equal(s.cross, 3.5, 'Gangmitte der Reihe y=1');
  assert.equal(s.runLen, 35, '6 Kammern x 5 + 5 Zwischenwaende x 1');
  // Wandflaeche an einem der beiden Enden, Blick in den Gang hinein.
  assert.ok((s.wall === 1 && s.dir === 1) || (s.wall === 36 && s.dir === -1));
  assert.equal(s.cap, Math.min(SPINNER.spikeCap * 5, 35 - (SPINNER.maxOffset + SPINNER.capMargin) * 5));
  assert.equal(s.mode, 'advance');
  assert.equal(s.spike, 0);
  assert.ok(s.alive);
});

test('createSpinners ist deterministisch bei gleichem Seed', () => {
  const a = makeSpinner(11).spinners;
  const b = makeSpinner(11).spinners;
  assert.deepEqual(a, b);
});

test('Platzierung im generierten Level-Maze: End-Wand hinter dem Ruecken, freier Gang voraus', () => {
  const maze = generateMaze(35, { seed: 1234, metric: THIN, straight: 0.7 });
  const cell = 5;
  const spinners = createSpinners(maze, { count: 5 }, { unit: 1, cell, rng: createRng(99) });
  assert.ok(spinners.length > 0 && spinners.length <= 5);
  for (const s of spinners) {
    assert.ok(isChamber(s.gx, s.gy), 'Endzelle ist eine Kammer');
    const [dx, dy] = s.axis === 'x' ? [s.dir, 0] : [0, s.dir];
    // hinter dem Spinner (entgegen der Blickrichtung): Wand oder Rand.
    const bx = s.gx - dx, by = s.gy - dy;
    const behind = bx < 0 || bx >= maze.n || by < 0 || by >= maze.n ? WALL : maze.grid[by][bx];
    assert.equal(behind, WALL, 'hinter der End-Kammer ist Wand');
    // voraus: mindestens minChambers Kammern offen (2 Grid-Zellen je Kammer).
    for (let i = 1; i <= 2 * (SPINNER.minChambers - 1); i++) {
      assert.equal(maze.grid[s.gy + dy * i][s.gx + dx * i], OPEN, 'Gang voraus ist offen');
    }
    assert.ok(!(s.gx === maze.start[0] && s.gy === maze.start[1]), 'nicht auf S');
    assert.ok(!(s.gx === maze.goal[0] && s.gy === maze.goal[1]), 'nicht auf G');
  }
});

test('Zyklus: Spike waechst, ab Schwellenlaenge Rueckzug zur Wand, gekuerzt geht es wieder vor', () => {
  const { spinners } = makeSpinner();
  const s = spinners[0];
  const cell = 5;
  const dt = 1 / 60;

  // Vorlaufen: offset waechst bis maxOffset, Spike waechst mit.
  for (let t = 0; t < 3; t += dt) spinnersStep(spinners, dt, cell);
  assert.equal(s.mode, 'advance');
  assert.ok(Math.abs(s.offset - SPINNER.maxOffset * cell) < 1e-9, 'voll ausgefahren');
  assert.ok(s.spike > 0.8 * cell, 'Spike gewachsen');

  // Weiterdrehen bis zur Rueckzugs-Schwelle.
  for (let t = 0; t < 8 && s.mode === 'advance'; t += dt) spinnersStep(spinners, dt, cell);
  assert.equal(s.mode, 'retreat');
  for (let t = 0; t < 3; t += dt) spinnersStep(spinners, dt, cell);
  assert.equal(s.offset, 0, 'an der Wand angekommen');
  assert.equal(s.spike, s.cap, 'Spike am Deckel (waechst nie ueber cap)');

  // Kuerzen deutlich unter die Vorlauf-Schwelle -> er traut sich wieder vor.
  // (Knapp darunter reicht nicht: im selben Schritt waechst der Spike weiter.)
  s.spike = SPINNER.spikeAdvance * cell - SPINNER.shorten * cell;
  spinnersStep(spinners, dt, cell);
  assert.equal(s.mode, 'advance');
});

test('Schuss-Treffer: Spike faengt ab und wird gekuerzt; Koerper nur beim Vorlaufen toedlich', () => {
  const cell = 5;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 8;
  s.mode = 'retreat';

  // Treffer in der Spike-Spanne: kuerzt um shorten, Funken an der Spitze.
  const [tx, tz] = spinnerTip(s);
  const evSpike = spinnerShotHit(spinners, tx - s.dir * 0.5, tz + 0.2, cell);
  assert.equal(evSpike.type, 'spike');
  assert.equal(evSpike.x, tx);
  assert.equal(s.spike, 8 - SPINNER.shorten * cell);

  // Koerper-Treffer im Rueckzug: prallt ab, Spinner lebt.
  s.spike = 0; // freie Schusslinie zum Koerper
  const [bx, bz] = spinnerPos(s);
  const evShield = spinnerShotHit(spinners, bx, bz, cell);
  assert.equal(evShield.type, 'shield');
  assert.ok(s.alive);

  // Beim Vorlaufen: Abschuss.
  s.mode = 'advance';
  const evKill = spinnerShotHit(spinners, bx, bz, cell);
  assert.equal(evKill.type, 'spinner');
  assert.equal(s.alive, false);

  // Tote Spinner treffen nichts mehr.
  assert.equal(spinnerShotHit(spinners, bx, bz, cell), null);
});

test('Aufspiessen nur von VORN: Kreuzen der Spitze toetet, Schaft und Ueberholen sind sicher', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 8; // Spitze bei t = 10 (Abstand von der Wand)
  const at = (t, dq = 0) => {
    const along = s.wall + s.dir * t;
    return s.axis === 'x' ? { px: along, pz: s.cross + dq } : { px: s.cross + dq, pz: along };
  };
  const hitFrom = (tFrom, tTo, dq = 0) => {
    const b = at(tTo, dq);
    return spinnerPlayerHit(spinners, b.px, b.pz, radius, cell, at(tFrom, dq));
  };

  // Frontal: die Vorderkante kreuzt die Spitze -> aufgespiesst (impale).
  const front = hitFrom(12, 10.5);
  assert.ok(front && front.impale, 'frontal aufgespiesst');
  // Auch hart an der Gangwand: kein seitliches Vorbeimogeln.
  const edge = hitFrom(12, 10.5, 0.49 * cell);
  assert.ok(edge && edge.impale, 'kein seitliches Vorbeimogeln');
  // Parallelgang: sicher.
  assert.equal(hitFrom(12, 10.5, 1.2 * cell), null);
  // Vor der Spitze bleiben (ohne Kreuzen): sicher.
  assert.equal(hitFrom(13, 11.5), null);
  // HINTER der Spitze auf dem Schaft (die alte Todesfalle): sicher.
  const shaft = at(6);
  assert.equal(spinnerPlayerHit(spinners, shaft.px, shaft.pz, radius, cell), null);
  // Ecken-Einstieg von der Seite hinter die Spitze: sicher.
  assert.equal(hitFrom(6, 6, 0), null);
  const enter = spinnerPlayerHit(spinners, shaft.px, shaft.pz, radius, cell, at(6, 1.2 * cell));
  assert.equal(enter, null, 'seitlich auf den Schaft einbiegen ist sicher');
  // Ueberholen von hinten (MIT der Spike-Richtung ueber die Spitze): sicher.
  assert.equal(hitFrom(9, 11.6), null, 'Einbahn-Sperre: von hinten passierbar');

  // Die Spitze waechst/laeuft in den Spieler hinein -> aufgespiesst
  // (Kreuzung durch die Spinner-Bewegung, via prevTip aus spinnersStep).
  const still = at(11.3); // Vorderkante knapp VOR der Spitze
  assert.equal(spinnerPlayerHit(spinners, still.px, still.pz, radius, cell), null, 'noch knapp davor');
  spinnersStep(spinners, 0.1, cell); // Spitze rueckt vor (Wachstum + Vorlauf)
  const grown = spinnerPlayerHit(spinners, still.px, still.pz, radius, cell);
  assert.ok(grown && grown.impale, 'die vorrueckende Spitze spiesst auf');

  // Koerper-Beruehrung bleibt rundum toedlich (ohne impale).
  const [bx, bz] = spinnerPos(s);
  const hitBody = spinnerPlayerHit(spinners, bx + radius, bz, radius, cell);
  assert.ok(hitBody && !hitBody.impale);
});

test('Waende schuetzen: Spinner an der Wand toetet NICHT durch die Wand (Boris\' Bug)', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 0; // zurueckgezogen: Koerper sitzt AUF der Wandflaeche
  s.spike = 8;
  s.mode = 'retreat';
  const at = (t, dq = 0) => {
    const along = s.wall + s.dir * t;
    return s.axis === 'x' ? { px: along, pz: s.cross + dq } : { px: s.cross + dq, pz: along };
  };

  // Spieler drueckt von der ANDEREN Seite gegen die End-Wand: Abstand zum
  // Koerper = Wanddicke (1 Einheit) + Spielerradius -- das ist NAEHER als
  // radius + hitRadius, ohne Wand-Schranke waere er tot.
  const behind = at(-(1 + radius));
  assert.ok(1 + radius < radius + SPINNER.hitRadius * cell, 'Testlage liegt im alten Todesradius');
  assert.equal(spinnerPlayerHit(spinners, behind.px, behind.pz, radius, cell), null,
    'hinter der Wand ist man sicher');

  // Von vorn (im Gang des Spinners) bleibt der Koerper toedlich.
  const front = at(radius + SPINNER.hitRadius * cell - 0.1);
  const hit = spinnerPlayerHit(spinners, front.px, front.pz, radius, cell);
  assert.ok(hit && !hit.impale, 'frontal beruehrt toetet weiterhin');

  // Auch Schuesse aus dem Gang hinter der Wand prallen nicht "durch".
  const shot = at(-1.05);
  assert.equal(spinnerShotHit(spinners, shot.px, shot.pz, cell), null);
});

// Hand-Maze mit Weg-RICHTUNG: S haengt an einem Zweig am niedrigen Ende des
// langen Gangs, G an einem am hohen -- der Weg laeuft den Gang AUFWAERTS.
// Zweige mit 4 Kammern, damit die S/G-Schutzzonen (je 3) nicht bis auf den
// langen Gang reichen.
function directedMaze() {
  const n = 17;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let y = 1; y <= 7; y++) grid[y][1] = OPEN;   // Zweig zu S
  for (let x = 1; x <= 15; x++) grid[7][x] = OPEN;  // langer Gang
  for (let y = 7; y <= 13; y++) grid[y][15] = OPEN; // Zweig zu G
  return { n, grid, start: [1, 1], goal: [15, 13], seed: 9, metric: createMetric(THIN) };
}

test('Auf dem Loesungsweg sitzt der Spinner VORAUS in Laufrichtung -- unabhaengig vom rng', () => {
  for (const seed of [1, 2, 77]) {
    const spinners = createSpinners(directedMaze(), { count: 1 }, { unit: 1, cell: 5, rng: createRng(seed) });
    assert.equal(spinners.length, 1);
    const s = spinners[0];
    assert.equal(s.axis, 'x');
    // Der Weg laeuft den Gang in +x: der Spinner sitzt am HOHEN Ende und
    // blickt dem ankommenden Spieler entgegen (frontale Begegnung).
    assert.equal(s.dir, -1, `Seed ${seed}: blickt dem Spieler entgegen`);
    assert.equal(s.wall, 48, `Seed ${seed}: Wandflaeche hinter Kammer x=15`);
  }
});

test('ENTSCHAERFTE ECKEN-FALLE: hinter der Spitze eingestiegen entkommt man in Spike-Richtung', () => {
  const { spinners } = makeSpinner();
  const s = spinners[0];
  const cell = 5;
  const radius = 0.25 * cell;
  const dt = 1 / 60;
  // Spinner lange gewaehren lassen: Spike am Deckel, zurueckgezogen an der Wand.
  for (let t = 0; t < 60; t += dt) spinnersStep(spinners, dt, cell);

  // Einstieg nahe der Ecke HINTER der Spitze, dann volle Fahrt in Spike-
  // Richtung davon (Boris' Todesfalle) -- OHNE einen einzigen Schuss muss
  // man ueber den Schaft und die Spitze hinweg entkommen (Einbahn-Sperre).
  let along = s.wall + s.dir * 4.0; // knapp ausserhalb des Koerper-Radius
  const out = s.wall + s.dir * (s.runLen - 0.5 * cell); // fernes Gang-Ende
  let hit = null;
  let t = 0;
  for (; t < 20 && s.dir * (out - along) > 0 && !hit; t += dt) {
    const prev = along;
    along += s.dir * DRIVE.cruise * cell * dt;
    spinnersStep(spinners, dt, cell);
    const [px, pz] = s.axis === 'x' ? [along, s.cross] : [s.cross, along];
    const [ppx, ppz] = s.axis === 'x' ? [prev, s.cross] : [s.cross, prev];
    hit = spinnerPlayerHit(spinners, px, pz, radius, cell, { px: ppx, pz: ppz });
  }
  assert.equal(hit, null, 'nicht aufgespiesst');
  assert.ok(s.dir * (out - along) <= 0, `aus dem Gang entkommen (t=${t.toFixed(2)}s)`);
});

test('DURCHKOMMENS-GARANTIE: Dauerfeuer bei Reisegeschwindigkeit ueberwindet den vollen Spike', () => {
  const { maze, spinners } = makeSpinner();
  const s = spinners[0];
  const cell = 5;
  const unit = 1;
  const radius = 0.25 * cell;
  const dt = 1 / 60;

  // Spinner lange gewaehren lassen: Spike am Deckel, zurueckgezogen an der Wand.
  for (let t = 0; t < 60; t += dt) spinnersStep(spinners, dt, cell);
  assert.equal(s.spike, s.cap);
  assert.equal(s.offset, 0);

  // Spieler betritt den Gang am GEGENUEBERLIEGENDEN Ende und faehrt mit
  // Reisegeschwindigkeit frontal auf den Spinner zu -- Dauerfeuer ab Betreten.
  const far = s.wall + s.dir * (s.runLen - 0.5 * cell); // Mitte der fernen Endkammer
  const goalAlong = s.wall + s.dir * 1.2 * cell;        // "durch": letzte Kammer erreicht
  let along = far;
  const yaw = s.axis === 'x'
    ? (s.dir === -1 ? -Math.PI / 2 : Math.PI / 2) // Blick in -dir (auf den Spinner zu)
    : (s.dir === -1 ? Math.PI : 0);
  const pose = () => (s.axis === 'x'
    ? { px: along, pz: s.cross, yaw }
    : { px: s.cross, pz: along, yaw });

  const shotsState = createShotsState();
  let impaled = false;
  let t = 0;
  for (; t < 30 && s.dir * (goalAlong - along) < 0; t += dt) {
    const prev = pose();                       // Lage vor dem Schritt (Kreuzungs-Check)
    along -= s.dir * DRIVE.cruise * cell * dt; // volle Fahrt Richtung Spinner
    fireShot(shotsState, pose(), 0);           // Dauerfeuer (fireShot begrenzt die Rate)
    shotsStep(maze, shotsState, dt, {
      unit, cell, hitTest: (x, z) => spinnerShotHit(spinners, x, z, cell),
    });
    spinnersStep(spinners, dt, cell);
    const p = pose();
    if (spinnerPlayerHit(spinners, p.px, p.pz, radius, cell, prev)) { impaled = true; break; }
  }
  assert.ok(!impaled, `nicht aufgespiesst (bei t=${t.toFixed(2)}s)`);
  assert.ok(s.dir * (goalAlong - along) >= 0, 'letzte Kammer vor der Wand erreicht');
  assert.equal(s.alive, false, 'der vorlaufende Spinner wurde unterwegs abgeschossen');
});

test('OHNE Feuern wird der Spieler aufgespiesst (der Spike ist eine echte Sperre)', () => {
  const { spinners } = makeSpinner();
  const s = spinners[0];
  const cell = 5;
  const radius = 0.25 * cell;
  const dt = 1 / 60;
  for (let t = 0; t < 60; t += dt) spinnersStep(spinners, dt, cell);

  let along = s.wall + s.dir * (s.runLen - 0.5 * cell);
  let impaled = false;
  for (let t = 0; t < 30; t += dt) {
    const prev = along;
    along -= s.dir * DRIVE.cruise * cell * dt;
    spinnersStep(spinners, dt, cell);
    const [px, pz] = s.axis === 'x' ? [along, s.cross] : [s.cross, along];
    const [ppx, ppz] = s.axis === 'x' ? [prev, s.cross] : [s.cross, prev];
    if (spinnerPlayerHit(spinners, px, pz, radius, cell, { px: ppx, pz: ppz })) { impaled = true; break; }
  }
  assert.ok(impaled);
});

test('spinnerSegments: Spirale quer zum Gang auf Spike-Hoehe, Spike bis zur Spitze', () => {
  const cell = 5;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 6;
  const segs = spinnerSegments(s, 0.7, { cell });
  assert.ok(segs.length > 10);
  const h = SPINNER.height * cell;
  let maxSpikeReach = 0;
  for (const [a, b] of segs) {
    for (const p of [a, b]) {
      assert.ok(Math.abs(p[1] - h) <= SPINNER.size * cell + 1e-9, 'Hoehe um die Spike-Ebene');
      const t = (s.axis === 'x' ? p[0] : p[2]) - s.wall;
      maxSpikeReach = Math.max(maxSpikeReach, t * s.dir);
    }
  }
  assert.ok(Math.abs(maxSpikeReach - (s.offset + s.spike)) < 1e-9, 'Spike reicht exakt bis zur Spitze');

  // Ohne Spike: nur die Spirale in der Koerper-Ebene.
  s.spike = 0;
  for (const [a, b] of spinnerSegments(s, 0, { cell })) {
    for (const p of [a, b]) {
      const along = s.axis === 'x' ? p[0] : p[2];
      assert.ok(Math.abs(along - (s.wall + s.dir * s.offset)) < 1e-9, 'alles in der Spiralebene');
    }
  }
});

// --- Spinner-Schuesse (ab Level 21, config.shoot) -------------------------

function makeShootingSpinner(seed = 7) {
  const maze = corridorMaze();
  const spinners = createSpinners(maze, { count: 3, shoot: true }, { unit: 1, cell: 5, rng: createRng(seed) });
  return { maze, spinners };
}

// rng-Stub: "feuert" bei jedem n-ten Aufruf (liefert 0, sonst 0.99) --
// deterministisch und unabhaengig von SPINNER.fireRate.
function fireEvery(n) {
  let calls = 0;
  return () => (++calls % n === 0 ? 0 : 0.99);
}

// Spieler-Lage im Gang des Spinners: Abstand t von dessen Wand, quer dq,
// Blick AUF den Spinner (das Duell -- nur dann feuert er).
function duelPose(s, t, dq = 0) {
  const along = s.wall + s.dir * t;
  const yaw = s.axis === 'x' ? s.dir * Math.PI / 2 : (s.dir === 1 ? 0 : Math.PI);
  return s.axis === 'x'
    ? { px: along, pz: s.cross + dq, yaw }
    : { px: s.cross + dq, pz: along, yaw };
}

test('createSpinners uebernimmt das shoot-Flag aus der Level-Config', () => {
  assert.equal(makeSpinner().spinners[0].shoot, false);
  assert.equal(makeShootingSpinner().spinners[0].shoot, true);
});

test('spinnerFire: nur im Duell (Spieler im Gang, Blick auf den Spinner) -- Stellung egal', () => {
  const cell = 5;
  const { spinners } = makeShootingSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 6;
  const shots = [];
  const duel = duelPose(s, 20);

  // rng() = 0 < fireRate*dt: feuert; der Schuss sitzt an der Spike-Spitze.
  const fired = spinnerFire(spinners, shots, 1 / 60, () => 0, duel, cell);
  assert.equal(fired.length, 1);
  assert.equal(shots.length, 1);
  assert.equal(shots[0].t, s.offset + s.spike);
  assert.deepEqual(spinnerShotPos(shots[0]), spinnerTip(s));
  assert.equal(shots[0].axis, s.axis);
  assert.equal(shots[0].dir, s.dir);

  // Auch ZURUECKGEZOGEN an der Wand feuert er weiter (Boris 14.7.2026:
  // an den Vorlauf gekoppelt schossen alle nur am Level-Anfang).
  s.mode = 'retreat';
  s.offset = 0;
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0, duel, cell).length, 1);

  // rng() = 0.99 >= fireRate*dt: still.
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0.99, duel, cell).length, 0);
  // Spieler im Parallelgang, hinter der End-Wand oder jenseits der Spanne: still.
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(s, 20, 1.2 * cell), cell).length, 0);
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(s, -2), cell).length, 0);
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(s, s.runLen + 3), cell).length, 0);
  // Spieler schaut WEG (Flucht): kein Schuss in den Ruecken.
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0,
    { ...duel, yaw: duel.yaw + Math.PI }, cell).length, 0);
  // Tot oder ohne shoot-Flag: still.
  s.alive = false;
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0, duel, cell).length, 0);
  s.alive = true;
  s.shoot = false;
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0, duel, cell).length, 0);
});

test('spinnerShotsStep: Flug mit shotSpeed die Gangmitte entlang, am fernen Ende Wand-Verpuffen', () => {
  const cell = 5;
  const { spinners } = makeShootingSpinner();
  const s = spinners[0];
  s.offset = 1;
  s.spike = 2;
  const shots = [];
  spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(s, 20), cell);
  const sh = shots[0];

  const t0 = sh.t;
  const events = spinnerShotsStep(shots, 0.1, cell);
  assert.equal(events.length, 0);
  assert.ok(Math.abs(sh.t - (t0 + SPINNER.shotSpeed * cell * 0.1)) < 1e-9, 'Flugtempo stimmt');
  assert.equal(sh.prevT, t0, 'prevT merkt die Lage vor dem Schritt');

  // Bis ans ferne Gang-Ende fliegen lassen: ein 'wall'-Ereignis, Liste leer.
  let wall = null;
  for (let t = 0; t < 10 && !wall; t += 1 / 60) {
    const evs = spinnerShotsStep(shots, 1 / 60, cell);
    if (evs.length) wall = evs[0];
  }
  assert.ok(wall, 'verpufft am Gang-Ende');
  assert.equal(wall.type, 'wall');
  assert.equal(shots.length, 0);
  // Verpuffen AN der fernen Wand (runLen von der Spinner-Wand entfernt).
  const along = s.axis === 'x' ? wall.x : wall.z;
  assert.ok(Math.abs((along - s.wall) * s.dir - s.runLen) < 1e-9);
});

test('spinnerShotPlayerHit: Kreuzen toetet ueber die GANZE Gangbreite, Parallelgang und Wand-Ruecken sicher', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const { spinners } = makeShootingSpinner();
  const s = spinners[0];
  const shots = [];
  s.offset = 1;
  s.spike = 4;
  spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(s, 20), cell); // Schuss bei t = 5
  const sh = shots[0];

  const at = (t, dq = 0) => {
    const along = s.wall + s.dir * t;
    return s.axis === 'x' ? { px: along, pz: s.cross + dq } : { px: s.cross + dq, pz: along };
  };
  const hitFrom = (tFrom, tTo, dq = 0) => {
    const b = at(tTo, dq);
    return spinnerShotPlayerHit(shots, b.px, b.pz, radius, cell, at(tFrom, dq));
  };

  // Frontal auf den Schuss zu: Vorderkante kreuzt -> tot; auch am Gangrand.
  assert.ok(hitFrom(8, 6), 'frontal getroffen');
  assert.ok(hitFrom(8, 6, 0.49 * cell), 'kein seitliches Vorbeimogeln');
  // Parallelgang: sicher.
  assert.equal(hitFrom(8, 6, 1.2 * cell), null);
  // Deutlich vor dem Schuss bleiben: sicher.
  assert.equal(hitFrom(9, 8.5), null);
  // Hinter der Spinner-Wand (Nachbargang): sicher.
  assert.equal(hitFrom(-2, -2), null);

  // Der Schuss fliegt in den stehenden Spieler hinein (prevT-Kreuzung).
  const still = at(sh.t + radius + 0.6);
  assert.equal(spinnerShotPlayerHit(shots, still.px, still.pz, radius, cell), null, 'noch davor');
  spinnerShotsStep(shots, 0.1, cell); // fliegt 1.1 Einheiten weiter
  assert.ok(spinnerShotPlayerHit(shots, still.px, still.pz, radius, cell), 'der Schuss holt ihn ein');
});

test('spinnerShotIntercept: eigenes Projektil faengt den Schuss ab (zap), sonst null', () => {
  const cell = 5;
  const { spinners } = makeShootingSpinner();
  const shots = [];
  spinners[0].offset = 1;
  spinners[0].spike = 4;
  spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(spinners[0], 20), cell);
  const [sx, sz] = spinnerShotPos(shots[0]);

  // Zu weit weg: nichts passiert.
  assert.equal(spinnerShotIntercept(shots, sx + SPINNER.intercept * cell + 0.1, sz, cell), null);
  assert.equal(shots.length, 1);
  // In Reichweite: der Spinner-Schuss stirbt, 'zap' an seiner Position.
  const ev = spinnerShotIntercept(shots, sx + 0.5, sz, cell);
  assert.equal(ev.type, 'zap');
  assert.equal(ev.x, sx);
  assert.equal(ev.z, sz);
  assert.equal(shots.length, 0);
});

test('spinnerShotSegments: Funken-Stern QUER zum Gang an der Schuss-Position', () => {
  const cell = 5;
  const { spinners } = makeShootingSpinner();
  const shots = [];
  spinners[0].offset = 1;
  spinners[0].spike = 4;
  spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(spinners[0], 20), cell);
  const sh = shots[0];
  const [sx, sz] = spinnerShotPos(sh);
  const segs = spinnerShotSegments(sh, 0.3, { cell });
  assert.ok(segs.length >= 5);
  for (const [a, b] of segs) {
    for (const p of [a, b]) {
      const along = sh.axis === 'x' ? p[0] : p[2];
      assert.ok(Math.abs(along - (sh.axis === 'x' ? sx : sz)) < 1e-9, 'alles in der Querschnitts-Ebene');
      assert.ok(Math.abs(p[1] - SPINNER.height * cell) <= SPINNER.shotSize * cell + 1e-9, 'auf Spike-Hoehe');
    }
  }
});

test('DURCHKOMMENS-GARANTIE gilt auch gegen FEUERNDE Spinner: Dauerfeuer faengt die Schuesse ab', () => {
  const { maze, spinners } = makeShootingSpinner();
  const s = spinners[0];
  const cell = 5;
  const unit = 1;
  const radius = 0.25 * cell;
  const dt = 1 / 60;

  for (let t = 0; t < 60; t += dt) spinnersStep(spinners, dt, cell);
  assert.equal(s.spike, s.cap);

  const far = s.wall + s.dir * (s.runLen - 0.5 * cell);
  const goalAlong = s.wall + s.dir * 1.2 * cell;
  let along = far;
  const yaw = s.axis === 'x'
    ? (s.dir === -1 ? -Math.PI / 2 : Math.PI / 2)
    : (s.dir === -1 ? Math.PI : 0);
  const pose = () => (s.axis === 'x'
    ? { px: along, pz: s.cross, yaw }
    : { px: s.cross, pz: along, yaw });

  // Der Spinner feuert im Vorlauf ZUVERLAESSIG alle ~0.75 s (jeder 45. rng-
  // Aufruf bei 60 fps) -- deutlich oefter als real (fireRate 0.3/s), als
  // Stress-Test: das Dauerfeuer muss die Schuesse trotzdem alle abfangen.
  const foeRng = fireEvery(45);
  const foeShots = [];
  const shotsState = createShotsState();
  let dead = null;
  let t = 0;
  for (; t < 30 && s.dir * (goalAlong - along) < 0; t += dt) {
    const prev = pose();
    along -= s.dir * DRIVE.cruise * cell * dt;
    spinnersStep(spinners, dt, cell);
    spinnerFire(spinners, foeShots, dt, foeRng, pose(), cell);
    spinnerShotsStep(foeShots, dt, cell);
    fireShot(shotsState, pose(), 0);
    shotsStep(maze, shotsState, dt, {
      unit, cell,
      hitTest: (x, z) => spinnerShotIntercept(foeShots, x, z, cell)
        ?? spinnerShotHit(spinners, x, z, cell),
    });
    const p = pose();
    dead = spinnerPlayerHit(spinners, p.px, p.pz, radius, cell, prev)
      ?? spinnerShotPlayerHit(foeShots, p.px, p.pz, radius, cell, prev);
    if (dead) break;
  }
  assert.equal(dead, null, `weder aufgespiesst noch abgeschossen (t=${t.toFixed(2)}s)`);
  assert.ok(s.dir * (goalAlong - along) >= 0, 'letzte Kammer vor der Wand erreicht');
});

test('OHNE eigenes Feuer toetet der Spinner-Schuss den Spieler im Gang', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const dt = 1 / 60;
  const { spinners } = makeShootingSpinner();
  const s = spinners[0];

  // Spieler steht weit hinten im Gang (ausserhalb der Spike-Reichweite)
  // und blickt dem Spinner entgegen -- das Duell, in dem er feuern darf.
  const standT = s.runLen - 0.8 * cell;
  const stand = duelPose(s, standT);
  assert.ok(standT > (SPINNER.maxOffset + SPINNER.spikeCap) * cell, 'ausser Spike-Reichweite');

  const foeRng = fireEvery(45);
  const foeShots = [];
  let dead = null;
  for (let t = 0; t < 30 && !dead; t += dt) {
    spinnersStep(spinners, dt, cell);
    spinnerFire(spinners, foeShots, dt, foeRng, stand, cell);
    spinnerShotsStep(foeShots, dt, cell);
    dead = spinnerShotPlayerHit(foeShots, stand.px, stand.pz, radius, cell);
  }
  assert.ok(dead, 'der sirrende Schuss erreicht und toetet den stehenden Spieler');
});

test('spinnerMarkers: nur lebende Spinner, an der Koerper-Position', () => {
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 3;
  const [bx, bz] = spinnerPos(s);
  assert.deepEqual(spinnerMarkers(spinners), [{ x: bx, z: bz, alive: true }]);
  s.alive = false;
  assert.deepEqual(spinnerMarkers(spinners), []);
  assert.equal(spinnerMarkers(null), null);
});

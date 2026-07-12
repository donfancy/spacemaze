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

test('Spieler-Kollision: Spike sperrt den GANZEN Gang, daneben/dahinter ist frei', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 8;
  const mid = s.wall + s.dir * (s.offset + 4); // mitten in der Spike-Spanne

  // Gangmitte: aufgespiesst (Spinner ueberlebt das -- impale).
  const hitMid = spinnerPlayerHit(spinners, mid, s.cross, radius, cell);
  assert.ok(hitMid && hitMid.impale, 'Gangmitte: aufgespiesst');
  // Hart an der Gangwand (q knapp unter halber Gangbreite): trotzdem tot.
  const hitEdge = spinnerPlayerHit(spinners, mid, s.cross + 0.49 * cell, radius, cell);
  assert.ok(hitEdge && hitEdge.impale, 'kein seitliches Vorbeimogeln');
  // Parallelgang (eine Gang+Wand-Breite entfernt): sicher.
  assert.equal(spinnerPlayerHit(spinners, mid, s.cross + 1.2 * cell, radius, cell), null);
  // Vor der Spitze (mit Sicherheitsabstand): noch sicher.
  const before = s.wall + s.dir * (s.offset + s.spike + radius + 0.5);
  assert.equal(spinnerPlayerHit(spinners, before, s.cross, radius, cell), null);
  // Koerper-Beruehrung: Crash ohne impale (der Spinner geht mit drauf).
  const [bx, bz] = spinnerPos(s);
  const hitBody = spinnerPlayerHit(spinners, bx + radius, bz, radius, cell);
  assert.ok(hitBody && !hitBody.impale);
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
    along -= s.dir * DRIVE.cruise * cell * dt; // volle Fahrt Richtung Spinner
    fireShot(shotsState, pose(), 0);           // Dauerfeuer (fireShot begrenzt die Rate)
    shotsStep(maze, shotsState, dt, {
      unit, cell, hitTest: (x, z) => spinnerShotHit(spinners, x, z, cell),
    });
    spinnersStep(spinners, dt, cell);
    const p = pose();
    if (spinnerPlayerHit(spinners, p.px, p.pz, radius, cell)) { impaled = true; break; }
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
    along -= s.dir * DRIVE.cruise * cell * dt;
    spinnersStep(spinners, dt, cell);
    const [px, pz] = s.axis === 'x' ? [along, s.cross] : [s.cross, along];
    if (spinnerPlayerHit(spinners, px, pz, radius, cell)) { impaled = true; break; }
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

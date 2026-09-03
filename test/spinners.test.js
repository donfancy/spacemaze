// Tests fuer die Spinner (world/spinners.js, Sturm-Modell): Platzierung an
// End-Waenden langer Gangstuecke, Wecken durch Annaeherung (Ecken-BFS),
// der Wander-Zyklus (jeder Vorlauf reicht weiter, so waechst der Spike),
// Verwundbarkeit nur "vorne am Spike", Spike-Kuerzen per Treffer, der
// Spike eines toten Spinners bleibt stehen, Aufspiessen -- und die
// DURCHKOMMENS-GARANTIE: mit Dauerfeuer bei voller Reisegeschwindigkeit
// muss man an einem Spinner mit maximalem Spike vorbeikommen (Simulation
// mit den ECHTEN Konstanten aus shots.js und drive.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL, OPEN, isChamber, generateMaze } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { createRng } from '../src/util/rng.js';
import { createShotsState, fireShot, shotsStep } from '../src/world/shots.js';
import { DRIVE } from '../src/world/drive.js';
import {
  SPINNER, createSpinners, spinnersStep, spinnerShotHit, spinnerExposed, spinnerShown,
  spinnerPlayerHit, spinnerPos, spinnerTip, spinnerSegments, spinnerMarkers,
  spinnerFire, spinnerShotsStep, spinnerShotPlayerHit, spinnerShotIntercept,
  spinnerShotPos, spinnerShotSegments, wakeSpinners, spinnerTurnsAway,
} from '../src/world/spinners.js';
import { straightRuns } from '../src/world/foePlacement.js';

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

// Wacher Spinner im Hand-Gang (die Tests unten wollen meist sofort loslegen).
function makeSpinner(seed = 7, { awake = true } = {}) {
  const maze = corridorMaze();
  const spinners = createSpinners(maze, { count: 3 }, { unit: 1, cell: 5, rng: createRng(seed) });
  if (awake) for (const s of spinners) s.active = true;
  return { maze, spinners };
}

// Spinner lange gewaehren lassen (bis zum Deckel dauert es real ~2.5 min:
// die Zyklen werden mit jedem Vorlauf laenger -- "kein Laengenthema", der
// Spieler ist laengst da), dann Spike am Deckel, Koerper an der Wand vor dem
// naechsten Vorlauf (deterministische Ausgangslage fuer Simulationen).
function grow(spinners, cell, seconds = 30) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) spinnersStep(spinners, dt, cell);
  for (const s of spinners) {
    s.spike = s.cap;
    s.offset = 0;
    s.mode = 'advance';
    s.reach = s.cap;
  }
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

test('createSpinners: sitzt an einer End-Wand des langen Gangs, schlaeft, S/G-Gang bleibt frei', () => {
  const { spinners } = makeSpinner(7, { awake: false });
  assert.equal(spinners.length, 1, 'nur der lange Gang ist unbewacht und lang genug');
  const s = spinners[0];
  assert.equal(s.axis, 'x');
  assert.equal(s.cross, 3.5, 'Gangmitte der Reihe y=1');
  assert.equal(s.runLen, 35, '6 Kammern x 5 + 5 Zwischenwaende x 1');
  // Wandflaeche an einem der beiden Enden, Blick in den Gang hinein.
  assert.ok((s.wall === 1 && s.dir === 1) || (s.wall === 36 && s.dir === -1));
  assert.equal(s.cap, 35 - SPINNER.capMargin * 5, 'Deckel: der Einstieg bleibt frei');
  assert.equal(s.mode, 'idle');
  assert.equal(s.active, false, 'schlaeft, bis der Spieler naht');
  assert.equal(s.spike, 0);
  assert.equal(s.offset, 0);
  assert.ok(s.alive);
  assert.equal(s.shoot, undefined, 'kein shoot-Flag mehr: Spinner feuern immer');
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

// Hand-Maze mit ECKEN: langer Gang y=1 (x=1..11), von seinem hohen Ende
// (11,1) ein Stich nach unten bis (11,5), von dort nach links bis (7,5),
// von dort nach unten bis (7,9). S/G liegen auf den letzten beiden Stichen
// (ihre Schutzzonen erreichen den langen Gang nicht).
function zigzagMaze() {
  const n = 13;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 11; x++) grid[1][x] = OPEN;
  for (let y = 1; y <= 5; y++) grid[y][11] = OPEN;
  for (let x = 7; x <= 11; x++) grid[5][x] = OPEN;
  for (let y = 5; y <= 9; y++) grid[y][7] = OPEN;
  return { n, grid, start: [7, 9], goal: [9, 5], seed: 3, metric: createMetric(THIN) };
}

test('Wecken: der Spinner legt erst los, wenn der Spieler hoechstens zwei Ecken entfernt ist', () => {
  const maze = zigzagMaze();
  const cell = 5;
  const spinners = createSpinners(maze, { count: 1 }, { unit: 1, cell, rng: createRng(5) });
  assert.equal(spinners.length, 1, 'der lange Gang traegt den Spinner');
  const s = spinners[0];
  // Zellmitten in Welt-Koordinaten (Metrik: Wand 1, Gang 5, unit 1).
  const center = (g) => (Math.floor(g / 2) * 6 + (g % 2 === 1 ? 1 + 2.5 : 0.5));
  const turns = (gx, gy) => spinnerTurnsAway(maze, s, center(gx), center(gy), 1);
  assert.equal(turns(5, 1), 0, 'im Gang selbst: null Ecken');
  assert.equal(turns(11, 3), 1, 'im ersten Stich: eine Ecke');
  assert.equal(turns(9, 5), 2, 'zweiter Stich: zwei Ecken');
  assert.equal(turns(7, 7), 3, 'dritter Stich: drei Ecken');
  assert.equal(turns(0, 0), -1, 'Wand: unerreichbar');

  // Drei Ecken weit: nichts; der Spinner ruehrt sich nicht.
  assert.deepEqual(wakeSpinners(spinners, maze, center(7), center(7), 1), []);
  assert.equal(s.active, false);
  spinnersStep(spinners, 1, cell);
  assert.equal(s.spike, 0, 'schlafend waechst kein Spike');
  assert.equal(s.offset, 0);
  // Zwei Ecken weit: geweckt -- und ab da laeuft der Zyklus.
  assert.deepEqual(wakeSpinners(spinners, maze, center(9), center(5), 1), [s]);
  assert.equal(s.active, true);
  spinnersStep(spinners, 0.5, cell);
  assert.ok(s.spike > 0, 'geweckt waechst der Spike');
  // Einmal wach bleibt wach (auch wenn der Spieler wieder weg ist).
  assert.deepEqual(wakeSpinners(spinners, maze, center(7), center(9), 1), []);
  assert.equal(s.active, true);
});

test('Wander-Zyklus: jeder Vorlauf reicht um step weiter und schiebt die Spitze vor, Rueckzug bis zur Wand', () => {
  const { spinners } = makeSpinner();
  const s = spinners[0];
  const cell = 5;
  const dt = 1 / 60;

  // Erster Vorlauf bis step, dabei Spitze = Koerper.
  let maxOffset = 0;
  while (s.mode !== 'retreat') {
    spinnersStep(spinners, dt, cell);
    maxOffset = Math.max(maxOffset, s.offset);
    assert.ok(Math.abs(s.spike - s.offset) < 1e-9, 'beim Vorlaufen ist der Koerper die Spitze');
  }
  assert.ok(Math.abs(maxOffset - SPINNER.step * cell) < 1e-9, 'erster Vorlauf reicht step weit');
  // Rueckzug bis zur Wand: die Spitze bleibt stehen.
  while (s.mode === 'retreat') {
    spinnersStep(spinners, dt, cell);
    assert.ok(Math.abs(s.spike - SPINNER.step * cell) < 1e-9, 'Spike bleibt beim Rueckzug');
  }
  assert.equal(s.offset, 0, 'an der Wand angekommen');
  assert.ok(Math.abs(s.reach - 2 * SPINNER.step * cell) < 1e-9, 'naechster Vorlauf um step weiter');
  // Der zweite Vorlauf verlaengert den Spike ueber die alte Spitze hinaus.
  while (s.mode === 'advance') spinnersStep(spinners, dt, cell);
  assert.ok(Math.abs(s.spike - 2 * SPINNER.step * cell) < 1e-9, 'Spike um step gewachsen');
  // Langfristig endet der Spike am Deckel und wandert dort weiter (15 Zyklen
  // zu je 0.65 s pro Einheit Reichweite: ~156 s bis zum Deckel).
  for (let t = 0; t < 200; t += dt) spinnersStep(spinners, dt, cell);
  assert.equal(s.spike, s.cap, 'Spike am Deckel (nie darueber)');
  assert.ok(s.offset >= 0 && s.offset <= s.cap + 1e-9, 'Koerper pendelt innerhalb des Spikes');
  assert.ok(SPINNER.step > SPINNER.shorten * 0.5, 'Wachstum pro Zyklus spuerbar');
});

test('Schuss-Treffer: der Spike faengt ab und wird gekuerzt; der Koerper stirbt nur "vorne am Spike"', () => {
  const cell = 5;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 8;
  s.mode = 'retreat';
  assert.equal(spinnerExposed(s), false, 'hinter der Spitze geschuetzt');

  // Treffer in der Spike-Spanne: kuerzt um shorten, Funken an der Spitze.
  const [tx, tz] = spinnerTip(s);
  const evSpike = spinnerShotHit(spinners, tx - s.dir * 0.5, tz + 0.2, cell);
  assert.equal(evSpike.type, 'spike');
  assert.equal(evSpike.x, tx);
  assert.equal(s.spike, 8 - SPINNER.shorten * cell);

  // Schuss direkt am Koerper, aber der Spike reicht noch darueber hinaus:
  // der Spike faengt ihn ab (kein Schild mehr -- einfach Spike-Kuerzung).
  const [bx, bz] = spinnerPos(s);
  const evBody = spinnerShotHit(spinners, bx, bz, cell);
  assert.equal(evBody.type, 'spike', 'im Spike-Bereich zaehlt der Spike');
  assert.ok(s.alive);

  // Spike unter die Koerperlage gekuerzt: der Koerper ist frei -> Abschuss.
  s.spike = 1.5;
  assert.equal(spinnerExposed(s), true, 'zurueckgedraengt: Koerper frei');
  const evKill = spinnerShotHit(spinners, bx, bz, cell);
  assert.equal(evKill.type, 'spinner');
  assert.equal(s.alive, false);

  // Beim Vorlaufen IST der Koerper die Spitze: dort trifft man ihn direkt.
  const { spinners: two } = makeSpinner();
  const v = two[0];
  v.offset = 6; v.spike = 6; v.mode = 'advance';
  assert.equal(spinnerExposed(v), true);
  const [vx, vz] = spinnerPos(v);
  assert.equal(spinnerShotHit(two, vx, vz, cell).type, 'spinner');
  // An der Wand mit Spike 0: verwundbar (der alte Schild entfaellt).
  const { spinners: three } = makeSpinner();
  const w = three[0];
  const [wx, wz] = spinnerPos(w);
  assert.equal(spinnerShotHit(three, wx, wz, cell).type, 'spinner', 'ohne Spike an der Wand: verwundbar');
});

test('Der Spike eines TOTEN Spinners bleibt stehen: kuerzbar, spiesst auf, aber waechst nicht', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 0; s.spike = 10; s.mode = 'advance'; s.reach = 20;
  s.alive = false;
  assert.equal(spinnerShown(s), true, 'sichtbar bleibt der Spike');
  spinnersStep(spinners, 2, cell);
  assert.equal(s.spike, 10, 'kein Wachstum mehr');
  assert.equal(s.offset, 0, 'kein Wandern mehr');
  // Kuerzbar per Treffer, keine Koerper-Treffer mehr.
  const [tx, tz] = spinnerTip(s);
  assert.equal(spinnerShotHit(spinners, tx - s.dir * 0.3, tz, cell).type, 'spike');
  assert.equal(s.spike, 10 - SPINNER.shorten * cell);
  const [bx, bz] = spinnerPos(s);
  assert.equal(spinnerShotHit(spinners, bx + s.dir * 0.2, bz, cell)?.type ?? 'spike', 'spike',
    'am Koerper zaehlt nur noch der Spike');
  // Die Spitze spiesst weiter auf (Kreuzen von vorn), der Koerper toetet nicht mehr.
  // (Ein Schritt dazwischen: prevTip folgt dem Kuerzen erst im naechsten
  // Frame -- die zurueckspringende Spitze ist nie toedlich, wie immer.)
  spinnersStep(spinners, 1 / 60, cell);
  const at = (t) => (s.axis === 'x' ? { px: s.wall + s.dir * t, pz: s.cross } : { px: s.cross, pz: s.wall + s.dir * t });
  const tip = s.spike;
  const b = at(tip + radius - 0.2);
  const hit = spinnerPlayerHit(spinners, b.px, b.pz, radius, cell, at(tip + radius + 1));
  assert.ok(hit && hit.impale, 'tote Spitze spiesst weiter auf');
  const body = at(radius + 0.1);
  assert.equal(spinnerPlayerHit(spinners, body.px, body.pz, radius, cell), null, 'toter Koerper ist harmlos');
  // Ganz weggeschossen: nichts mehr da.
  s.spike = 0;
  assert.equal(spinnerShown(s), false);
  assert.equal(spinnerMarkers(spinners).length, 0, 'Karte zeigt tote Spinner nicht');
});

test('Aufspiessen nur von VORN: Kreuzen der Spitze toetet, Schaft und Ueberholen sind sicher', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 10; // Spitze bei t = 10 (Abstand von der Wand), Koerper dahinter
  s.mode = 'retreat';
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

  // Der Koerper schiebt die Spitze beim Vorlauf in den stehenden Spieler
  // hinein: im Sturm-Modell IST der Koerper dabei die Spitze -- die
  // Beruehrung toetet (der Koerper-Radius reicht weiter als die Spitze).
  s.offset = 10; s.mode = 'advance'; s.reach = 14; // Koerper an der Spitze, will weiter
  const still = at(13.0); // Vorderkante vor der Spitze, ausserhalb des Koerper-Radius
  assert.equal(spinnerPlayerHit(spinners, still.px, still.pz, radius, cell), null, 'noch knapp davor');
  for (let t = 0; t < 1; t += 0.05) spinnersStep(spinners, 0.05, cell); // Koerper + Spitze ruecken vor
  const grown = spinnerPlayerHit(spinners, still.px, still.pz, radius, cell);
  assert.ok(grown, 'der vorrueckende Spinner erwischt den Stehenden');

  // Koerper-Beruehrung bleibt rundum toedlich (ohne impale).
  s.offset = 2;
  const [bx, bz] = spinnerPos(s);
  const hitBody = spinnerPlayerHit(spinners, bx + radius, bz, radius, cell);
  assert.ok(hitBody && !hitBody.impale);
});

test('Waende schuetzen: Spinner an der Wand toetet NICHT durch die Wand (Boris\' Bug)', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 0; // an der Wand: Koerper sitzt AUF der Wandflaeche
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
  grow(spinners, cell); // Spike am Deckel, Koerper an der Wand vor dem Vorlauf

  // Einstieg nahe der Ecke HINTER der Spitze, dann volle Fahrt in Spike-
  // Richtung davon (Boris' Todesfalle) -- OHNE einen einzigen Schuss muss
  // man ueber den Schaft und die Spitze hinweg entkommen (Einbahn-Sperre;
  // der langsamer vorlaufende Koerper holt einen nicht ein).
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
  assert.ok(SPINNER.advance < DRIVE.cruise, 'der Koerper ist langsamer als die Fahrt');
});

test('DURCHKOMMENS-GARANTIE: Dauerfeuer bei Reisegeschwindigkeit ueberwindet den vollen Spike', () => {
  const { maze, spinners } = makeSpinner();
  const s = spinners[0];
  const cell = 5;
  const unit = 1;
  const radius = 0.25 * cell;
  const dt = 1 / 60;
  grow(spinners, cell);
  assert.equal(s.spike, s.cap);

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
  assert.equal(s.alive, false, 'der freigeschossene Spinner wurde unterwegs abgeschossen');
});

test('OHNE Feuern wird der Spieler aufgespiesst (der Spike ist eine echte Sperre)', () => {
  const { spinners } = makeSpinner();
  const s = spinners[0];
  const cell = 5;
  const radius = 0.25 * cell;
  const dt = 1 / 60;
  grow(spinners, cell);

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

test('spinnerSegments: Spirale quer zum Gang am Koerper, Spike von der Wand bis zur Spitze', () => {
  const cell = 5;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 6;
  const segs = spinnerSegments(s, 0.7, { cell });
  assert.ok(segs.length > 10);
  const h = SPINNER.height * cell;
  let maxSpikeReach = 0;
  let minReach = Infinity;
  for (const [a, b] of segs) {
    for (const p of [a, b]) {
      assert.ok(Math.abs(p[1] - h) <= SPINNER.size * cell + 1e-9, 'Hoehe um die Spike-Ebene');
      const t = ((s.axis === 'x' ? p[0] : p[2]) - s.wall) * s.dir;
      maxSpikeReach = Math.max(maxSpikeReach, t);
      minReach = Math.min(minReach, t);
    }
  }
  assert.ok(Math.abs(maxSpikeReach - s.spike) < 1e-9, 'Spike reicht exakt bis zur Spitze');
  assert.ok(Math.abs(minReach) < 1e-9, 'und beginnt an der Wand');

  // Ohne Spike: nur die Spirale in der Koerper-Ebene.
  s.spike = 0;
  for (const [a, b] of spinnerSegments(s, 0, { cell })) {
    for (const p of [a, b]) {
      const along = s.axis === 'x' ? p[0] : p[2];
      assert.ok(Math.abs(along - (s.wall + s.dir * s.offset)) < 1e-9, 'alles in der Spiralebene');
    }
  }
  // Toter Spinner: nur der Spike, keine Spirale mehr.
  s.spike = 6;
  s.alive = false;
  for (const [a, b] of spinnerSegments(s, 0, { cell })) {
    for (const p of [a, b]) {
      const t = ((s.axis === 'x' ? p[0] : p[2]) - s.wall) * s.dir;
      assert.ok(t >= -1e-9 && t <= s.spike + 1e-9, 'nur noch Spike-Linien');
    }
  }
});

// --- Spinner-Schuesse (immer, aus dem Koerper) ------------------------------

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

test('spinnerFire: nur im Duell (Spieler im Gang, Blick auf den Spinner) -- aus dem Koerper, Stellung egal', () => {
  const cell = 5;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 6;
  const shots = [];
  const duel = duelPose(s, 20);

  // rng() = 0 < fireRate*dt: feuert; der Schuss startet im KOERPER (und
  // fliegt durch den eigenen Spike).
  const fired = spinnerFire(spinners, shots, 1 / 60, () => 0, duel, cell);
  assert.equal(fired.length, 1);
  assert.equal(shots.length, 1);
  assert.equal(shots[0].t, s.offset);
  assert.deepEqual(spinnerShotPos(shots[0]), spinnerPos(s));
  assert.equal(shots[0].axis, s.axis);
  assert.equal(shots[0].dir, s.dir);

  // Auch an der Wand feuert er weiter (Boris 14.7.2026: an den Vorlauf
  // gekoppelt schossen alle nur am Level-Anfang).
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
  // Tot: still (der Spike schiesst nicht).
  s.alive = false;
  assert.equal(spinnerFire(spinners, shots, 1 / 60, () => 0, duel, cell).length, 0);
});

test('spinnerShotsStep: Flug mit shotSpeed die Gangmitte entlang, am fernen Ende Wand-Verpuffen', () => {
  const cell = 5;
  const { spinners } = makeSpinner();
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
  const { spinners } = makeSpinner();
  const s = spinners[0];
  const shots = [];
  s.offset = 5;
  s.spike = 5;
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
  const { spinners } = makeSpinner();
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
  const { spinners } = makeSpinner();
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
  const { maze, spinners } = makeSpinner();
  const s = spinners[0];
  const cell = 5;
  const unit = 1;
  const radius = 0.25 * cell;
  const dt = 1 / 60;
  grow(spinners, cell);
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

  // Der Spinner feuert ZUVERLAESSIG alle 1.5 s (jeder 90. rng-Aufruf bei
  // 60 fps) -- doppelt so oft wie real (fireRate 0.3/s), als Stress-Test:
  // das Dauerfeuer muss die Schuesse trotzdem alle abfangen. (Die alte
  // Vierfach-Rate ist mit Schuessen aus dem KOERPER nicht mehr haltbar:
  // wer dicht hinter der zurueckweichenden Spitze reitet, sieht einen aus
  // dem Spike auftauchenden Schuss nur ~0.1 s -- Boris: "darf knapp werden".)
  const foeRng = fireEvery(90);
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
        ?? spinnerShotHit(spinners, x, z, cell, foeShots),
    });
    const p = pose();
    dead = spinnerPlayerHit(spinners, p.px, p.pz, radius, cell, prev)
      ?? spinnerShotPlayerHit(foeShots, p.px, p.pz, radius, cell, prev);
    if (dead) break;
  }
  assert.equal(dead, null, `weder aufgespiesst noch abgeschossen (t=${t.toFixed(2)}s)`);
  assert.ok(s.dir * (goalAlong - along) >= 0, 'letzte Kammer vor der Wand erreicht');
});

test('Abgeschnittenes Spike-Stueck zerstoert den Spinner-Schuss darin (sonst unabfangbar)', () => {
  const cell = 5;
  const { spinners } = makeSpinner();
  const s = spinners[0];
  s.offset = 2;
  s.spike = 10;
  s.mode = 'retreat';
  const shots = [];
  spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(s, 20), cell); // Schuss startet bei t = 2 (Koerper)
  const sh = shots[0];
  sh.t = 9.0; // im letzten Stueck vor der Spitze (10 - shorten*cell .. 10, plus Abfang-Radius dahinter)
  const [tx, tz] = spinnerTip(s);
  const ev = spinnerShotHit(spinners, tx - s.dir * 0.2, tz, cell, shots);
  assert.equal(ev.type, 'spike');
  assert.equal(ev.zapped, 1, 'der Schuss im abgeschnittenen Stueck ist weg');
  assert.equal(shots.length, 0);
  // Tiefer im Spike (jenseits des Abfang-Radius hinter dem Stueck) ueberlebt er.
  spinnerFire(spinners, shots, 1 / 60, () => 0, duelPose(s, 20), cell);
  shots[0].t = 3;
  const ev2 = spinnerShotHit(spinners, spinnerTip(s)[0] - s.dir * 0.2, tz, cell, shots);
  assert.equal(ev2.type, 'spike');
  assert.equal(ev2.zapped, 0);
  assert.equal(shots.length, 1, 'tief im Spike geschuetzt');
});

test('OHNE eigenes Feuer toetet der Spinner-Schuss den Spieler im Gang', () => {
  const cell = 5;
  const radius = 0.25 * cell;
  const dt = 1 / 60;
  const { spinners } = makeSpinner();
  const s = spinners[0];

  // Spieler steht weit hinten im Gang (ausserhalb der Spike-Reichweite)
  // und blickt dem Spinner entgegen -- das Duell, in dem er feuern darf.
  const standT = s.runLen - 0.8 * cell;
  const stand = duelPose(s, standT);
  assert.ok(standT > s.cap, 'ausser Spike-Reichweite');

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
  const [x, z] = spinnerPos(s);
  assert.deepEqual(spinnerMarkers(spinners), [{ x, z, alive: true }]);
  s.alive = false;
  assert.deepEqual(spinnerMarkers(spinners), []);
  assert.deepEqual(spinnerMarkers(null), null);
});

test('spinnerShotsStep kompaktiert in place: der mittlere von drei verpufft', () => {
  const cell = 5;
  const shots = [
    { axis: 'x', dir: 1, wall: 0, cross: 0, runLen: 100, t: 5, prevT: 5 },
    { axis: 'x', dir: 1, wall: 0, cross: 0, runLen: 100, t: 99.9, prevT: 99.9 },
    { axis: 'x', dir: 1, wall: 0, cross: 0, runLen: 100, t: 7, prevT: 7 },
  ];
  const keep = [shots[0], shots[2]];
  const events = spinnerShotsStep(shots, 0.1, cell);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'wall');
  assert.equal(shots.length, 2);
  assert.equal(shots[0], keep[0]);
  assert.equal(shots[1], keep[1]);
});

// Tests fuer die ZIEL-AUTOMATIK gegen Flipper (world/aimLock.js): Ziel-
// Wahl per getippter Seite, Lenk-Sollwert wie im Autopilot-Duell, Ende des
// Locks (tot/geklappt/hinter mir/fremder Gang), und eine Simulation mit
// den ECHTEN Konstanten: Lock + Dauerfeuer toetet den seitlich
// eingerasteten Flipper, bevor er den Spieler erreicht -- geradeaus
// gefeuert trifft man ihn in der Seiten-Stellung nie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL, OPEN } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { createRng } from '../src/util/rng.js';
import { DRIVE, createDriveState, driveStep } from '../src/world/drive.js';
import { createShotsState, fireShot, shotsStep, SHOTS } from '../src/world/shots.js';
import {
  FLIPPER, createFlippers, flippersStep, flipperShotHit, flipperPlayerHit, flipperAimPoint,
} from '../src/world/flippers.js';
import { alignTurn } from '../src/world/align.js';
import { shortestRoll } from '../src/world/gyro.js';
import { AIM_LOCK, aimTarget, aimTurn } from '../src/world/aimLock.js';

const THIN = { wall: 1, corridor: 5 };
const CELL = 5;
const QUARTER = Math.PI / 2;

// Flipper im Gang entlang z (Gangmitte x=0), 15 Einheiten vor dem Spieler
// im Ursprung (Blick -z). angle QUARTER = rechts (+quer = +x).
function makeFlipper(over = {}) {
  return {
    axis: 'z', cross: 0, along: -15, prevAlong: -15, min: -30, max: 0,
    moveDir: 1, rotDir: 1, mode: 'hold', hold: 99, from: 0, delta: 0,
    flipT: 0, angle: QUARTER, alive: true, rnd: 1, ...over,
  };
}

test('aimTarget: Tipp rechts findet den rechten Flipper, Tipp links nicht -- und den NAECHSTEN', () => {
  const pose = { px: 0, pz: 0, yaw: 0 };
  const right = makeFlipper();
  assert.equal(aimTarget(pose, [right], -1, CELL), right, 'rechts getippt, rechts eingerastet');
  assert.equal(aimTarget(pose, [right], +1, CELL), null, 'links getippt: nichts auf der Seite');
  const left = makeFlipper({ angle: 3 * QUARTER });
  assert.equal(aimTarget(pose, [left], +1, CELL), left, 'links getippt, links eingerastet');
  assert.equal(aimTarget(pose, [left], -1, CELL), null);
  // Zwei rechts: der naehere gewinnt.
  const far = makeFlipper({ along: -25, prevAlong: -25 });
  assert.equal(aimTarget(pose, [far, right], -1, CELL), right, 'naeherer zuerst');
  assert.equal(aimTarget(pose, [], -1, CELL), null);
  assert.equal(aimTarget(pose, null, -1, CELL), null);
});

test('aimTarget: nur ZENTRIERT im Gang -- schraeger Kurs, seitliche Lage oder Lenkausschlag = kein Ziel', () => {
  const f = makeFlipper();
  assert.equal(aimTarget({ px: 0, pz: 0, yaw: 0 }, [f], -1, CELL), f, 'gerade + mittig: Ziel');
  assert.equal(aimTarget({ px: 0, pz: 0, yaw: AIM_LOCK.straight * 1.5 }, [f], -1, CELL), null, 'Kurs schraeg (Kurve)');
  assert.equal(aimTarget({ px: 0, pz: 0, yaw: -AIM_LOCK.straight * 1.5 }, [f], -1, CELL), null, 'Kurs schraeg andersrum');
  assert.equal(aimTarget({ px: 0, pz: 0, yaw: AIM_LOCK.straight * 0.5 }, [f], -1, CELL), f, 'leicht schraeg reicht noch');
  assert.equal(aimTarget({ px: AIM_LOCK.centered * CELL * 1.2, pz: 0, yaw: 0 }, [f], -1, CELL), null, 'zu weit neben der Gangmitte');
  assert.equal(aimTarget({ px: 0, pz: 0, yaw: 0, steer: AIM_LOCK.steerMax * 1.5 }, [f], -1, CELL), null, 'mitten im Lenken');
  assert.equal(aimTarget({ px: 0, pz: 0, yaw: 0, steer: AIM_LOCK.steerMax * 0.5 }, [f], -1, CELL), f, 'kleiner Rest-Ausschlag stoert nicht');
  // Gang entlang x, Blick +x (yaw -PI/2): Kurs-Pruefung achsenrichtig.
  const fx = makeFlipper({ axis: 'x', cross: 0, along: 15, prevAlong: 15, min: 0, max: 30 });
  assert.equal(aimTarget({ px: 0, pz: 0, yaw: -Math.PI / 2 }, [fx], -1, CELL), fx, 'Gang x, gerade');
  assert.equal(aimTarget({ px: 0, pz: 0, yaw: -Math.PI / 2 + 0.5 }, [fx], -1, CELL), null, 'Gang x, schraeg');
});

test('aimTurn: Sollwert = Zielwinkel / deflect auf den Seiten-Trefferpunkt (wie das Autopilot-Duell)', () => {
  const pose = { px: 0, pz: 0, yaw: 0 };
  const f = makeFlipper();
  const [hx, hz] = flipperAimPoint(f, CELL);
  assert.ok(Math.abs(hx - (0.5 - FLIPPER.lift) * CELL) < 1e-12 && hz === -15, 'Trefferpunkt rechts neben der Gangmitte');
  const want = Math.atan2(-hx, -hz) / SHOTS.deflect;
  const t = aimTurn(pose, f, CELL);
  assert.ok(Math.abs(t - want) < 1e-12, 'Sollwert exakt');
  assert.ok(t < 0, 'rechts -> Lenk-Eingabe negativ');
  // Blick schon auf dem Punkt: Sollwert 0.
  const onIt = aimTurn({ px: 0, pz: 0, yaw: Math.atan2(-hx, -hz) }, f, CELL);
  assert.ok(Math.abs(onIt) < 1e-12);
  // Klemmt auf [-1, 1].
  const near = makeFlipper({ along: -2, prevAlong: -2 });
  const tn = aimTurn(pose, near, CELL);
  assert.ok(tn == null || (tn >= -1 && tn <= 1));
});

test('aimTurn: null (Lock endet) bei tot, gezappt, unten/oben/im Flip, hinter mir, fremder Gang, zu weit', () => {
  const pose = { px: 0, pz: 0, yaw: 0 };
  assert.equal(aimTurn(pose, makeFlipper({ alive: false }), CELL), null, 'tot');
  assert.equal(aimTurn(pose, makeFlipper({ zapAt: 1 }), CELL), null, 'gezappt');
  assert.equal(aimTurn(pose, makeFlipper({ angle: 0 }), CELL), null, 'unten');
  assert.equal(aimTurn(pose, makeFlipper({ angle: Math.PI }), CELL), null, 'oben');
  assert.equal(aimTurn(pose, makeFlipper({ mode: 'flip', angle: QUARTER / 2 }), CELL), null, 'im Flip');
  assert.equal(aimTurn(pose, makeFlipper({ along: 5, prevAlong: 5 }), CELL), null, 'hinter mir');
  assert.equal(aimTurn(pose, makeFlipper({ cross: 6 }), CELL), null, 'fremder Gang');
  assert.equal(aimTurn(pose, makeFlipper({ along: -(AIM_LOCK.maxDist + 1) * CELL, min: -99 }), CELL), null, 'zu weit');
  assert.equal(aimTurn(pose, null, CELL), null, 'ohne Ziel');
  // Sehr nah: der Seitenpunkt liegt ausserhalb des Fadenkreuz-Ausschlags.
  assert.equal(aimTurn(pose, makeFlipper({ along: -1, prevAlong: -1 }), CELL), null, 'zu quer');
});

// --- Simulation mit echten Konstanten ------------------------------------------

// Hand-Maze wie in flippers.test.js: langer Gang (6 Kammern) in Reihe y=1,
// Seitengang x=1 mit S und G.
function corridorMaze() {
  const n = 13;
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let x = 1; x <= 11; x++) grid[1][x] = OPEN;
  for (let y = 1; y <= 5; y++) grid[y][1] = OPEN;
  return { n, grid, start: [1, 5], goal: [1, 3], seed: 42, metric: createMetric(THIN) };
}

// Fahrt auf einen seitlich eingerasteten Flipper zu, Dauerfeuer; `lock`
// schaltet die Ziel-Automatik (sonst geradeaus). Liefert { killed,
// hit (Spieler getroffen), bumped, yawErr (Kurs-Fehler beim Abschuss),
// recovered (Kurs-Fehler nach dem Nachrichten) }.
function duelRun(lock) {
  const maze = corridorMaze();
  const flippers = createFlippers(maze, { count: 1 }, { unit: 1, cell: CELL, rng: createRng(7) });
  const f = flippers[0];
  f.mode = 'hold'; f.angle = QUARTER; f.hold = 10; f.flipT = 0; f.moveDir = 1;
  f.along = 8.5; // zweite Kammer, der Spieler kommt von rechts (+x)
  f.prevAlong = f.along;
  const AXIS_YAW = Math.PI / 2; // Blick -x
  const pose = { px: f.along + 4 * CELL, pz: f.cross, yaw: AXIS_YAW };
  const drive = createDriveState();
  drive.vel = DRIVE.cruise;
  const shots = createShotsState();
  const opts = { unit: 1, cell: CELL, radius: 0.25 * CELL };
  const dt = 1 / 60;
  const res = { killed: false, hit: false, bumped: false, yawErr: null, recovered: null };
  // Tipp: Ziel bestimmen (die Seite rechnet der Test selbst aus).
  const dir = aimTarget(pose, flippers, +1, CELL) ? +1 : -1;
  const target = lock ? aimTarget(pose, flippers, dir, CELL) : null;
  if (lock) assert.equal(target, f, 'der Tipp findet den Flipper');
  let phase = lock ? 'aim' : 'none';
  let recoverT = 0;
  for (let t = 0; t < 4; t += dt) {
    let turn = 0;
    if (phase === 'aim') {
      const a = aimTurn(pose, f, CELL);
      if (a != null) turn = a;
      else { phase = 'recover'; recoverT = 0; }
    }
    if (phase === 'recover') {
      recoverT += dt;
      const a = alignTurn(maze, pose, opts);
      if (a == null || Math.abs(a) < AIM_LOCK.recoverDone || recoverT > AIM_LOCK.recoverMax) {
        phase = 'none';
        res.recovered = Math.abs(shortestRoll(pose.yaw - AXIS_YAW));
        break;
      }
      turn = a;
    }
    const prev = { px: pose.px, pz: pose.pz };
    const step = driveStep(maze, drive, pose, turn, dt, opts);
    Object.assign(pose, { px: step.px, pz: step.pz, yaw: step.yaw });
    if (step.collision) res.bumped = true;
    flippersStep(flippers, dt, CELL, pose);
    if (f.alive) fireShot(shots, pose, drive.steer);
    shotsStep(maze, shots, dt, { unit: 1, cell: CELL, hitTest: (x, z, shot) => flipperShotHit(flippers, x, z, CELL, shot) });
    if (!res.killed && !f.alive) {
      res.killed = true;
      res.yawErr = Math.abs(shortestRoll(pose.yaw - AXIS_YAW));
    }
    if (f.alive && flipperPlayerHit(flippers, pose.px, pose.pz, opts.radius, CELL, prev)) { res.hit = true; break; }
    if (!lock && f.mode === 'flip') break; // Gegenprobe: nur die Seiten-Phase zaehlt
  }
  return res;
}

test('Simulation: Tipp + Dauerfeuer toetet den seitlichen Flipper ohne Bump, danach richtet die Automatik gerade', () => {
  const r = duelRun(true);
  assert.equal(r.killed, true, 'Flipper faellt in der Seiten-Stellung');
  assert.equal(r.hit, false, 'Spieler lebt');
  assert.equal(r.bumped, false, 'kein Wandkontakt waehrend des Zielens');
  assert.ok(r.yawErr > 0.02, `das Zielen dreht das Schiff messbar (${r.yawErr.toFixed(3)} rad)`);
  assert.ok(r.recovered != null && r.recovered < 0.1 && r.recovered < r.yawErr,
    `Nachrichten bringt den Kurs zurueck (${r.recovered?.toFixed(3)} rad)`);
});

test('Gegenprobe: geradeaus gefeuert wird der seitlich eingerastete Flipper nie getroffen', () => {
  const r = duelRun(false);
  assert.equal(r.killed, false, 'Gangmitte-Schuesse verfehlen den Seitenpunkt');
});

// --- Durch die echte Szene (playing.js): Tipp, Halten, Gegen-Tipp, Abschuss ---

import { Game } from '../src/core/game.js';
import { State, GameEvent } from '../src/core/states.js';
import { corridorCandidates } from '../src/world/foePlacement.js';
import { unitSize, cellSize } from '../src/scenes/mazeView.js';

function fakeRenderer() {
  return {
    width: 800, height: 600,
    beginFrame() {}, drawText() {}, drawPolylines() {}, renderScene() {},
    worldToScreen() { return { x: 400, y: 300 }; },
    pushSway() {}, popSway() {}, pushShatter() {}, popShatter() {}, flash() {},
  };
}

function advance(game, renderer, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) {
    game.update(dt);
    renderer.beginFrame();
    game.render(renderer);
  }
}

function advanceUntil(game, renderer, state, max = 12) {
  for (let t = 0; t < max && game.stateKey !== state; t += 1 / 60) advance(game, renderer, 1 / 60);
  assert.equal(game.stateKey, state, `Zustand ${state} erreicht`);
}

test('im Spiel: Tipp lenkt automatisch auf den Flipper, Gegen-Tipp bricht ab, Space erledigt ihn', () => {
  const g = new Game();
  const r = fakeRenderer();
  for (let i = 0; i < 20; i++) g.handleKey('ArrowRight'); // Level 21: Fahrt + Feuer + Tanker (Flipper-Liste)
  assert.equal(g.level, 21);
  g.dispatch(GameEvent.START);
  advanceUntil(g, r, State.PLAYING);

  // TELEPORT-Rezept: X zur Karte, Pose setzen, S = Resume faellt an die Pose.
  const maze = g.maze;
  const unit = unitSize(maze);
  const cell = cellSize(maze);
  const run = corridorCandidates(maze, { minChambers: 5, exclude: 3, unit, cell })[0]
    ?? corridorCandidates(maze, { minChambers: 4, exclude: 3, unit, cell })[0];
  assert.ok(run, 'ein langer Gang');
  const along0 = run.min + 0.5 * cell;
  const pose = run.axis === 'x'
    ? { px: along0, pz: run.cross, yaw: -Math.PI / 2 } // Blick +x
    : { px: run.cross, pz: along0, yaw: Math.PI };      // Blick +z
  g.handleKey('X');
  advanceUntil(g, r, State.MAP);
  g.playerState = { ...pose };
  g.handleKey('S');
  advanceUntil(g, r, State.PLAYING);
  // Nur der Flipper zaehlt: die lauernden Tanker/Spinner des Levels raus
  // (dieselben Listen, die die Szene fuehrt -- sonst purzelt eine Alley in den Test).
  g.enemies.length = 0;
  g.spinners?.splice(0);
  const v0 = g.current.viewState();
  assert.ok(Math.abs(v0.px - pose.px) < 1e-6 && Math.abs(v0.pz - pose.pz) < 1e-6, 'an der Pose gelandet');

  // Flipper 3 Gangbreiten voraus, seitlich eingerastet, stillstehend.
  const f = {
    axis: run.axis, cross: run.cross, along: Math.min(along0 + 3 * cell, run.max), prevAlong: Math.min(along0 + 3 * cell, run.max),
    min: run.min, max: run.max, moveDir: 0, rotDir: 1, mode: 'hold', hold: 99,
    from: 0, delta: 0, flipT: 0, angle: QUARTER, alive: true, rnd: 1,
  };
  g.flippers.push(f); // dieselbe Liste, die die Szene fuehrt
  const dir = aimTarget(pose, [f], +1, cell) ? +1 : -1;
  const tapKey = dir > 0 ? 'ArrowLeft' : 'ArrowRight';
  const otherKey = dir > 0 ? 'ArrowRight' : 'ArrowLeft';

  // Tipp (keydown-Flanke, nichts gehalten): die Automatik lenkt zur Flipper-Seite.
  g.handleKey(tapKey);
  advance(g, r, 0.2);
  let v = g.current.viewState();
  assert.ok(Math.sign(v.steer) === dir && Math.abs(v.steer) > 0.05,
    `Automatik lenkt zur Seite (steer ${v.steer.toFixed(3)}, erwartet Vorzeichen ${dir})`);

  // Gegen-Druck, kurz gehalten: JEDER Lenk-Druck beendet den Lock, die
  // Hand dreht das Schiff vom Flipper weg -> danach klingt steer ab und
  // das Fadenkreuz steht deutlich neben dem Trefferpunkt.
  g.keys.add(otherKey);
  g.handleKey(otherKey);
  advance(g, r, 0.15);
  g.keys.delete(otherKey);
  advance(g, r, 0.35);
  v = g.current.viewState();
  assert.ok(Math.abs(v.steer) < 0.02, `ohne Lock faellt der Ausschlag auf 0 (${v.steer.toFixed(3)})`);
  // Fadenkreuz-Fehler in steer-Einheiten: noetiger Sollwert (aimTurn)
  // minus tatsaechlicher Ausschlag -- 0 = das Kreuz liegt auf dem Punkt.
  const crosshairErr = (vs) => {
    const want = aimTurn({ px: vs.px, pz: vs.pz, yaw: vs.yaw }, f, cell);
    return want == null ? null : want - vs.steer;
  };
  const offTarget = crosshairErr(v);
  assert.ok(offTarget != null && Math.abs(offTarget) > 0.1, `Fadenkreuz neben dem Flipper (${offTarget?.toFixed(3)})`);
  assert.equal(f.alive, true, 'noch nichts gefeuert');

  // Erneuter EINZELNER Tipp (pulseGap vorbei): der Lock bringt das
  // Fadenkreuz zurueck auf den Trefferpunkt, Space erledigt ihn.
  g.handleKey(tapKey);
  advance(g, r, 0.25);
  v = g.current.viewState();
  const onTarget = crosshairErr(v);
  assert.ok(onTarget != null && Math.abs(onTarget) < 0.1, `Re-Tipp zielt wieder (${onTarget?.toFixed(3)})`);
  g.keys.add(' ');
  advance(g, r, 0.8);
  g.keys.delete(' ');
  assert.equal(f.alive, false, 'Flipper abgeschossen');
  assert.equal(g.gameOver, false, 'Spieler lebt');
});

test('im Spiel: Puls-Lenken (Tipp kurz nach Tipp) ist kein Zielbefehl -- die Kurve gehoert dem Spieler', () => {
  const g = new Game();
  const r = fakeRenderer();
  for (let i = 0; i < 20; i++) g.handleKey('ArrowRight');
  g.dispatch(GameEvent.START);
  advanceUntil(g, r, State.PLAYING);
  const maze = g.maze;
  const unit = unitSize(maze);
  const cell = cellSize(maze);
  const run = corridorCandidates(maze, { minChambers: 5, exclude: 3, unit, cell })[0]
    ?? corridorCandidates(maze, { minChambers: 4, exclude: 3, unit, cell })[0];
  const along0 = run.min + 0.5 * cell;
  const pose = run.axis === 'x'
    ? { px: along0, pz: run.cross, yaw: -Math.PI / 2 }
    : { px: run.cross, pz: along0, yaw: Math.PI };
  g.handleKey('X');
  advanceUntil(g, r, State.MAP);
  g.playerState = { ...pose };
  g.handleKey('S');
  advanceUntil(g, r, State.PLAYING);
  g.enemies.length = 0;
  g.spinners?.splice(0);
  const f = {
    axis: run.axis, cross: run.cross, along: Math.min(along0 + 4 * cell, run.max), prevAlong: Math.min(along0 + 4 * cell, run.max),
    min: run.min, max: run.max, moveDir: 0, rotDir: 1, mode: 'hold', hold: 99,
    from: 0, delta: 0, flipT: 0, angle: QUARTER, alive: true, rnd: 1,
  };
  g.flippers.push(f);
  const dir = aimTarget(pose, [f], +1, cell) ? +1 : -1;
  const key = dir > 0 ? 'ArrowLeft' : 'ArrowRight';
  // Zwei kurze Druecke hintereinander (wie Puls-Lenken um eine Ecke): der
  // erste startet den Lock, der zweite beendet ihn -- und startet keinen neuen.
  g.keys.add(key); g.handleKey(key); advance(g, r, 0.05); g.keys.delete(key);
  advance(g, r, 0.1);
  g.keys.add(key); g.handleKey(key); advance(g, r, 0.05); g.keys.delete(key);
  advance(g, r, 0.4);
  const v = g.current.viewState();
  assert.ok(Math.abs(v.steer) < 0.02, `kein Lock nach Puls-Lenken (${v.steer.toFixed(3)})`);
});

test('im Spiel: gehaltene Lenktaste ist Handarbeit -- kein Lock nach dem Loslassen', () => {
  const g = new Game();
  const r = fakeRenderer();
  for (let i = 0; i < 20; i++) g.handleKey('ArrowRight');
  g.dispatch(GameEvent.START);
  advanceUntil(g, r, State.PLAYING);
  const maze = g.maze;
  const unit = unitSize(maze);
  const cell = cellSize(maze);
  const run = corridorCandidates(maze, { minChambers: 5, exclude: 3, unit, cell })[0]
    ?? corridorCandidates(maze, { minChambers: 4, exclude: 3, unit, cell })[0];
  const along0 = run.min + 0.5 * cell;
  const pose = run.axis === 'x'
    ? { px: along0, pz: run.cross, yaw: -Math.PI / 2 }
    : { px: run.cross, pz: along0, yaw: Math.PI };
  g.handleKey('X');
  advanceUntil(g, r, State.MAP);
  g.playerState = { ...pose };
  g.handleKey('S');
  advanceUntil(g, r, State.PLAYING);
  // Nur der Flipper zaehlt: die lauernden Tanker/Spinner des Levels raus
  // (dieselben Listen, die die Szene fuehrt -- sonst purzelt eine Alley in den Test).
  g.enemies.length = 0;
  g.spinners?.splice(0);
  const f = {
    axis: run.axis, cross: run.cross, along: Math.min(along0 + 3 * cell, run.max), prevAlong: Math.min(along0 + 3 * cell, run.max),
    min: run.min, max: run.max, moveDir: 0, rotDir: 1, mode: 'hold', hold: 99,
    from: 0, delta: 0, flipT: 0, angle: QUARTER, alive: true, rnd: 1,
  };
  g.flippers.push(f);
  const dir = aimTarget(pose, [f], +1, cell) ? +1 : -1;
  const key = dir > 0 ? 'ArrowLeft' : 'ArrowRight';
  // Taste druecken UND halten (laenger als tapHold) -- wie am Keyboard:
  // keydown fuellt game.keys und ruft handleKey.
  g.keys.add(key);
  g.handleKey(key);
  advance(g, r, AIM_LOCK.tapHold + 0.2);
  g.keys.delete(key);
  advance(g, r, 0.35);
  const v = g.current.viewState();
  assert.ok(Math.abs(v.steer) < 0.02, `nach Handarbeit kein Nachlenken der Automatik (${v.steer.toFixed(3)})`);
});

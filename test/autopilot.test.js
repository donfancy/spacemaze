// Durchkommens-Tests des Autopiloten (Animate-/Attract-Mode): er faehrt mit
// der ECHTEN Spiel-Kinetik (walk.js/drive.js) den Loesungsweg ab und muss
// das Ziel erreichen -- im Tank-Modus (Blockwelt) und im Fahrt-Modus
// (schmale Waende, Auto-Vortrieb). Dazu die Bausteine: Winkel-Wrap und die
// Inverse des gyroTurn-Mappings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../src/world/maze.js';
import { mazeMetric } from '../src/world/metric.js';
import { cellCenter, startFacingYaw, hasLineOfSight } from '../src/world/mazeWorld.js';
import { WALK, createWalkState, walkStep } from '../src/world/walk.js';
import { DRIVE, createDriveState, driveStep } from '../src/world/drive.js';
import { alignTurn } from '../src/world/align.js';
import { inGoalZone } from '../src/world/goal.js';
import { gyroTurn, gyroDirs } from '../src/world/gyro.js';
import { createRng } from '../src/util/rng.js';
import { SHOTS, createShotsState, fireShot, shotsStep } from '../src/world/shots.js';
import {
  FLIPPER, createFlippers, flippersStep, flipperShotHit, flipperPlayerHit,
  flipperPos,
} from '../src/world/flippers.js';
import { QUARTER } from '../src/world/foePlacement.js';
import {
  AUTOPILOT, createAutopilot, autopilotStep, wrapAngle, keyForTurn,
  keyForRole, foeInSight, flipperDuel,
} from '../src/world/autopilot.js';

test('wrapAngle normalisiert auf (-PI, PI]', () => {
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapAngle(-3 * Math.PI) - Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapAngle(0.3) - 0.3) < 1e-12);
  assert.ok(Math.abs(wrapAngle(2 * Math.PI + 0.3) - 0.3) < 1e-12);
});

test('keyForTurn ist die Inverse von gyroTurn (alle Stellungen, beide Richtungen)', () => {
  const dirOf = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  for (let orient = 0; orient < 4; orient++) {
    for (const turn of [1, -1]) {
      const key = keyForTurn(orient, turn);
      assert.equal(gyroTurn(orient, { [dirOf[key]]: true }), turn,
        `orient ${orient}, turn ${turn}: ${key}`);
    }
  }
});

// Tasten-Menge -> dirs, wie playing.js sie aus game.keys liest.
function toDirs(keys) {
  return {
    left: keys.has('ArrowLeft'), right: keys.has('ArrowRight'),
    up: keys.has('ArrowUp'), down: keys.has('ArrowDown'),
  };
}

test('Durchkommens-Garantie Tank-Modus: Ziel erreicht OHNE Wand-Bump (Kurvengefuehl)', () => {
  // Boris' Beobachtung (31.8.2026): der alte Vorausblick zog schon ~0.9
  // Gangbreiten vor der Kurve diagonal auf den Quergang-Punkt -- die
  // Diagonale lief praktisch exakt ueber die Innenecke, ein Bump an JEDER
  // Kurve. Jetzt Pflicht: null Kollisionen auf dem ganzen Weg.
  for (const seed of [7, 99, 4242, 31, 1980]) {
    const maze = generateMaze(11, { seed });
    const unit = 1;
    const cell = mazeMetric(maze).corridor * unit;
    const ap = createAutopilot(maze, { unit, cell });
    const walkState = createWalkState();
    let [px, pz] = cellCenter(maze, maze.start[0], maze.start[1], unit);
    let yaw = startFacingYaw(maze);
    const dt = 1 / 60;
    let reached = false;
    let bumps = 0;
    for (let t = 0; t < 120 && !reached; t += dt) {
      const { keys } = autopilotStep(ap, { px, pz, yaw }, { drive: false });
      const dirs = toDirs(keys);
      const turn = (dirs.left ? 1 : 0) - (dirs.right ? 1 : 0);
      const move = (dirs.up ? 1 : 0) - (dirs.down ? 1 : 0);
      const res = walkStep(maze, walkState, { px, pz, yaw }, { move, turn }, dt, {
        unit, cell, radius: 0.25 * cell,
      });
      ({ px, pz, yaw } = res);
      if (res.collision) bumps++;
      reached = inGoalZone(maze, px, pz, unit, 0.25 * cell);
    }
    assert.ok(reached, `seed ${seed}: Ziel im Tank-Modus erreicht`);
    assert.equal(bumps, 0, `seed ${seed}: keine Wand-Beruehrung auf dem Weg`);
  }
});

test('Durchkommens-Garantie Fahrt-Modus: der Autopilot lenkt durch schmale Waende', () => {
  for (const seed of [7, 99, 4242]) {
    const maze = generateMaze(17, { seed, metric: { wall: 1, corridor: 5 } });
    const unit = 1;
    const cell = mazeMetric(maze).corridor * unit;
    const ap = createAutopilot(maze, { unit, cell });
    const driveState = createDriveState();
    let [px, pz] = cellCenter(maze, maze.start[0], maze.start[1], unit);
    let yaw = startFacingYaw(maze);
    const dt = 1 / 60;
    let reached = false;
    let boosted = false;
    for (let t = 0; t < 240 && !reached; t += dt) {
      const { keys } = autopilotStep(ap, { px, pz, yaw }, { drive: true });
      // Tasten-Interpretation wie playing.js: lenken ODER ausrichten (down),
      // up = Boost ueber targetSpeed.
      const dirs = toDirs(keys);
      const gd = gyroDirs(0, dirs);
      let turn = (gd.left ? 1 : 0) - (gd.right ? 1 : 0);
      if (gd.down && turn === 0) {
        turn = alignTurn(maze, { px, pz, yaw }, { unit, cell }) ?? 0;
      }
      boosted = boosted || gd.up;
      const res = driveStep(maze, driveState, { px, pz, yaw }, turn, dt, {
        unit, cell, radius: 0.25 * cell,
        targetSpeed: gd.up ? DRIVE.boost * DRIVE.cruise : undefined,
      });
      ({ px, pz, yaw } = res);
      reached = inGoalZone(maze, px, pz, unit, 0.25 * cell);
    }
    assert.ok(reached, `seed ${seed}: Ziel im Fahrt-Modus erreicht`);
  }
});

test('Fahrt-Modus: auf gerader Spur wird ausgerichtet statt gelenkt, plus Boost', () => {
  // Handgebauter schnurgerader Weg entlang -z (forward-Konvention: yaw 0).
  const cell = 5;
  const ap = { path: [[0, 0], [0, -6], [0, -12], [0, -18], [0, -24]], idx: 0, cell };
  const { keys, done } = autopilotStep(ap, { px: 0, pz: 0, yaw: 0 }, { drive: true });
  assert.equal(done, false);
  assert.ok(keys.has('ArrowDown'), 'Ausricht-Assistent gedrueckt');
  assert.ok(keys.has('ArrowUp'), 'freie lange Gerade -> Boost');
  assert.ok(!keys.has('ArrowLeft') && !keys.has('ArrowRight'), 'kein Lenk-Zappeln');
});

test('Fahrt-Modus: vor der Kurve kein Boost, in der Kurve wird gelenkt', () => {
  const cell = 5;
  // Nach einem Wegpunkt knickt der Weg nach +x ab.
  const ap = { path: [[0, 0], [0, -6], [6, -6], [12, -6]], idx: 0, cell };
  const near = autopilotStep(ap, { px: 0, pz: 0, yaw: 0 }, { drive: true });
  assert.ok(!near.keys.has('ArrowUp'), 'Kurve voraus -> kein Boost');
  // Mitten vor der Kurve zeigt der Vorausblick um die Ecke -> selbst lenken.
  ap.idx = 1;
  const turning = autopilotStep(ap, { px: 0, pz: -5, yaw: 0 }, { drive: true });
  assert.ok(turning.keys.has('ArrowLeft') || turning.keys.has('ArrowRight'),
    'grosser Kurswinkel -> Autopilot lenkt selbst');
});

test('keyForRole ist die Inverse von gyroDirs (Boost/Ausrichten unter Verdrehung)', () => {
  const dirOf = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  for (let orient = 0; orient < 4; orient++) {
    for (const role of ['up', 'down']) {
      const key = keyForRole(orient, role);
      assert.equal(gyroDirs(orient, { [dirOf[key]]: true })[role], true,
        `orient ${orient}, role ${role}: ${key}`);
    }
  }
});

test('foeInSight: nah + im Blickkegel ja, hinter dem Ruecken / zu fern nein', () => {
  const cell = 5;
  const pose = { px: 0, pz: 0, yaw: 0 }; // Blick nach -z
  assert.equal(foeInSight(pose, [[0, -10]], cell), true, 'voraus im Gang');
  assert.equal(foeInSight(pose, [[0, 10]], cell), false, 'hinter dem Ruecken');
  assert.equal(foeInSight(pose, [[0, -(AUTOPILOT.fireDist + 1) * cell]], cell), false, 'zu fern');
  assert.equal(foeInSight(pose, [[20, -10]], cell), false, 'weit seitlich (Nachbargang)');
  assert.equal(foeInSight(pose, null, cell), false, 'ohne Ziele nie');
});

test('gefeuert wird nur bei Feind in Sicht -- kein Dauerfeuer mehr', () => {
  const cell = 5;
  const ap = { path: [[0, 0], [0, -6], [0, -12], [0, -18], [0, -24]], idx: 0, cell };
  const pose = { px: 0, pz: 0, yaw: 0 };
  const quiet = autopilotStep(ap, pose, { drive: true, shoot: true, foes: [] });
  assert.ok(!quiet.keys.has(' '), 'nichts in Sicht -> Feuer aus');
  assert.ok(quiet.keys.has('ArrowUp'), 'stattdessen wird geboostet');
  ap.idx = 0;
  const duel = autopilotStep(ap, pose, { drive: true, shoot: true, foes: [[0, -12]] });
  assert.ok(duel.keys.has(' '), 'Feind voraus -> Feuer');
  assert.ok(!duel.keys.has('ArrowUp'), 'im Duell kein Boost');
});

// Flipper-Baustein fuer die Duell-Tests: wandert im Gang entlang z
// (cross = x des Gangs), Spieler-Konvention yaw 0 = Blick nach -z.
function makeDuelFlipper(over = {}) {
  return {
    axis: 'z', cross: 0, along: -15, prevAlong: -15, min: -30, max: 0,
    moveDir: 1, rotDir: 1, mode: 'hold', hold: 99, from: 0, delta: 0,
    flipT: 0, angle: QUARTER, alive: true, rnd: 1, ...over,
  };
}

test('flipperDuel: seitlich eingerastet -> Ziel-steer auf den Seitenpunkt', () => {
  const cell = 5;
  const pose = { px: 0, pz: 0, yaw: 0 };
  const f = makeDuelFlipper(); // angle QUARTER = rechts (+x)
  const duel = flipperDuel(pose, [f], cell);
  assert.ok(duel, 'Flipper voraus im Gang wird erkannt');
  // Trefferpunkt (0.5 - lift) Gangbreiten in +x: zielen heisst RECHTS
  // ausschlagen (steer negativ), Betrag = Zielwinkel / deflect.
  const q = (0.5 - FLIPPER.lift) * cell;
  const aim = Math.atan2(-q, 15);
  assert.ok(Math.abs(duel.aim - aim) < 1e-12, 'Zielwinkel auf den Seitenpunkt');
  assert.ok(Math.abs(duel.steer - aim / SHOTS.deflect) < 1e-12, 'steer = Winkel/deflect');
  assert.ok(duel.steer < 0, 'Punkt rechts -> steer negativ');
  // Links-Stellung spiegelt das Vorzeichen.
  const links = flipperDuel(pose, [makeDuelFlipper({ angle: 3 * QUARTER })], cell);
  assert.ok(links.steer > 0, 'Punkt links -> steer positiv');
});

test('flipperDuel: unten/oben/im Flip untreffbar (steer null), fremder Gang null', () => {
  const cell = 5;
  const pose = { px: 0, pz: 0, yaw: 0 };
  const flach = flipperDuel(pose, [makeDuelFlipper({ angle: 0 })], cell);
  assert.ok(flach && flach.steer === null, 'unten eingerastet: erkannt, aber kein Ziel');
  const flip = flipperDuel(pose, [makeDuelFlipper({ mode: 'flip' })], cell);
  assert.ok(flip && flip.steer === null, 'mitten im Flip: erkannt, aber kein Ziel');
  assert.equal(flipperDuel(pose, [makeDuelFlipper({ cross: 6 })], cell), null,
    'Nachbargang (Quer-Fenster) ist kein Duell');
  assert.equal(flipperDuel(pose, [makeDuelFlipper({ alive: false })], cell), null,
    'tote Flipper zaehlen nicht');
  assert.equal(flipperDuel(pose, [makeDuelFlipper({
    along: -(AUTOPILOT.fireDist + 1) * cell, min: -99,
  })], cell), null, 'zu fern');
  assert.equal(flipperDuel(pose, null, cell), null, 'ohne Flipper-Liste nie');
});

test('Duell-Tasten: zielen statt ausrichten, Feuer erst mit Fadenkreuz am Punkt', () => {
  const cell = 5;
  const ap = { path: [[0, 0], [0, -6], [0, -12], [0, -18], [0, -24]], idx: 0, cell };
  const f = makeDuelFlipper();
  const pose = { px: 0, pz: 0, yaw: 0 };
  // steer noch 0: er lenkt RECHTS auf den Sollwert zu und feuert noch nicht
  // (das Fadenkreuz zeigt die Gangmitte -- der Schuss wuerde verfehlen).
  const start = autopilotStep(ap, pose, {
    drive: true, shoot: true, steer: 0, flippers: [f], foes: [],
  });
  assert.ok(start.keys.has('ArrowRight'), 'Ziel-Regelung lenkt zum Seitenpunkt');
  assert.ok(!start.keys.has('ArrowDown'), 'Duell ersetzt den Ausricht-Assistenten');
  assert.ok(!start.keys.has('ArrowUp'), 'im Duell kein Boost');
  assert.ok(!start.keys.has(' '), 'Fadenkreuz noch nicht am Punkt -> kein Feuer');
  // steer auf dem Sollwert: Feuer frei, keine weitere Lenk-Korrektur.
  ap.idx = 0;
  const duel = flipperDuel(pose, [f], cell);
  const ready = autopilotStep(ap, pose, {
    drive: true, shoot: true, steer: duel.steer, flippers: [f], foes: [],
  });
  assert.ok(ready.keys.has(' '), 'Fadenkreuz am Punkt -> Feuer');
  assert.ok(!ready.keys.has('ArrowLeft') && !ready.keys.has('ArrowRight'),
    'steer stimmt -> keine Lenk-Korrektur');
  // Untreffbar geklappt: normal weiterfahren (align), aber kein Boost, kein Feuer.
  ap.idx = 0;
  const wait = autopilotStep(ap, pose, {
    drive: true, shoot: true, steer: 0, flippers: [makeDuelFlipper({ angle: 0 })], foes: [],
  });
  assert.ok(wait.keys.has('ArrowDown'), 'untreffbar -> Ausricht-Assistent faehrt weiter');
  assert.ok(!wait.keys.has('ArrowUp'), 'untreffbarer Flipper voraus -> kein Boost');
  assert.ok(!wait.keys.has(' '), 'kein sinnloses Feuer auf die flache Stellung');
});

test('Drive-by: Flipper hinter der Kurve lenkt nicht ab, gefeuert wird trotzdem', () => {
  const cell = 5;
  // Weg knickt erst bei [0,-20] ab; der Flipper lauert klar dahinter bei
  // -26 (mehr als die halbe Gangbreite Duell-Marge hinter dem Knick).
  const ap = { path: [[0, 0], [0, -10], [0, -20], [6, -20]], idx: 0, cell };
  const f = makeDuelFlipper({ along: -26, min: -30, max: -15 });
  // Fadenkreuz neutral: kein Ziel-Lenken (Knick-Deckel), normale Fahrt.
  const cruise = autopilotStep(ap, { px: 0, pz: 0, yaw: 0 }, {
    drive: true, shoot: true, steer: 0, flippers: [f], foes: [],
  });
  assert.ok(cruise.keys.has('ArrowDown'), 'Flipper hinterm Knick: Ausricht-Assistent faehrt');
  assert.ok(!cruise.keys.has('ArrowLeft') && !cruise.keys.has('ArrowRight'),
    'keine Ziel-Lenkung auf einen Flipper hinter der eigenen Abbiegung');
  assert.ok(!cruise.keys.has(' '), 'Fadenkreuz neutral -> Punkt verfehlt -> kein Schuss');
  // Steht das Fadenkreuz (steer eingelenkt) zufaellig auf dem Trefferpunkt,
  // geht der Drive-by-Schuss raus -- unabhaengig vom Lenk-Zustand.
  ap.idx = 0;
  const duel = flipperDuel({ px: 0, pz: 0, yaw: 0 }, [f], cell);
  const swing = autopilotStep(ap, { px: 0, pz: 0, yaw: 0 }, {
    drive: true, shoot: true, steer: duel.aim / SHOTS.deflect, flippers: [f], foes: [],
  });
  assert.ok(swing.keys.has(' '), 'Fadenkreuz streicht ueber den Punkt -> Drive-by-Schuss');
});

test('Durchkommens-Garantie Flipper-Duell: der Autopilot schiesst sich den Weg frei', () => {
  // Volle Fahrt-Simulation mit ECHTEN Flippern (Platzierung wie im Spiel:
  // lange Gaenge, Weg zuerst): der Autopilot muss jeden Weg-Flipper im
  // Duell abschiessen -- die Ebene ist toedlich, vorbeimogeln gibt es nicht.
  for (const seed of [7, 99, 4242]) {
    const maze = generateMaze(27, { seed, metric: { wall: 1, corridor: 5 }, straight: 0.8 });
    const unit = 1;
    const cell = mazeMetric(maze).corridor * unit;
    const radius = 0.25 * cell;
    const ap = createAutopilot(maze, { unit, cell });
    const flippers = createFlippers(maze, { count: 3 }, {
      unit, cell, rng: createRng((seed ^ 0x85ebca6b) >>> 0),
    });
    assert.ok(flippers.length >= 1, `seed ${seed}: das Maze traegt Flipper`);
    const driveState = createDriveState();
    const shotsState = createShotsState();
    let [px, pz] = cellCenter(maze, maze.start[0], maze.start[1], unit);
    let yaw = startFacingYaw(maze);
    const dt = 1 / 60;
    let reached = false;
    let dead = null;
    for (let t = 0; t < 240 && !reached && !dead; t += dt) {
      // Naht wie playing.js: nur Flipper MIT Sichtlinie erreichen das Duell.
      const { keys } = autopilotStep(ap, { px, pz, yaw }, {
        drive: true, shoot: true, steer: driveState.steer,
        flippers: flippers.filter((f) => hasLineOfSight(maze, px, pz, ...flipperPos(f), unit)),
        foes: [],
      });
      const dirs = toDirs(keys);
      const gd = gyroDirs(0, dirs);
      let turn = (gd.left ? 1 : 0) - (gd.right ? 1 : 0);
      if (gd.down && turn === 0) {
        turn = alignTurn(maze, { px, pz, yaw }, { unit, cell }) ?? 0;
      }
      const prev = { px, pz };
      const res = driveStep(maze, driveState, { px, pz, yaw }, turn, dt, {
        unit, cell, radius,
        targetSpeed: gd.up ? DRIVE.boost * DRIVE.cruise : undefined,
      });
      ({ px, pz, yaw } = res);
      flippersStep(flippers, dt, cell);
      if (keys.has(' ')) fireShot(shotsState, { px, pz, yaw }, driveState.steer);
      shotsStep(maze, shotsState, dt, {
        unit, cell, hitTest: (x, z) => flipperShotHit(flippers, x, z, cell),
      });
      dead = flipperPlayerHit(flippers, px, pz, radius, cell, prev);
      reached = inGoalZone(maze, px, pz, unit, 0.25 * cell);
    }
    assert.equal(dead, null, `seed ${seed}: kein Tod an der Flipper-Ebene`);
    assert.ok(reached, `seed ${seed}: Ziel trotz Flippern erreicht`);
  }
});

test('am Ziel meldet der Autopilot done und laesst die Tasten los', () => {
  const maze = generateMaze(9, { seed: 5 });
  const unit = 1;
  const cell = mazeMetric(maze).corridor * unit;
  const ap = createAutopilot(maze, { unit, cell });
  const [gx, gz] = cellCenter(maze, maze.goal[0], maze.goal[1], unit);
  const { keys, done } = autopilotStep(ap, { px: gx, pz: gz, yaw: 0 }, { drive: false, shoot: true });
  assert.equal(done, true);
  assert.equal(keys.size, 0, 'kein Lenken, kein Feuern mehr');
  assert.ok(AUTOPILOT.lookahead > AUTOPILOT.advance, 'Vorausblick liegt vor dem Aufruecken');
});

// Durchkommens-Tests des Autopiloten (Animate-/Attract-Mode): er faehrt mit
// der ECHTEN Spiel-Kinetik (walk.js/drive.js) den Loesungsweg ab und muss
// das Ziel erreichen -- im Tank-Modus (Blockwelt) und im Fahrt-Modus
// (schmale Waende, Auto-Vortrieb). Dazu die Bausteine: Winkel-Wrap und die
// Inverse des gyroTurn-Mappings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../src/world/maze.js';
import { mazeMetric } from '../src/world/metric.js';
import { cellCenter, startFacingYaw } from '../src/world/mazeWorld.js';
import { WALK, createWalkState, walkStep } from '../src/world/walk.js';
import { DRIVE, createDriveState, driveStep } from '../src/world/drive.js';
import { alignTurn } from '../src/world/align.js';
import { inGoalZone } from '../src/world/goal.js';
import { gyroTurn, gyroDirs } from '../src/world/gyro.js';
import {
  AUTOPILOT, createAutopilot, autopilotStep, wrapAngle, keyForTurn,
  keyForRole, foeInSight,
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

test('Durchkommens-Garantie Tank-Modus: der Autopilot erreicht das Ziel (Blockwelt)', () => {
  for (const seed of [7, 99, 4242]) {
    const maze = generateMaze(11, { seed });
    const unit = 1;
    const cell = mazeMetric(maze).corridor * unit;
    const ap = createAutopilot(maze, { unit, cell });
    const walkState = createWalkState();
    let [px, pz] = cellCenter(maze, maze.start[0], maze.start[1], unit);
    let yaw = startFacingYaw(maze);
    const dt = 1 / 60;
    let reached = false;
    for (let t = 0; t < 120 && !reached; t += dt) {
      const { keys } = autopilotStep(ap, { px, pz, yaw }, { drive: false });
      const dirs = toDirs(keys);
      const turn = (dirs.left ? 1 : 0) - (dirs.right ? 1 : 0);
      const move = (dirs.up ? 1 : 0) - (dirs.down ? 1 : 0);
      const res = walkStep(maze, walkState, { px, pz, yaw }, { move, turn }, dt, {
        unit, cell, radius: 0.25 * cell,
      });
      ({ px, pz, yaw } = res);
      reached = inGoalZone(maze, px, pz, unit, 0.25 * cell);
    }
    assert.ok(reached, `seed ${seed}: Ziel im Tank-Modus erreicht`);
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

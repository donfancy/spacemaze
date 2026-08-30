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
import { createDriveState, driveStep } from '../src/world/drive.js';
import { inGoalZone } from '../src/world/goal.js';
import { gyroTurn } from '../src/world/gyro.js';
import {
  AUTOPILOT, createAutopilot, autopilotStep, wrapAngle, keyForTurn,
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
    for (let t = 0; t < 240 && !reached; t += dt) {
      const { keys } = autopilotStep(ap, { px, pz, yaw }, { drive: true });
      const turn = gyroTurn(0, toDirs(keys));
      const res = driveStep(maze, driveState, { px, pz, yaw }, turn, dt, {
        unit, cell, radius: 0.25 * cell,
      });
      ({ px, pz, yaw } = res);
      reached = inGoalZone(maze, px, pz, unit, 0.25 * cell);
    }
    assert.ok(reached, `seed ${seed}: Ziel im Fahrt-Modus erreicht`);
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

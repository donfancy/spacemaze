// Tests fuer das Schiessen (world/shots.js): Tempest-Regel (max 8 unterwegs,
// Dauerfeuer mit Feuerrate), Zielrichtung mit Lenk-Ausschlag, Verpuffen an
// Waenden (auch schmalen, ohne Tunneln) und Feind-Treffer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../src/world/maze.js';
import { cellCenter, isWalkable, startFacingYaw } from '../src/world/mazeWorld.js';
import {
  SHOTS, createShotsState, aimYaw, fireShot, shotsStep, shotSegments,
} from '../src/world/shots.js';

const THIN = { wall: 1, corridor: 5 };
const UNIT = 1;
const CELL = THIN.corridor * UNIT;

function makeWorld(seed = 4711) {
  const maze = generateMaze(17, { seed, metric: THIN });
  const [px, pz] = cellCenter(maze, maze.start[0], maze.start[1], UNIT);
  return { maze, px, pz };
}

test('aimYaw: geradeaus exakt die Blickrichtung, Lenken schlaegt mit aus', () => {
  assert.equal(aimYaw(1.2, 0), 1.2);
  // Links lenken (steer positiv) -> yaw waechst -> Fadenkreuz weiter links.
  assert.ok(aimYaw(1.2, 1) > 1.2);
  assert.ok(aimYaw(1.2, -1) < 1.2);
  assert.equal(aimYaw(0, 1), SHOTS.deflect);
});

test('fireShot: Feuerrate begrenzt Dauerfeuer, Richtung ist die Zielrichtung', () => {
  const state = createShotsState();
  assert.equal(fireShot(state, { px: 0, pz: 0, yaw: 0 }, 0), true);
  assert.equal(state.shots.length, 1);
  assert.equal(fireShot(state, { px: 0, pz: 0, yaw: 0 }, 0), false, 'Cooldown blockt');
  assert.ok(state.cooldown > 0);
  // Richtung: yaw 0 -> Flug entlang -z (Einheitsvektor).
  const s = state.shots[0];
  assert.ok(Math.abs(s.dx) < 1e-12 && Math.abs(s.dz + 1) < 1e-12);
  // Mit Lenk-Ausschlag weicht die Flugbahn ab.
  const state2 = createShotsState();
  fireShot(state2, { px: 0, pz: 0, yaw: 0 }, 1);
  assert.ok(Math.abs(state2.shots[0].dx + Math.sin(SHOTS.deflect)) < 1e-12);
});

test('Tempest-Regel: nie mehr als 8 Projektile unterwegs', () => {
  const state = createShotsState();
  for (let i = 0; i < 20; i++) {
    state.cooldown = 0; // Feuerrate ausblenden, nur das Limit testen
    fireShot(state, { px: 0, pz: 0, yaw: 0 }, 0);
  }
  assert.equal(state.shots.length, SHOTS.max);
  assert.equal(state.shots.length, 8);
});

test('Projektile verpuffen an der Wand (Ereignis) und geben den Slot frei', () => {
  const { maze, px, pz } = makeWorld();
  const state = createShotsState();
  // In alle vier Richtungen feuern -- irgendwo kommt immer eine Wand.
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    state.cooldown = 0;
    fireShot(state, { px, pz, yaw }, 0);
  }
  const events = [];
  for (let i = 0; i < 400 && state.shots.length > 0; i++) {
    events.push(...shotsStep(maze, state, 0.016, { unit: UNIT, cell: CELL }));
  }
  assert.equal(state.shots.length, 0, 'alle Projektile sind verpufft');
  assert.ok(events.length >= 4 && events.every((e) => e.type === 'wall'));
  // Verpuff-Position liegt IM Gang (letzte offene Position, nicht in der Wand).
  for (const e of events) {
    assert.ok(isWalkable(maze, e.x, e.z, UNIT), 'Verpuffen an, nicht in der Wand');
  }
  // Slots wieder frei: es darf erneut gefeuert werden.
  state.cooldown = 0;
  assert.equal(fireShot(state, { px, pz, yaw: 0 }, 0), true);
});

test('kein Tunneln durch schmale Waende bei grossem dt', () => {
  const { maze, px, pz } = makeWorld();
  const state = createShotsState();
  fireShot(state, { px, pz, yaw: 0 }, 0); // Start ist eine Sackgasse: -z fuehrt frueh in eine Wand
  let events = [];
  for (let i = 0; i < 100 && state.shots.length > 0; i++) {
    events.push(...shotsStep(maze, state, 0.1, { unit: UNIT, cell: CELL })); // dt = Clamp-Maximum
  }
  assert.equal(state.shots.length, 0);
  assert.equal(events.length, 1);
  assert.ok(isWalkable(maze, events[0].x, events[0].z, UNIT),
    'auch mit dt=0.1 endet der Schuss VOR der schmalen Wand');
});

test('Feind-Treffer: Raute stirbt, Ereignis gemeldet, Projektil weg', () => {
  const { maze, px, pz } = makeWorld();
  const state = createShotsState();
  // In den offenen Gang schiessen (der Start ist eine Sackgasse) ...
  const yaw = startFacingYaw(maze);
  fireShot(state, { px, pz, yaw }, 0);
  // ... mit einem Fake-Feind direkt in der Flugbahn (1 Gangbreite voraus).
  const enemy = { x: px - Math.sin(yaw) * CELL, z: pz - Math.cos(yaw) * CELL, alive: true };
  const events = [];
  for (let i = 0; i < 50 && state.shots.length > 0; i++) {
    events.push(...shotsStep(maze, state, 0.016, {
      unit: UNIT, cell: CELL, enemies: [enemy], enemyRadius: 0.4 * CELL,
    }));
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'enemy');
  assert.equal(events[0].enemy, enemy);
  assert.equal(enemy.alive, false, 'weg ist weg');
  assert.equal(state.shots.length, 0);
});

test('Sicherheits-Lebensdauer: uralte Projektile vergluehen still', () => {
  const { maze, px, pz } = makeWorld();
  const state = createShotsState();
  fireShot(state, { px, pz, yaw: 0 }, 0);
  // Tempo 0 -> fliegt nie gegen eine Wand; nach `life` ist es trotzdem weg.
  const params = { speed: 0 };
  let events = [];
  for (let i = 0; i < 60; i++) {
    events.push(...shotsStep(maze, state, 0.1, { unit: UNIT, cell: CELL, params }));
  }
  assert.equal(state.shots.length, 0);
  assert.equal(events.length, 0, 'Verglueben macht kein Ereignis');
});

test('shotSegments: rotierender Stern aus drei Linien durch den Mittelpunkt', () => {
  const shot = { x: 1, z: 2, phase: 0.5 };
  const opts = { cell: CELL, yaw: 0, height: 2.5 };
  const segs = shotSegments(shot, 0, opts);
  assert.equal(segs.length, 3);
  for (const [a, b] of segs) {
    // Jede Linie laeuft durch den Mittelpunkt (a und b spiegeln sich).
    assert.ok(Math.abs((a[0] + b[0]) / 2 - shot.x) < 1e-9);
    assert.ok(Math.abs((a[1] + b[1]) / 2 - opts.height) < 1e-9);
    assert.ok(Math.abs((a[2] + b[2]) / 2 - shot.z) < 1e-9);
  }
  // Rotation: spaeter sehen die Segmente anders aus.
  const later = shotSegments(shot, 0.05, opts);
  assert.notDeepEqual(segs, later, 'der Stern rotiert');
});

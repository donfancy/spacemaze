// Tests fuer die Geh-Kinetik (world/walk.js): Tank-Steuerung mit Rampen
// (Anfahren, Bremsen, Lenken) und Kollisions-Meldung als Flanke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALK, createWalkState, walkStep } from '../src/world/walk.js';
import { generateMaze, OPEN, WALL } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { cellCenter, rectWalkable, startFacingYaw } from '../src/world/mazeWorld.js';

// Klassische Blockwelt (uniforme Metrik): unit = cell = 1.
const OPTS = { unit: 1, cell: 1, radius: 0.25 };
const DT = 1 / 60;

// Gerader Nord-Sued-Gang: Spalte x=1 offen (Zeilen 1..3).
function corridorMaze() {
  const W = WALL, O = OPEN;
  return {
    n: 5,
    grid: [
      [W, W, W, W, W],
      [W, O, W, W, W],
      [W, O, W, W, W],
      [W, O, W, W, W],
      [W, W, W, W, W],
    ],
    metric: createMetric({ wall: 1, corridor: 1 }),
  };
}

function run(m, state, pose, input, steps, opts = OPTS) {
  let last = null;
  for (let i = 0; i < steps; i++) {
    last = walkStep(m, state, pose, input, DT, opts);
    pose = { px: last.px, pz: last.pz, yaw: last.yaw };
  }
  return { pose, last };
}

test('Anfahr-Rampe: Tempo waechst mit konstanter Beschleunigung bis zum Gehtempo', () => {
  const m = corridorMaze();
  const state = createWalkState();
  let pose = { px: 1.5, pz: 3.5, yaw: 0 }; // Blick -z, freier Gang voraus
  const steps = Math.round(0.2 / DT);
  ({ pose } = run(m, state, pose, { move: 1, turn: 0 }, steps));
  assert.ok(Math.abs(state.vel - WALK.accel * 0.2) < 0.01, 'nach 0.2 s: v = a*t');
  ({ pose } = run(m, state, pose, { move: 1, turn: 0 }, 60));
  assert.equal(state.vel, WALK.speed, 'saettigt exakt beim Gehtempo');
  assert.ok(pose.pz < 3.5, 'bewegt sich vorwaerts (Richtung -z)');
});

test('Brems-Rampe: Loslassen rollt aus, Gegensteuern bremst zuerst', () => {
  const m = corridorMaze();
  const state = createWalkState();
  state.vel = WALK.speed;
  let pose = { px: 1.5, pz: 3.5, yaw: 0 };
  // Loslassen: Bremsdauer ~ v/brake.
  let stoppedAt = null;
  for (let i = 0; i < 120; i++) {
    const r = walkStep(m, state, pose, { move: 0, turn: 0 }, DT, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    if (stoppedAt === null && state.vel === 0) stoppedAt = (i + 1) * DT;
  }
  assert.ok(stoppedAt !== null, 'kommt zum Stehen');
  assert.ok(Math.abs(stoppedAt - WALK.speed / WALK.brake) < 0.05, `Bremsdauer ~ v/brake (${stoppedAt.toFixed(2)}s)`);
  // Gegensteuern: aus voller Fahrt wird zunaechst gebremst (brake, nicht accel).
  state.vel = WALK.speed;
  walkStep(m, state, pose, { move: -1, turn: 0 }, DT, OPTS);
  assert.ok(Math.abs(state.vel - (WALK.speed - WALK.brake * DT)) < 1e-9, 'Umkehren nutzt die Brems-Rampe');
});

test('Lenk-Rampe: Drehrate faehrt von 0 hoch statt sofort maximal zu sein', () => {
  const m = corridorMaze();
  const state = createWalkState();
  let pose = { px: 1.5, pz: 2.5, yaw: 0 };
  const dyaws = [];
  for (let i = 0; i < 60; i++) {
    const r = walkStep(m, state, pose, { move: 0, turn: 1 }, DT, OPTS);
    dyaws.push(r.yaw - pose.yaw);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  const full = WALK.turn * DT;
  assert.ok(dyaws[0] < 0.2 * full, 'erster Schritt weit unter Maximum');
  assert.ok(dyaws[5] > dyaws[0], 'Rate waechst an');
  assert.ok(Math.abs(dyaws[30] - full) < 1e-9, 'nach der Rampe volle Drehrate');
  // Loslassen: Rate kehrt auf 0 zurueck.
  run(m, state, pose, { move: 0, turn: 0 }, 60);
  assert.equal(state.steer, 0, 'Lenkung kehrt auf 0 zurueck');
});

test('Kollision: EINE Meldung beim Auftreffen, kein Dauerfeuer beim Anliegen', () => {
  const m = corridorMaze();
  const state = createWalkState();
  let pose = { px: 1.5, pz: 3.5, yaw: 0 }; // Blick -z: Wand bei z=1 voraus
  const hits = [];
  for (let i = 0; i < 240; i++) {
    const r = walkStep(m, state, pose, { move: 1, turn: 0 }, DT, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    if (r.collision) hits.push(r.collision);
  }
  assert.equal(hits.length, 1, 'genau ein Bump trotz 4 s Dauerdruecken');
  assert.equal(hits[0].axis, 'z');
  assert.equal(hits[0].side, -1);
  assert.ok(hits[0].impact > 0.9, 'frontal mit vollem Tempo = nahezu volle Wucht');
  assert.ok(pose.pz >= 1 + OPTS.radius - 1e-9, 'Spieler bleibt vor der Wand');
  // Zurueck und erneut anlaufen: der naechste Treffer meldet wieder.
  run(m, state, pose, { move: -1, turn: 0 }, 30);
  pose = { px: 1.5, pz: 2.0, yaw: 0 };
  const again = [];
  for (let i = 0; i < 120; i++) {
    const r = walkStep(m, state, pose, { move: 1, turn: 0 }, DT, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    if (r.collision) again.push(r.collision);
  }
  assert.equal(again.length, 1, 'neuer Anlauf -> neuer Bump');
});

test('langsames Anlaufen unter minImpact meldet keine Kollision', () => {
  const m = corridorMaze();
  const state = createWalkState();
  // Dicht vor der Wand starten: die Rampe laesst kein hohes Tempo mehr zu.
  let pose = { px: 1.5, pz: 1 + OPTS.radius + 0.02, yaw: 0 };
  const hits = [];
  for (let i = 0; i < 60; i++) {
    const r = walkStep(m, state, pose, { move: 1, turn: 0 }, DT, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    if (r.collision) hits.push(r.collision);
  }
  assert.equal(hits.length, 0, 'sanftes Anlegen bleibt stumm');
});

test('erreichtes Tempo (speed): frei = vel, an der Wand angedrueckt = 0', () => {
  const m = corridorMaze();
  const state = createWalkState();
  let pose = { px: 1.5, pz: 3.5, yaw: 0 };
  let r = null;
  for (let i = 0; i < 30; i++) {
    r = walkStep(m, state, pose, { move: 1, turn: 0 }, DT, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  assert.ok(Math.abs(r.speed - state.vel) < 1e-9, 'freie Fahrt: speed == vel');
  for (let i = 0; i < 180; i++) {
    r = walkStep(m, state, pose, { move: 1, turn: 0 }, DT, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  assert.equal(r.speed, 0, 'frontal angedrueckt: keine Bewegung -> speed 0');
  assert.equal(state.vel, WALK.speed, 'das ANGESTREBTE Tempo bleibt (klassisches Gleiten)');
});

test('Gehen haelt das Spieler-Quadrat in offenen Zellen (deterministischer Zufallslauf)', () => {
  const m = generateMaze(9, { seed: 7 });
  const state = createWalkState();
  const radius = OPTS.radius;
  const [sx, sz] = cellCenter(m, m.start[0], m.start[1], 1);
  let pose = { px: sx, pz: sz, yaw: startFacingYaw(m) };
  for (let i = 0; i < 6000; i++) {
    const turn = Math.sin(i * 0.05) > 0 ? 1 : -1;
    const move = Math.cos(i * 0.011) > -0.6 ? 1 : -1; // reproduzierbares Vor/Zurueck
    const r = walkStep(m, state, pose, { move, turn }, DT, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    assert.ok(rectWalkable(m, pose.px - radius, pose.px + radius, pose.pz - radius, pose.pz + radius, 1),
      `Schritt ${i}: Quadrat schneidet eine Wand`);
  }
});

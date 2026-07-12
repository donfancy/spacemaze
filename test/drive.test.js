// Tests fuer die Fahr-Dynamik (world/drive.js): automatischer Vortrieb,
// Lenken, Abprall an Waenden inkl. Kollisions-Beschreibung.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE, createDriveState, driveStep } from '../src/world/drive.js';
import { collisionWave } from '../src/world/waves.js';
import { generateMaze, OPEN, WALL } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { cellCenter, rectWalkable, startFacingYaw } from '../src/world/mazeWorld.js';

const THIN = { wall: 1, corridor: 5 };
// Gangbreite bei unit=1 und corridor=5: cell = 5, Spielerradius = 0.25 * cell.
const OPTS = { unit: 1, cell: 5, radius: 1.25 };

// Gerader Nord-Sued-Gang: Spalte x=1 offen (Kammer, Zwischenwand, Kammer).
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
    metric: createMetric(THIN),
  };
}

test('automatischer Vortrieb: ohne Eingabe faehrt der Spieler los', () => {
  const m = corridorMaze();
  const state = createDriveState();
  let pose = { px: 3.5, pz: 9.5, yaw: 0 }; // Mitte von (1,3), Blick -z
  for (let i = 0; i < 60; i++) {
    const r = driveStep(m, state, pose, 0, 1 / 60, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  assert.ok(pose.pz < 9.5 - 1, 'nach 1s deutlich vorwaerts (Richtung -z)');
  assert.equal(pose.px, 3.5, 'seitlich unveraendert');
  assert.ok(state.vel > DRIVE.cruise * 0.6, 'Tempo naehert sich der Reisegeschwindigkeit');
});

test('Lenken aendert nur den Kurs (links positiv, wie Tank-Steuerung)', () => {
  const m = corridorMaze();
  const state = createDriveState();
  const r = driveStep(m, state, { px: 3.5, pz: 9.5, yaw: 0 }, 1, 1 / 60, OPTS);
  assert.ok(r.yaw > 0, 'links lenken erhoeht yaw');
  const r2 = driveStep(m, createDriveState(), { px: 3.5, pz: 9.5, yaw: 0 }, -1, 1 / 60, OPTS);
  assert.ok(r2.yaw < 0, 'rechts lenken senkt yaw');
});

test('Lenk-Rampe: die Gierrate faehrt von 0 hoch statt sofort maximal zu sein', () => {
  const m = corridorMaze();
  const state = createDriveState();
  let pose = { px: 3.5, pz: 9.5, yaw: 0 };
  const dt = 1 / 60;
  const dyaws = [];
  for (let i = 0; i < 60; i++) {
    const r = driveStep(m, state, pose, 1, dt, OPTS);
    dyaws.push(r.yaw - pose.yaw);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  const full = DRIVE.turn * dt; // maximale Gierrate pro Schritt
  assert.ok(dyaws[0] < 0.1 * full, 'erster Schritt weit unter Maximum');
  assert.ok(dyaws[10] > dyaws[0], 'Rate waechst an');
  assert.ok(Math.abs(dyaws[30] - full) < 1e-9, 'nach der Rampe volle Lenkrate');
  // Loslassen: Rate faehrt wieder auf 0 herunter.
  for (let i = 0; i < 60; i++) {
    const r = driveStep(m, state, pose, 0, dt, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  assert.equal(state.steer, 0, 'Lenkung kehrt auf 0 zurueck');
});

test('Tempo-Rampe: konstante Beschleunigung bis zur Reisegeschwindigkeit', () => {
  const m = corridorMaze();
  const state = createDriveState();
  let pose = { px: 3.5, pz: 9.5, yaw: 0 };
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(0.3 / dt); i++) {
    const r = driveStep(m, state, pose, 0, dt, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  assert.ok(Math.abs(state.vel - DRIVE.accel * 0.3) < 0.01, 'nach 0.3 s: v = a*t');
  for (let i = 0; i < 60; i++) {
    const r = driveStep(m, state, pose, 0, dt, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  assert.equal(state.vel, DRIVE.cruise, 'saettigt exakt bei cruise');
});

test('Bremsen (targetSpeed 0): rollt mit der Brems-Rampe aus und bleibt stehen', () => {
  const m = corridorMaze();
  const state = createDriveState();
  state.vel = DRIVE.cruise;
  let pose = { px: 3.5, pz: 9.5, yaw: 0 };
  const dt = 1 / 60;
  let stoppedAt = null;
  for (let i = 0; i < 120; i++) {
    const r = driveStep(m, state, pose, 0, dt, { ...OPTS, targetSpeed: 0 });
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    if (stoppedAt === null && state.vel === 0) stoppedAt = (i + 1) * dt;
  }
  assert.ok(stoppedAt !== null, 'kommt zum Stehen');
  assert.ok(Math.abs(stoppedAt - DRIVE.cruise / DRIVE.brake) < 0.05, `Bremsdauer ~ v/brake (${stoppedAt.toFixed(2)}s)`);
  assert.equal(state.vel, 0, 'bleibt stehen');
});

test('frontaler Aufprall: Kollision gemeldet, Feder-Impuls drueckt von der Wand weg', () => {
  const m = corridorMaze();
  const state = createDriveState();
  let pose = { px: 3.5, pz: 9.5, yaw: 0 };
  let collision = null;
  for (let i = 0; i < 600 && !collision; i++) {
    const r = driveStep(m, state, pose, 0, 1 / 60, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    collision = r.collision;
  }
  assert.ok(collision, 'Kollision tritt ein');
  assert.equal(collision.axis, 'z');
  assert.equal(collision.side, -1);
  assert.equal(collision.plane, 1, 'Wandebene: Vorderkante von Zeile 1 (Einheit 1)');
  assert.deepEqual(collision.wallCell, [1, 0]);
  assert.ok(Math.abs(collision.point[0] - 3.5) < 1e-9, 'Auftreffpunkt seitlich beim Spieler');
  assert.ok(collision.impact > 0.8, 'frontal = nahezu volle Wucht');
  assert.ok(state.vel > 0, 'Vorwaertstempo bleibt erhalten (kein Rueckwaertsfahren)');
  assert.ok(state.push.z > 0, 'Feder-Impuls zeigt von der Wand weg (+z bei side=-1)');
  assert.ok(pose.pz >= 1 + OPTS.radius - 1e-9, 'Spieler bleibt vor der Wand');
});

test('schraeger Aufprall: Auftreffpunkt liegt auf der Sichtlinie, nicht am Lotpunkt', () => {
  const W = WALL, O = OPEN;
  // Gang entlang Zeile 1 (Spalten 1..3 offen), Wand darueber (Zeile 0).
  const m = {
    n: 5,
    grid: [
      [W, W, W, W, W],
      [W, O, O, O, W],
      [W, W, W, W, W],
      [W, W, W, W, W],
      [W, W, W, W, W],
    ],
    metric: createMetric(THIN),
  };
  const state = createDriveState();
  const yaw = -0.45; // vorwaerts (-z) mit Drift nach +x
  let pose = { px: 3, pz: 4.5, yaw };
  let collision = null;
  for (let i = 0; i < 600 && !collision; i++) {
    const r = driveStep(m, state, pose, 0, 1 / 60, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    collision = r.collision;
  }
  assert.ok(collision, 'Kollision tritt ein');
  assert.equal(collision.axis, 'z');
  assert.equal(collision.plane, 1);
  // Sichtlinie vom Standort (pose) durch die Wandebene: dx/dz = tan(yaw).
  const expected = pose.px + Math.tan(yaw) * (1 - pose.pz);
  assert.ok(Math.abs(collision.point[0] - expected) < 1e-6,
    `Punkt ${collision.point[0].toFixed(3)} != Sichtlinie ${expected.toFixed(3)}`);
  assert.ok(collision.point[0] > pose.px, 'in Blickrichtung (+x) versetzt, nicht am Lotpunkt');
});

test('frei stehender Pfeiler, versetzt gestreift: Wandzelle ist der Pfeiler, Welle bleibt dran', () => {
  // Offene Halle: alle Zwischenwaende offen, nur die Pfeiler (gerade/gerade)
  // und der Rand stehen -- Pfeiler (2,2) steht frei (Einheiten x 6..7, z 6..7).
  const W = WALL, O = OPEN;
  const n = 7;
  const grid = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) {
      const border = x === 0 || y === 0 || x === n - 1 || y === n - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      row.push(border || pillar ? W : O);
    }
    grid.push(row);
  }
  const m = { n, grid, metric: createMetric(THIN) };

  // Spieler rechts neben dem Pfeiler, Blick +z (yaw PI), volle Fahrt; ein
  // seitlicher Feder-Impuls (wie nach einem Abpraller) drueckt nach links in
  // den Pfeiler, waehrend die Fahrt in +z am Pfeiler VORBEIZIEHT: x blockiert
  // an der Pfeilerkante, der z-Schritt verlaesst die Pfeilerzeile noch im
  // selben Simulationsschritt (grosses dt = Clamp-Maximum).
  const state = createDriveState();
  state.vel = DRIVE.cruise;
  state.push = { x: -0.9, z: 0 };
  const res = driveStep(m, state, { px: 8.3, pz: 8.2, yaw: Math.PI }, 0, 0.1, OPTS);
  assert.ok(res.collision, 'Streifen loest eine Kollision aus');
  assert.equal(res.collision.axis, 'x');
  assert.deepEqual(res.collision.wallCell, [2, 2], 'Wandzelle ist der Pfeiler selbst');
  // Auftreffpunkt bleibt in der Kontaktspanne (Spielerkante +- radius) --
  // nicht auf der Sichtlinie weit voraus, wo gar keine Beruehrung war.
  assert.ok(Math.abs(res.collision.point[1] - 8.2) <= OPTS.radius + 1e-9,
    `Auftreffpunkt ${res.collision.point[1].toFixed(2)} in der Kontaktspanne um 8.2`);
  // Und die Welle bleibt auf den Pfeiler begrenzt, statt "in die Luft" ueber
  // den offenen Gang davor zu laufen.
  const wave = collisionWave(m, res.collision, { unit: 1, eye: 2.5 });
  assert.ok(wave.extent[0] >= 6 - 1e-9 && wave.extent[1] <= 7 + 1e-9,
    `Wellen-Ausdehnung [${wave.extent}] bleibt am Pfeiler (6..7)`);
});

test('schraeger Aufprall: Fahrt geht weiter, zweiter Einschlag weiter vorne', () => {
  const W = WALL, O = OPEN;
  const m = {
    n: 5,
    grid: [
      [W, W, W, W, W],
      [W, O, O, O, W],
      [W, W, W, W, W],
      [W, W, W, W, W],
      [W, W, W, W, W],
    ],
    metric: createMetric(THIN),
  };
  const state = createDriveState();
  const yaw = -0.45; // vorwaerts (-z) mit Drift nach +x
  let pose = { px: 3, pz: 4.5, yaw };
  const hits = [];
  for (let i = 0; i < 60 * 4; i++) {
    const r = driveStep(m, state, pose, 0, 1 / 60, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    if (r.collision) hits.push({ col: r.collision, px: pose.px });
  }
  assert.ok(hits.length >= 2, `mehrfacher Einschlag (${hits.length} Treffer)`);
  assert.ok(hits[1].col.point[0] > hits[0].col.point[0] + 0.5,
    'zweiter Einschlag deutlich WEITER VORNE entlang der Wand');
  assert.equal(pose.yaw, yaw, 'Blickrichtung bleibt unveraendert');
  // Zwischen den Treffern federt der Spieler von der Wand weg und faehrt
  // trotzdem weiter vorwaerts (tangential) -- kein Rueckwaertsfahren.
  assert.ok(hits[1].px > hits[0].px, 'Vorwaertsbewegung setzt sich fort');
});

test('nach dem Abfedern kehrt der Kurs zur Wand zurueck -> pinballt erneut (mit Sperrzeit)', () => {
  const m = corridorMaze();
  const state = createDriveState();
  let pose = { px: 3.5, pz: 9.5, yaw: 0 };
  const hits = [];
  let t = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const r = driveStep(m, state, pose, 0, 1 / 60, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    t += 1 / 60;
    if (r.collision) hits.push(t);
  }
  assert.ok(hits.length >= 2, `federt wiederholt (${hits.length} Treffer)`);
  for (let i = 1; i < hits.length; i++) {
    // Deutlich mehr als die Sperrzeit: das Netto-Tempo weg von der Wand nach
    // dem Treffer ist ein FESTER Anteil der REISEgeschwindigkeit. Ein Impuls
    // proportional zur Aufprallwucht wuerde immer schwaecher -- der Spieler
    // "zittert" dann im Cooldown-Takt an der Wand (Regression: Dauer-Blitzen
    // der Kollisionswellen).
    assert.ok(hits[i] - hits[i - 1] >= 0.5, `sauberes Abfedern statt Zittern (${(hits[i] - hits[i - 1]).toFixed(2)}s)`);
  }
});

test('Fahrt haelt das Spieler-Quadrat in offenen Zellen (deterministische Zufallsfahrt)', () => {
  const m = generateMaze(9, { seed: 21, metric: THIN });
  const state = createDriveState();
  const radius = OPTS.radius;
  const [sx, sz] = cellCenter(m, m.start[0], m.start[1], 1);
  let pose = { px: sx, pz: sz, yaw: startFacingYaw(m) };
  for (let i = 0; i < 6000; i++) {
    const turn = Math.sin(i * 0.03) > 0 ? 1 : -1; // reproduzierbares "Herumkurven"
    const r = driveStep(m, state, pose, turn, 1 / 60, OPTS);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
    // Das GANZE Quadrat (nicht nur Ecken -- Waende koennen schmaler sein).
    assert.ok(rectWalkable(m, pose.px - radius, pose.px + radius, pose.pz - radius, pose.pz + radius, 1),
      `Schritt ${i}: Quadrat schneidet eine Wand`);
  }
});

test('Umschauen im Stand: bei Tempo 0 (targetSpeed 0) dreht die Lenkung, nichts bewegt sich', () => {
  // Darauf ruht das Umschauen am Ziel (playing.updateDrive bei reached):
  // vel/push auf 0, driveStep laeuft weiter -- nur der Blick dreht.
  const m = corridorMaze();
  const state = createDriveState();
  let pose = { px: 3.5, pz: 9.5, yaw: 0 };
  for (let i = 0; i < 60; i++) {
    const r = driveStep(m, state, pose, 1, 1 / 60, { ...OPTS, targetSpeed: 0 });
    assert.equal(r.collision, null);
    pose = { px: r.px, pz: r.pz, yaw: r.yaw };
  }
  assert.equal(pose.px, 3.5, 'steht seitlich');
  assert.equal(pose.pz, 9.5, 'steht laengs');
  assert.equal(state.vel, 0, 'faehrt nicht an');
  assert.ok(pose.yaw > 1, 'der Blick hat sich nach 1s deutlich gedreht');
});

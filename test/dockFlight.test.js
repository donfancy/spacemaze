// C1-Stetigkeit der Startscreen-Fluege (31.8.2026, Boris' "smooth"-Pass):
// Beim S-Druck darf die Orbit-Bewegung nicht hart einfrieren (der Andock-
// Flug uebernimmt die Bahngeschwindigkeit), und am Ende des Abdock-Flugs
// darf das Umtanzen nicht hart einsetzen (der Flug landet mit der
// Bahngeschwindigkeit auf der bewegten Bahn). Gemessen wird die Pose aus
// viewState() per Finite-Differenzen ueber die Nahtstelle hinweg.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStartscreen } from '../src/scenes/startscreen.js';
import { faceDockPose, SIDE_FACES } from '../src/world/cubeFaces.js';
import { CUBE_SIZE } from '../src/scenes/mazeView.js';

const DT = 1 / 60;

function fakeGame(overrides = {}) {
  return {
    level: 1, demo: false, undock: false, dockFace: null,
    audio: null, dispatch() {}, beginDemo() {},
    ...overrides,
  };
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Ein Simulationsschritt; liefert die Pose NACH dem Schritt.
function step(scene) {
  scene.update(DT);
  return scene.viewState().pose;
}

test('Andocken: S friert die Orbit-Bewegung nicht ein (C1 am Flug-Start)', () => {
  const scene = createStartscreen(fakeGame());
  scene.enter();
  let prev = scene.viewState().pose;
  // Orbit warmlaufen lassen und die letzte Bahngeschwindigkeit messen.
  let vBefore = 0;
  for (let i = 0; i < 300; i++) {
    const pose = step(scene);
    vBefore = dist(pose.position, prev.position) / DT;
    prev = pose;
  }
  scene.onKey('S'); // Andocken beginnt
  const pose = step(scene);
  const vAfter = dist(pose.position, prev.position) / DT;
  assert.ok(vBefore > 1, `Orbit bewegt sich spuerbar (${vBefore.toFixed(2)})`);
  assert.ok(vAfter > 0.5 * vBefore,
    `kein hartes Stehenbleiben: v ${vBefore.toFixed(3)} -> ${vAfter.toFixed(3)}`);
  assert.ok(Math.abs(vAfter - vBefore) < 0.2 * vBefore,
    `Tempo-Sprung klein: v ${vBefore.toFixed(3)} -> ${vAfter.toFixed(3)}`);
});

test('Andocken: der Flug endet trotz bewegtem Start exakt auf der Dock-Pose', () => {
  const game = fakeGame();
  const scene = createStartscreen(game);
  scene.enter();
  for (let i = 0; i < 300; i++) scene.update(DT);
  scene.onKey('S');
  for (let i = 0; i < 200; i++) scene.update(DT); // weit ueber DOCK_DURATION
  const { pose } = scene.viewState();
  const target = faceDockPose(game.dockFace, CUBE_SIZE, Math.PI / 2.4, 0.85);
  assert.ok(dist(pose.position, target.position) < 1e-9, 'Position sitzt');
  assert.ok(Math.abs(pose.pitch - target.pitch) < 1e-9, 'Pitch sitzt');
});

test('Abdocken: das Umtanzen setzt ohne Ruck ein (C1 am Flug-Ende)', () => {
  const scene = createStartscreen(fakeGame({ undock: true }));
  scene.enter(); // Phase 'undocking'
  let prev = scene.viewState().pose;
  let vLastFlight = 0;
  // Bis zum Umschalten auf 'orbiting' fliegen, dabei das letzte Flug-Tempo merken.
  let guard = 0;
  while (scene.viewState().phase === 'undocking' && guard++ < 1000) {
    const pose = step(scene);
    if (scene.viewState().phase === 'undocking') {
      vLastFlight = dist(pose.position, prev.position) / DT;
    }
    prev = pose;
  }
  assert.ok(guard < 1000, 'Flug endet');
  const pose = step(scene); // erster reiner Orbit-Schritt
  const vOrbit = dist(pose.position, prev.position) / DT;
  assert.ok(vOrbit > 1, `Orbit bewegt sich spuerbar (${vOrbit.toFixed(2)})`);
  assert.ok(vLastFlight > 0.5 * vOrbit,
    `Flug kommt nicht auf Tempo 0 an: v ${vLastFlight.toFixed(3)} vs Orbit ${vOrbit.toFixed(3)}`);
  assert.ok(Math.abs(vOrbit - vLastFlight) < 0.2 * vOrbit,
    `Tempo-Sprung klein: v ${vLastFlight.toFixed(3)} -> ${vOrbit.toFixed(3)}`);
});

test('Abdocken: der Flug landet weiterhin am Bahnpunkt vor der Dock-Flaeche', () => {
  for (const face of SIDE_FACES) {
    const scene = createStartscreen(fakeGame({ undock: true, dockFace: face }));
    scene.enter();
    let guard = 0;
    while (scene.viewState().phase === 'undocking' && guard++ < 1000) scene.update(DT);
    const { pose } = scene.viewState();
    // Horizontaler Azimut der Landeposition == Azimut der Flaechen-Normalen
    // (bis auf die Frame-Quantisierung: das Umschalten passiert am ersten
    // Frame NACH Flugende, der Orbit ist dann max. 1 Tick weitergedreht).
    const azPose = Math.atan2(pose.position[0], pose.position[2]);
    const azFace = Math.atan2(face.normal[0], face.normal[2]);
    let d = (azPose - azFace) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const oneFrame = 0.36 * DT * 1.5; // azimuthSpeed des Orbits x ~1 Frame
    assert.ok(Math.abs(d) < oneFrame, `Flaeche [${face.normal}]: Azimut sitzt (${d})`);
  }
});

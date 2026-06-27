import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIDE_FACES, pickDockFace, faceDockPose, mapGridToFace, mapSegmentsToFace, gridBorderOnFace,
  faceLocalToWorld, faceDir,
} from '../src/world/cubeFaces.js';
import { createCamera, forward } from '../src/math/camera.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function assertVecClose(actual, expected, eps = 1e-9) {
  for (let i = 0; i < 3; i++) {
    assert.ok(close(actual[i], expected[i], eps), `Komponente ${i}: ${actual[i]} != ${expected[i]}`);
  }
}

test('SIDE_FACES: 4 Flaechen mit Einheitsnormalen', () => {
  assert.equal(SIDE_FACES.length, 4);
  for (const f of SIDE_FACES) {
    assert.ok(close(Math.hypot(...f.normal), 1));
  }
});

test('pickDockFace waehlt die zugewandte Flaeche (min Blick . Normale)', () => {
  // Die Kamera sieht die Flaeche auf IHRER Seite: Blick -z heisst Kamera bei +z.
  assert.deepEqual(pickDockFace([0, 0, -1]).normal, [0, 0, 1]);  // Blick -z -> front (+z)
  assert.deepEqual(pickDockFace([0, 0, 1]).normal, [0, 0, -1]);  // Blick +z -> back  (-z)
  assert.deepEqual(pickDockFace([1, 0, 0]).normal, [-1, 0, 0]);  // Blick +x -> left  (-x)
  assert.deepEqual(pickDockFace([-1, 0, 0]).normal, [1, 0, 0]);  // Blick -x -> right (+x)
  // Blick schraeg leicht nach unten, ueberwiegend -z -> front.
  assert.deepEqual(pickDockFace([0.2, -0.4, -0.9]).normal, [0, 0, 1]);
});

test('faceDockPose: Kamera senkrecht vor der Flaeche, ausserhalb des Wuerfels', () => {
  const pose = faceDockPose(SIDE_FACES[0], 2.4, Math.PI / 2.4, 0.85); // front
  assert.ok(pose.position[2] > 1.2);
  assert.equal(pose.position[0], 0);
  assert.equal(pose.position[1], 0);
  assert.equal(pose.pitch, 0);
});

test('faceDockPose: jede Flaeche blickt frontal auf sich (forward = -normal)', () => {
  for (const f of SIDE_FACES) {
    const pose = faceDockPose(f, 2.4, Math.PI / 2.4, 0.85);
    const cam = createCamera({ position: pose.position, yaw: pose.yaw, pitch: pose.pitch });
    assertVecClose(forward(cam), [-f.normal[0], -f.normal[1], -f.normal[2]]);
  }
});

test('mapGridToFace: Grid-Mitte ist die Flaechenmitte', () => {
  assertVecClose(mapGridToFace(5.5, 5.5, 11, 2.4, SIDE_FACES[0]), [0, 0, 1.2]); // front, z=1.2
});

test('mapGridToFace: gx folgt uAxis, gy folgt vAxis', () => {
  const front = SIDE_FACES[0]; // uAxis +x, vAxis -y
  assert.ok(mapGridToFace(11, 5.5, 11, 2.4, front)[0] > 0);  // gx hoch -> +x
  assert.ok(mapGridToFace(5.5, 11, 11, 2.4, front)[1] < 0);  // gy hoch -> -y (nach unten)
});

test('gridBorderOnFace: 4 Segmente, konstante Normalkoordinate', () => {
  const segs = gridBorderOnFace(11, 2.4, SIDE_FACES[0]); // front: z=1.2
  assert.equal(segs.length, 4);
  for (const [a, b] of segs) {
    assert.ok(close(a[2], 1.2) && close(b[2], 1.2));
  }
});

test('mapSegmentsToFace mappt 2D-Segmente auf die Flaeche', () => {
  const world = mapSegmentsToFace([[[0, 0], [11, 0]]], 11, 2.4, SIDE_FACES[0]);
  assert.equal(world.length, 1);
  assertVecClose(world[0][0], [-1.2, 1.2, 1.2]); // grid(0,0) auf front
});

test('faceLocalToWorld(Hoehe 0) ist deckungsgleich mit mapGridToFace', () => {
  const n = 11, s = 2.4, cell = s / n;
  for (const face of SIDE_FACES) {
    for (const [gx, gy] of [[0, 0], [5, 5], [11, 11], [3, 7]]) {
      assertVecClose(faceLocalToWorld(gx * cell, 0, gy * cell, face, s), mapGridToFace(gx, gy, n, s, face));
    }
  }
});

test('faceLocalToWorld: Hoehe verschiebt entlang der Flaechennormalen', () => {
  const face = SIDE_FACES[0]; // normal +z
  const a = faceLocalToWorld(1, 0, 1, face, 2.4);
  const b = faceLocalToWorld(1, 0.5, 1, face, 2.4);
  assertVecClose([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [0, 0, 0.5]);
});

test('faceDir mappt lokale Richtungen ohne Verschiebung', () => {
  const face = SIDE_FACES[2]; // right (+x): uAxis [0,0,-1], vAxis [0,-1,0], normal [1,0,0]
  assertVecClose(faceDir(1, 0, 0, face), face.uAxis); // lokales +x -> uAxis
  assertVecClose(faceDir(0, 0, 1, face), face.vAxis); // lokales +z -> vAxis
  assertVecClose(faceDir(0, 1, 0, face), face.normal); // lokale Hoehe -> normal
});

// Tests fuer Quaternion-Slerp und die Pose-Ueberblendung der Kamera-Schwenks.
// Regression: beim Reinfallen/Rueckschwenk mit Ego-Blick "Sued" (forward =
// -Welt-oben) degenerierte das getrennte Lerpen von forward/up in der Mitte
// (antiparallel) -> Kameraueberschlag. Mit Slerp bleibt die Basis immer
// orthonormal und die Bewegung stetig.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quatFromBasis, basisFromQuat, slerpQuat } from '../src/math/quat.js';
import { basisFromForwardUp } from '../src/math/camera.js';
import { dot, cross, length, normalize } from '../src/math/vec3.js';
import { egoPose, mapPose, blendPose, cellSize } from '../src/scenes/mazeView.js';
import { SIDE_FACES } from '../src/world/cubeFaces.js';

const EPS = 1e-9;

function assertVecClose(a, b, msg, eps = 1e-6) {
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(a[i] - b[i]) < eps, `${msg}: [${a}] != [${b}]`);
  }
}

// Prueft, dass {right, up, forward} eine rechtshaendige Orthonormal-Basis ist
// (Kamera-Konvention: right x up = -forward ist hier NICHT gemeint; es gilt
// forward x up = -right bzw. right = cross(forward, up) -- wie basisFromForwardUp).
function assertOrthonormal(basis, msg) {
  assert.ok(Math.abs(length(basis.right) - 1) < 1e-6, `${msg}: |right| != 1`);
  assert.ok(Math.abs(length(basis.up) - 1) < 1e-6, `${msg}: |up| != 1`);
  assert.ok(Math.abs(length(basis.forward) - 1) < 1e-6, `${msg}: |forward| != 1`);
  assert.ok(Math.abs(dot(basis.right, basis.up)) < 1e-6, `${msg}: right nicht senkrecht zu up`);
  assert.ok(Math.abs(dot(basis.right, basis.forward)) < 1e-6, `${msg}: right nicht senkrecht zu forward`);
  assert.ok(Math.abs(dot(basis.up, basis.forward)) < 1e-6, `${msg}: up nicht senkrecht zu forward`);
  assertVecClose(cross(basis.forward, basis.up), basis.right, `${msg}: Haendigkeit`);
}

// Ein paar deutlich verschiedene Orientierungen fuer Round-Trip-Tests.
const SAMPLE_BASES = [
  basisFromForwardUp([0, 0, -1], [0, 1, 0]),
  basisFromForwardUp([1, 0, 0], [0, 1, 0]),
  basisFromForwardUp([0, -1, 0], [0, 0, 1]),   // Blick nach unten, up = +z
  basisFromForwardUp([0.3, -0.5, 0.8], [0, 1, 0]),
  basisFromForwardUp([-0.7, 0.7, 0.1], [0.2, 0.3, 0.9]),
];

test('quatFromBasis/basisFromQuat: Round-Trip erhaelt die Basis', () => {
  for (const basis of SAMPLE_BASES) {
    const back = basisFromQuat(quatFromBasis(basis));
    assertVecClose(back.right, basis.right, 'right');
    assertVecClose(back.up, basis.up, 'up');
    assertVecClose(back.forward, basis.forward, 'forward');
  }
});

test('slerpQuat: Endpunkte exakt, Zwischenwerte Einheitslaenge', () => {
  const qa = quatFromBasis(SAMPLE_BASES[0]);
  const qb = quatFromBasis(SAMPLE_BASES[2]);
  assertVecClose(slerpQuat(qa, qb, 0), qa, 't=0');
  assert.ok(Math.abs(Math.hypot(...slerpQuat(qa, qb, 1)) - 1) < EPS);
  const mid = slerpQuat(qa, qb, 0.5);
  assert.ok(Math.abs(Math.hypot(...mid) - 1) < 1e-9, 'Einheitslaenge in der Mitte');
  assertOrthonormal(basisFromQuat(mid), 'Slerp-Mitte');
});

test('slerpQuat nimmt den kurzen Bogen (q und -q sind dieselbe Rotation)', () => {
  const qa = quatFromBasis(SAMPLE_BASES[0]);
  const qbNeg = quatFromBasis(SAMPLE_BASES[1]).map((c) => -c);
  // Naehe zum Start bei kleinem t: die Interpolation darf nicht "aussen herum".
  const q = slerpQuat(qa, qbNeg, 0.01);
  const d = Math.abs(qa[0] * q[0] + qa[1] * q[1] + qa[2] * q[2] + qa[3] * q[3]);
  assert.ok(d > 0.999, `kurzer Bogen: |dot|=${d}`);
});

// DER Bugfall isoliert: Karte (forward=-Normale, up=+y) -> Ego "Sued"
// (forward=-y, up=Normale). Beim alten Vektor-Lerp galt in der Mitte
// forward = -up -> degenerierte Basis.
test('blendPose ueberschlaegt sich nicht beim Sued-Blick (isolierter Fall)', () => {
  const a = { position: [0, 0, 3], forward: [0, 0, -1], up: [0, 1, 0] };
  const b = { position: [0, 0, 1.2], forward: [0, -1, 0], up: [0, 0, 1] };
  let prev = null;
  for (let i = 0; i <= 20; i++) {
    const pose = blendPose(a, b, i / 20);
    const basis = basisFromForwardUp(pose.forward, pose.up);
    assertOrthonormal(basis, `e=${i / 20}`);
    if (prev) {
      // Stetigkeit: aufeinanderfolgende Richtungen bleiben nah beieinander.
      assert.ok(dot(prev.forward, pose.forward) > 0.9, `forward springt bei e=${i / 20}`);
      assert.ok(dot(prev.up, pose.up) > 0.9, `up springt bei e=${i / 20}`);
    }
    prev = pose;
  }
});

// Vollstaendige Abdeckung: alle 4 Andockflaechen x alle 4 Ego-Blickrichtungen
// (Nord/Ost/Sued/West). Ueberall muss der Schwenk stetig und orthonormal sein.
test('blendPose: Karte -> Ego stetig fuer jede Flaeche und Blickrichtung', () => {
  const cell = 2.4 / 11;
  for (const face of SIDE_FACES) {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const a = mapPose(face, Math.PI / 2.4);
      const b = egoPose(face, 5.5 * cell, 5.5 * cell, yaw, cell);
      let prev = null;
      const label = `face [${face.normal}] yaw ${yaw.toFixed(2)}`;
      for (let i = 0; i <= 20; i++) {
        const pose = blendPose(a, b, i / 20);
        assertOrthonormal(basisFromForwardUp(pose.forward, pose.up), label);
        if (prev) {
          assert.ok(dot(prev.forward, pose.forward) > 0.9, `${label}: forward springt`);
          assert.ok(dot(prev.up, pose.up) > 0.9, `${label}: up springt`);
        }
        prev = pose;
      }
      // Endpunkte muessen exakt den Vorgabe-Posen entsprechen.
      assertVecClose(blendPose(a, b, 0).forward, normalize(a.forward), `${label}: Start-forward`);
      assertVecClose(blendPose(a, b, 1).forward, normalize(b.forward), `${label}: End-forward`);
      assertVecClose(blendPose(a, b, 1).up, b.up, `${label}: End-up`);
    }
  }
});


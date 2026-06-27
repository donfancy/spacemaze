import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, worldToView, forward, lookAt } from '../src/math/camera.js';
import { normalize, sub } from '../src/math/vec3.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function assertVecClose(actual, expected, eps = 1e-9) {
  for (let i = 0; i < 3; i++) {
    assert.ok(close(actual[i], expected[i], eps),
      `Komponente ${i}: ${actual[i]} != ${expected[i]}`);
  }
}

test('Default-Kamera sitzt im Ursprung und schaut entlang -z', () => {
  const cam = createCamera();
  assert.deepEqual(cam.position, [0, 0, 0]);
  assertVecClose(forward(cam), [0, 0, -1]);
});

test('worldToView verschiebt um die Kameraposition', () => {
  const cam = createCamera({ position: [0, 0, 5] });
  // Punkt im Ursprung liegt 5 Einheiten vor der Kamera (-z).
  assertVecClose(worldToView(cam, [0, 0, 0]), [0, 0, -5]);
});

test('yaw dreht das Sichtfeld korrekt', () => {
  // 90 Grad yaw -> Kamera schaut entlang -x (Welt).
  const cam = createCamera({ yaw: Math.PI / 2 });
  assertVecClose(forward(cam), [-1, 0, 0]);
});

test('worldToView mit yaw bringt seitlichen Punkt nach vorn', () => {
  const cam = createCamera({ position: [0, 0, 0], yaw: -Math.PI / 2 });
  // Kamera schaut nach +x; ein Punkt bei +x ist also direkt voraus (-z im View).
  assertVecClose(worldToView(cam, [5, 0, 0]), [0, 0, -5], 1e-9);
});

test('pitch nach oben schauen', () => {
  const cam = createCamera({ pitch: Math.PI / 2 });
  assertVecClose(forward(cam), [0, 1, 0]);
});

// lookAt ist die Umkehrung von forward: forward(lookAt(pos,target)) zeigt zum Ziel.
function assertLooksAt(pos, target, eps = 1e-9) {
  const { yaw, pitch } = lookAt(pos, target);
  const cam = createCamera({ position: pos, yaw, pitch });
  assertVecClose(forward(cam), normalize(sub(target, pos)), eps);
}

test('lookAt richtet die Kamera exakt auf das Ziel (diverse Lagen)', () => {
  assertLooksAt([0, 0, 5], [0, 0, 0]);    // nach -z
  assertLooksAt([5, 0, 0], [0, 0, 0]);    // nach -x
  assertLooksAt([0, 5, 0], [0, 0, 0]);    // nach unten
  assertLooksAt([0, -5, 0], [0, 0, 0]);   // nach oben
  assertLooksAt([3, 4, 5], [-1, 2, 1]);   // schraeg
  assertLooksAt([-2, -3, 4], [5, 1, -2]); // schraeg
});

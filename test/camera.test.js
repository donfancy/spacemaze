import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, worldToView, forward } from '../src/math/camera.js';

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

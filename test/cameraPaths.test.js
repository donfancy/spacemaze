import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sphericalToCartesian, orbitCamera } from '../src/world/cameraPaths.js';
import { createCamera, forward } from '../src/math/camera.js';
import { length, sub, normalize } from '../src/math/vec3.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function assertVecClose(actual, expected, eps = 1e-9) {
  for (let i = 0; i < 3; i++) {
    assert.ok(close(actual[i], expected[i], eps), `Komponente ${i}: ${actual[i]} != ${expected[i]}`);
  }
}

test('sphericalToCartesian: Grundrichtungen', () => {
  assertVecClose(sphericalToCartesian([0, 0, 0], 5, 0, 0), [0, 0, 5]);              // +z
  assertVecClose(sphericalToCartesian([0, 0, 0], 5, Math.PI / 2, 0), [5, 0, 0]);   // +x
  assertVecClose(sphericalToCartesian([0, 0, 0], 5, 0, Math.PI / 2), [0, 5, 0]);   // +y
});

test('sphericalToCartesian: Punkt liegt im Abstand radius vom Zentrum', () => {
  const center = [1, 2, 3];
  for (let i = 0; i < 20; i++) {
    const p = sphericalToCartesian(center, 7, i * 0.3, i * 0.17 - 1);
    assert.ok(close(length(sub(p, center)), 7, 1e-9));
  }
});

test('orbitCamera haelt den Abstand im erwarteten Band', () => {
  const center = [0, 0, 0];
  for (let i = 0; i < 100; i++) {
    const t = i * 0.13;
    const o = orbitCamera(t, { center, radius: 6, radiusVar: 1.5 });
    const d = length(sub(o.position, center));
    assert.ok(d >= 6 - 1.5 - 1e-9 && d <= 6 + 1.5 + 1e-9, `Abstand ${d} ausserhalb [4.5, 7.5]`);
  }
});

test('orbitCamera schaut immer aufs Zentrum', () => {
  const center = [1, 2, 3];
  for (let i = 0; i < 100; i++) {
    const t = i * 0.21;
    const o = orbitCamera(t, { center });
    const cam = createCamera({ position: o.position, yaw: o.yaw, pitch: o.pitch });
    assertVecClose(forward(cam), normalize(sub(center, o.position)), 1e-6);
  }
});

test('orbitCamera ist deterministisch', () => {
  assert.deepEqual(orbitCamera(3.3, { center: [0, 1, 0] }), orbitCamera(3.3, { center: [0, 1, 0] }));
});

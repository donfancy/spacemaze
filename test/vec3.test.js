import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vec3, add, sub, scale, dot, cross, length, normalize, lerp,
  rotateX, rotateY, rotateZ,
} from '../src/math/vec3.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function assertVecClose(actual, expected, eps = 1e-9) {
  for (let i = 0; i < 3; i++) {
    assert.ok(close(actual[i], expected[i], eps),
      `Komponente ${i}: ${actual[i]} != ${expected[i]}`);
  }
}

test('vec3 erzeugt und rechnet grundlegend', () => {
  assert.deepEqual(vec3(1, 2, 3), [1, 2, 3]);
  assert.deepEqual(add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  assert.deepEqual(sub([4, 5, 6], [1, 2, 3]), [3, 3, 3]);
  assert.deepEqual(scale([1, 2, 3], 2), [2, 4, 6]);
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32);
});

test('cross steht senkrecht auf den Eingaben', () => {
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  const c = cross([1, 2, 3], [4, 5, 6]);
  assert.equal(dot(c, [1, 2, 3]), 0);
  assert.equal(dot(c, [4, 5, 6]), 0);
});

test('length und normalize', () => {
  assert.equal(length([3, 4, 0]), 5);
  assertVecClose(normalize([0, 0, 5]), [0, 0, 1]);
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0]);
});

test('lerp interpoliert linear', () => {
  assert.deepEqual(lerp([0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]);
  assert.deepEqual(lerp([1, 2, 3], [4, 5, 6], 0), [1, 2, 3]);
  assert.deepEqual(lerp([1, 2, 3], [4, 5, 6], 1), [4, 5, 6]);
});

test('Rotationen um 90 Grad', () => {
  const q = Math.PI / 2;
  assertVecClose(rotateX([0, 1, 0], q), [0, 0, 1]);
  assertVecClose(rotateY([0, 0, 1], q), [1, 0, 0]);
  assertVecClose(rotateZ([1, 0, 0], q), [0, 1, 0]);
});

test('volle Drehung bringt den Vektor zurueck', () => {
  const p = [1, 2, 3];
  assertVecClose(rotateY(p, Math.PI * 2), p, 1e-9);
});

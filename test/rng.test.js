import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randInt, pick } from '../src/util/rng.js';

test('gleicher Seed liefert identische Folge (Determinismus)', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  for (let i = 0; i < 100; i++) {
    assert.equal(a(), b());
  }
});

test('verschiedene Seeds liefern verschiedene Folgen', () => {
  const a = createRng(1);
  const b = createRng(2);
  let differ = false;
  for (let i = 0; i < 20; i++) {
    if (a() !== b()) { differ = true; break; }
  }
  assert.ok(differ);
});

test('Werte liegen in [0,1)', () => {
  const r = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `Wert ausserhalb [0,1): ${v}`);
  }
});

test('randInt bleibt in [0,max)', () => {
  const r = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = randInt(r, 5);
    assert.ok(v >= 0 && v < 5 && Number.isInteger(v));
  }
});

test('pick liefert ein Element des Arrays', () => {
  const r = createRng(99);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 50; i++) {
    assert.ok(arr.includes(pick(r, arr)));
  }
});

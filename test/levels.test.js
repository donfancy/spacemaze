// Tests fuer die Level-Definitionen und die Auswahl-Logik (reine Funktionen).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, MIN_LEVEL, MAX_LEVEL, levelConfig, stepLevel } from '../src/core/levels.js';

test('Level 1 bis 5 haben die Maze-Groessen 9, 11, 13, 15, 17', () => {
  assert.equal(MIN_LEVEL, 1);
  assert.equal(MAX_LEVEL, 5);
  assert.deepEqual(LEVELS.map((l) => l.n), [9, 11, 13, 15, 17]);
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    assert.equal(levelConfig(level).n, 7 + 2 * level);
  }
});

test('levelConfig liefert null ausserhalb des gueltigen Bereichs', () => {
  assert.equal(levelConfig(0), null);
  assert.equal(levelConfig(MAX_LEVEL + 1), null);
  assert.equal(levelConfig(1.5), null);
  assert.equal(levelConfig(undefined), null);
});

test('stepLevel geht schrittweise und begrenzt an den Raendern (kein Umlauf)', () => {
  assert.equal(stepLevel(1, +1), 2);
  assert.equal(stepLevel(3, -1), 2);
  assert.equal(stepLevel(MIN_LEVEL, -1), MIN_LEVEL);
  assert.equal(stepLevel(MAX_LEVEL, +1), MAX_LEVEL);
});

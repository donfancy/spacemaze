// Tests fuer die Level-Definitionen und die Auswahl-Logik (reine Funktionen).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, MIN_LEVEL, MAX_LEVEL, levelConfig, stepLevel } from '../src/core/levels.js';

test('Level 1 bis 15: Maze-Groesse waechst je Level um ein Rastermass', () => {
  assert.equal(MIN_LEVEL, 1);
  assert.equal(MAX_LEVEL, 15);
  assert.deepEqual(LEVELS.map((l) => l.n),
    [9, 11, 13, 15, 17, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35]);
  for (let level = 1; level <= 5; level++) {
    assert.equal(levelConfig(level).n, 7 + 2 * level);
  }
  for (let level = 6; level <= 15; level++) {
    assert.equal(levelConfig(level).n, 5 + 2 * level);
  }
});

test('Level 1 bis 5 sind Blockwelt mit Tank-Steuerung; ab 6: schmale Waende + Fahrt', () => {
  for (let level = 1; level <= 5; level++) {
    assert.equal(levelConfig(level).metric, undefined);
    assert.equal(levelConfig(level).drive, undefined);
  }
  for (let level = 6; level <= 15; level++) {
    assert.deepEqual(levelConfig(level).metric, { wall: 1, corridor: 5 });
    assert.equal(levelConfig(level).drive, true);
  }
});

test('Kampf-Levels ab 11: Geraden-Bias, Schiessen, wachsende Feind-Staffelung', () => {
  for (let level = 1; level <= 10; level++) {
    assert.equal(levelConfig(level).enemies, undefined, `Level ${level} ist feindfrei`);
    assert.equal(levelConfig(level).shoot, undefined, `Level ${level} ohne Schiessen`);
  }
  let prevCount = 0;
  let prevPatrol = 0;
  for (let level = 11; level <= 15; level++) {
    const cfg = levelConfig(level);
    assert.ok(cfg.straight > 0 && cfg.straight < 1, `Level ${level}: Geraden-Bias gesetzt`);
    assert.equal(cfg.shoot, true, `Level ${level}: Schiessen aktiv`);
    assert.ok(cfg.enemies.count > prevCount, `Level ${level}: mehr Feinde als davor`);
    assert.ok(cfg.enemies.patrol >= prevPatrol, `Level ${level}: Patrouillen-Anteil sinkt nie`);
    assert.ok(cfg.enemies.patrol >= 0 && cfg.enemies.patrol <= 1);
    prevCount = cfg.enemies.count;
    prevPatrol = cfg.enemies.patrol;
  }
  assert.equal(levelConfig(15).enemies.patrol, 1, 'Level 15: alle Rauten patrouillieren');
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

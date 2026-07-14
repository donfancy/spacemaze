// Tests fuer die Level-Definitionen und die Auswahl-Logik (reine Funktionen).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, MIN_LEVEL, MAX_LEVEL, levelConfig, levelColor, spinnerColor, stepLevel,
} from '../src/core/levels.js';
import { PHOSPHOR_GREEN, TEMPEST_BLUE, ARCADE_YELLOW } from '../src/render/colors.js';

test('Maze-Groessen: 1-15 wachsend, 16-20 moderat, 21-25 wieder wachsend', () => {
  assert.equal(MIN_LEVEL, 1);
  assert.equal(MAX_LEVEL, 25);
  assert.deepEqual(LEVELS.map((l) => l.n),
    [9, 11, 13, 15, 17, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 35, 35, 37, 37, 39,
      41, 43, 43, 45, 45]);
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
  for (let level = 6; level <= MAX_LEVEL; level++) {
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

test('Spinner-Levels 16-20: 16 fuehrt solo ein, ab 17 Mix; Geraden-Bias steigt', () => {
  for (let level = 1; level <= 15; level++) {
    assert.equal(levelConfig(level).spinners, undefined, `Level ${level} ohne Spinner`);
  }
  assert.equal(levelConfig(16).enemies, undefined, 'Level 16: nur Spinner (Mechanik lernen)');
  let prevSpinners = 0;
  let prevEnemies = 0;
  let prevStraight = levelConfig(15).straight;
  for (let level = 16; level <= 20; level++) {
    const cfg = levelConfig(level);
    assert.equal(cfg.shoot, true, `Level ${level}: Schiessen aktiv`);
    assert.ok(cfg.spinners.count >= prevSpinners, `Level ${level}: Spinner-Anzahl sinkt nie`);
    assert.ok(cfg.straight >= prevStraight, `Level ${level}: Geraden-Bias sinkt nie`);
    if (level >= 17) {
      assert.ok(cfg.enemies.count > prevEnemies, `Level ${level}: mehr Rauten als davor`);
      prevEnemies = cfg.enemies.count;
    }
    prevSpinners = cfg.spinners.count;
    prevStraight = cfg.straight;
  }
});

test('Flipper-Levels 21-25: wieder gruen, Flipper ueberall, Spinner ab 22 gelb und feuernd', () => {
  for (let level = 1; level <= 20; level++) {
    assert.equal(levelConfig(level).flippers, undefined, `Level ${level} ohne Flipper`);
    assert.equal(levelConfig(level).spinners?.shoot, undefined, `Level ${level}: Spinner feuern nicht`);
  }
  assert.equal(levelConfig(21).spinners, undefined, 'Level 21: Flipper solo einfuehren');
  let prevFlippers = 0;
  let prevSpinners = 0;
  let prevEnemies = 0;
  for (let level = 21; level <= 25; level++) {
    const cfg = levelConfig(level);
    assert.equal(cfg.shoot, true, `Level ${level}: Schiessen aktiv`);
    assert.ok(cfg.flippers.count >= prevFlippers, `Level ${level}: Flipper-Anzahl sinkt nie`);
    assert.ok(cfg.enemies.count >= prevEnemies, `Level ${level}: Tanker als Paar-Quelle dabei`);
    if (level >= 22) {
      assert.ok(cfg.spinners.count >= prevSpinners, `Level ${level}: Spinner-Anzahl sinkt nie`);
      assert.equal(cfg.spinners.shoot, true, `Level ${level}: Spinner feuern`);
      prevSpinners = cfg.spinners.count;
    }
    prevFlippers = cfg.flippers.count;
    prevEnemies = cfg.enemies.count;
  }
});

test('Farb-Thema: Level 6-10 und 16-20 Tempest-blau, alle anderen Phosphor-gruen', () => {
  for (const level of [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25]) {
    assert.equal(levelColor(level), PHOSPHOR_GREEN, `Level ${level} ist gruen`);
  }
  for (const level of [6, 7, 8, 9, 10, 16, 17, 18, 19, 20]) {
    assert.equal(levelColor(level), TEMPEST_BLUE, `Level ${level} ist blau`);
  }
  // Ausserhalb des Bereichs faellt die Farbe auf die Grundfarbe zurueck.
  assert.equal(levelColor(0), PHOSPHOR_GREEN);
  assert.equal(levelColor(undefined), PHOSPHOR_GREEN);
});

test('Spinner-Farbe: 16-20 Phosphor-gruen (auf Blau), 21-25 gelb (auf Gruen)', () => {
  for (const level of [16, 17, 18, 19, 20]) {
    assert.equal(spinnerColor(level), PHOSPHOR_GREEN, `Level ${level}: Spinner gruen`);
  }
  for (const level of [22, 23, 24, 25]) {
    assert.equal(spinnerColor(level), ARCADE_YELLOW, `Level ${level}: Spinner gelb`);
  }
  assert.equal(spinnerColor(undefined), PHOSPHOR_GREEN);
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

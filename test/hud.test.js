// Tests fuer die geteilten HUD-Texte/-Farben (core/hud.js) und die
// Steuer-Zeilen-Invariante: die angezeigten Lenk-Tasten (steerHintKeys)
// muessen exakt die Inverse des gyroTurn-Mappings sein -- ein
// Vorzeichenfehler dort waere in Level 26-30 spielverwirrend und faellt
// visuell kaum auf.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playHint, mapHint, replayHint, replayStatus, gameOverColor } from '../src/core/hud.js';
import { gyroTurn, gyroDirs, steerHintKeys, assistHintKeys } from '../src/world/gyro.js';
import { TANKER_RED } from '../src/render/colors.js';

test('steerHintKeys ist die Inverse von gyroTurn (alle vier Stellungen)', () => {
  for (let orient = 0; orient < 4; orient++) {
    const [leftKey, rightKey] = steerHintKeys(orient).toLowerCase().split('/');
    assert.equal(gyroTurn(orient, { [leftKey]: true }), 1,
      `orient ${orient}: die erste angezeigte Taste (${leftKey}) lenkt links`);
    assert.equal(gyroTurn(orient, { [rightKey]: true }), -1,
      `orient ${orient}: die zweite angezeigte Taste (${rightKey}) lenkt rechts`);
  }
  assert.equal(steerHintKeys(0), 'LEFT/RIGHT');
  assert.equal(steerHintKeys(1), 'DOWN/UP', 'bei 90 Grad erscheint Welt-links unten');
  assert.equal(steerHintKeys(2), 'RIGHT/LEFT');
  assert.equal(steerHintKeys(3), 'UP/DOWN');
  assert.equal(steerHintKeys(undefined), 'LEFT/RIGHT', 'ohne orient: aufrecht');
});

test('playHint: Steuer-Zeile je Modus, Wortlaut der 1980-Version', () => {
  assert.equal(playHint({}), 'ARROWS MOVE - X MAP');
  assert.equal(playHint({ drive: true }),
    'LEFT/RIGHT STEER - UP BOOST - DOWN ALIGN - X MAP');
  assert.equal(playHint({ drive: true, shoot: true }),
    'LEFT/RIGHT STEER - UP BOOST - DOWN ALIGN - SPACE FIRE - X MAP');
  assert.equal(playHint({ drive: true, shoot: true, orient: 1 }),
    'DOWN/UP STEER - LEFT BOOST - RIGHT ALIGN - SPACE FIRE - X MAP');
});

test('assistHintKeys ist die Inverse von gyroDirs (alle vier Stellungen)', () => {
  for (let orient = 0; orient < 4; orient++) {
    const { boost, align } = assistHintKeys(orient);
    assert.ok(gyroDirs(orient, { [boost.toLowerCase()]: true }).up,
      `orient ${orient}: die angezeigte Boost-Taste (${boost}) boostet`);
    assert.ok(gyroDirs(orient, { [align.toLowerCase()]: true }).down,
      `orient ${orient}: die angezeigte Ausricht-Taste (${align}) richtet aus`);
  }
});

test('mapHint: Q nur solange das Ziel offen ist, nach Game Over Retry', () => {
  assert.equal(mapHint({}), 'S RETURN  X EXIT');
  assert.equal(mapHint({ gameOver: true }), 'S RETRY  X EXIT');
  assert.equal(mapHint({ reachedGoal: true }), 'X EXIT');
});

test('mapHint bietet R an, sobald eine Aufzeichnung abspielbar ist', () => {
  assert.equal(mapHint({ replay: true }), 'S RETURN  R REPLAY  X EXIT');
  assert.equal(mapHint({ gameOver: true, replay: true }), 'S RETRY  R REPLAY  X EXIT');
  assert.equal(mapHint({ reachedGoal: true, replay: true }), 'R REPLAY  X EXIT');
});

test('replayHint/replayStatus: Steuer- und Statuszeile der Wiedergabe', () => {
  assert.equal(replayHint({}), 'SPACE PAUSE - LEFT/RIGHT SPEED - M SOUND - X MAP');
  assert.equal(replayHint({ cams: true }),
    'SPACE PAUSE - LEFT/RIGHT SPEED - C CAMERA - M SOUND - X MAP');
  assert.equal(replayStatus({ t: 34, duration: 130, speed: 1 }), 'REPLAY 0:34 / 2:10');
  assert.equal(replayStatus({ t: 5, duration: 65, speed: 4 }), 'REPLAY 0:05 / 1:05  >> 4x');
  assert.equal(replayStatus({ t: 5, duration: 65, speed: -2 }), 'REPLAY 0:05 / 1:05  << 2x');
  assert.equal(replayStatus({ t: 5, duration: 65, speed: 2, paused: true }),
    'REPLAY 0:05 / 1:05  PAUSE');
});

test('gameOverColor pulsiert zwischen Feind-Rot und Weiss (1.2 Hz)', () => {
  // Bei sin=-1 (t = 0.75 Perioden) reines Feind-Rot, bei sin=+1 reines Weiss.
  const period = 1 / 1.2;
  assert.equal(gameOverColor(0.75 * period), TANKER_RED);
  assert.equal(gameOverColor(0.25 * period), '#ffffff');
  // Rot-Kanal ist immer voll (TANKER_RED beginnt mit ff).
  for (const t of [0, 0.1, 0.2, 0.3, 0.4]) {
    assert.match(gameOverColor(t), /^#ff[0-9a-f]{4}$/);
  }
});

test('selectorArrows: hell nur, wenn der Tastendruck etwas bewirkt', async () => {
  const { selectorArrows } = await import('../src/core/hud.js');
  const { MIN_LEVEL, MAX_LEVEL } = await import('../src/core/levels.js');
  // Mittendrin: beide Level-Pfeile hell; 1980 gewaehlt -> nur rauf hell.
  assert.deepEqual(selectorArrows({ level: 5, engine: '1980' }),
    { left: true, right: true, down: false, up: true });
  // Raender: am unteren Level kein links, am oberen kein rechts.
  assert.equal(selectorArrows({ level: MIN_LEVEL, engine: '1980' }).left, false);
  assert.equal(selectorArrows({ level: MAX_LEVEL, engine: '1980' }).right, false);
  // 2026 gewaehlt: rauf gedimmt, runter hell.
  assert.deepEqual(selectorArrows({ level: 5, engine: '2026' }),
    { left: true, right: true, down: true, up: false });
  // Demo: die Pfeile folgen der gemerkten AUSWAHL, nicht dem Demo-Level.
  assert.equal(selectorArrows({ level: 12, demo: true, demoSavedLevel: MIN_LEVEL, engine: '1980' }).left,
    false);
});

test('copyrightLine: Jahreszahl folgt der gewaehlten Engine', async () => {
  const { copyrightLine } = await import('../src/core/hud.js');
  assert.equal(copyrightLine('1980'), '(C) BB DESIGN 1980');
  assert.equal(copyrightLine('2026'), '(C) BB DESIGN 2026');
});

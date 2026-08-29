// Skybox-Thema der 2026-Engine (pur): Crescendo, Level-Palette, Determinismus.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  skyTheme, startscreenSkyTheme, skyGain, SKY_GAIN_MIN, SKY_GAIN_MAX,
} from '../src/render2026/skyTheme.js';
import {
  PHOSPHOR_GREEN, TEMPEST_BLUE, NEON_MAGENTA,
} from '../src/render/colors.js';
import { FIREWORK_COLORS } from '../src/world/fireworks.js';
import { MIN_LEVEL, MAX_LEVEL } from '../src/core/levels.js';

const HEX = /^#[0-9a-f]{6}$/i;

test('skyGain: Crescendo von dezent (Level 1) nach voll (letztes Level)', () => {
  assert.equal(skyGain(MIN_LEVEL), SKY_GAIN_MIN);
  assert.equal(skyGain(MAX_LEVEL), SKY_GAIN_MAX);
  let prev = -Infinity;
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    const g = skyGain(level);
    assert.ok(g >= prev, `Gain faellt bei Level ${level}`);
    assert.ok(g >= SKY_GAIN_MIN && g <= SKY_GAIN_MAX);
    prev = g;
  }
});

test('skyTheme: gueltiges Rezept fuer jedes Level', () => {
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    const t = skyTheme(level, 12345);
    assert.ok(t.layers.length >= 2 && t.layers.length <= 3);
    for (const l of t.layers) {
      assert.match(l.hex, HEX);
      assert.ok(l.scale > 0);
    }
    assert.match(t.band.hex, HEX);
    assert.ok(t.band.strength > 0);
    assert.equal(t.horizonFade, 1, 'Welt-Himmel blendet unterm Horizont aus');
    assert.ok(t.dust > 0);
    assert.equal(t.gain, skyGain(level));
  }
});

test('skyTheme: Farbschichten folgen der Level-Palette', () => {
  // Gruene Levels: Phosphor-Gruen + Magenta-Akzent.
  const green = skyTheme(1, 7);
  assert.equal(green.layers[0].hex, PHOSPHOR_GREEN);
  assert.equal(green.layers[1].hex, NEON_MAGENTA);
  // Blaue Levels (6-10): Tempest-Blau + Akzent (nicht die Basisfarbe).
  const blue = skyTheme(6, 7);
  assert.equal(blue.layers[0].hex, TEMPEST_BLUE);
  assert.notEqual(blue.layers[1].hex, TEMPEST_BLUE);
});

test('skyTheme: Arcade-Finale (26+) mischt drei verschiedene Feuerwerks-Farben', () => {
  for (const level of [26, 30]) {
    const t = skyTheme(level, 99);
    assert.equal(t.layers.length, 3);
    const hexes = t.layers.map((l) => l.hex);
    assert.equal(new Set(hexes).size, 3, 'Farben paarweise verschieden');
    for (const hex of hexes) assert.ok(FIREWORK_COLORS.includes(hex));
  }
});

test('skyTheme: deterministisch, aber pro Seed und Level verschieden', () => {
  assert.deepEqual(skyTheme(26, 42), skyTheme(26, 42));
  assert.notEqual(skyTheme(4, 1).seed, skyTheme(4, 2).seed);
  assert.notEqual(skyTheme(4, 1).seed, skyTheme(5, 1).seed);
});

test('startscreenSkyTheme: dezenter Anfang, volle Kugel, deterministisch', () => {
  const t = startscreenSkyTheme();
  assert.deepEqual(t, startscreenSkyTheme());
  assert.equal(t.gain, SKY_GAIN_MIN);
  assert.equal(t.horizonFade, 0, 'Startscreen-Kamera umtanzt den Wuerfel');
  assert.equal(t.layers[0].hex, PHOSPHOR_GREEN);
});

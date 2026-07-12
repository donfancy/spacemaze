// Tests fuer die Farbpalette und die reine Farb-Mathe (render/colors.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOSPHOR_GREEN, TEMPEST_BLUE, parseHex, toHex, mixColors } from '../src/render/colors.js';

test('parseHex und toHex sind Umkehrfunktionen', () => {
  assert.deepEqual(parseHex('#4dff7a'), [0x4d, 0xff, 0x7a]);
  assert.equal(toHex([0x4d, 0xff, 0x7a]), '#4dff7a');
  for (const c of [PHOSPHOR_GREEN, TEMPEST_BLUE, '#000000', '#ffffff', '#0a0b0c']) {
    assert.equal(toHex(parseHex(c)), c);
  }
});

test('toHex rundet und klemmt Kanaele auf 0..255', () => {
  assert.equal(toHex([300, -5, 12.4]), '#ff000c');
  assert.equal(toHex([127.5, 127.49, 255]), '#807fff');
});

test('mixColors: Endpunkte exakt, Mitte gemittelt, t geklemmt', () => {
  assert.equal(mixColors(PHOSPHOR_GREEN, TEMPEST_BLUE, 0), PHOSPHOR_GREEN);
  assert.equal(mixColors(PHOSPHOR_GREEN, TEMPEST_BLUE, 1), TEMPEST_BLUE);
  assert.equal(mixColors('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixColors(PHOSPHOR_GREEN, TEMPEST_BLUE, -3), PHOSPHOR_GREEN);
  assert.equal(mixColors(PHOSPHOR_GREEN, TEMPEST_BLUE, 7), TEMPEST_BLUE);
});

test('mixColors auf gleicher Farbe ist ein No-Op (Orbit bleibt gruen)', () => {
  for (const t of [0, 0.3, 1]) {
    assert.equal(mixColors(PHOSPHOR_GREEN, PHOSPHOR_GREEN, t), PHOSPHOR_GREEN);
  }
});

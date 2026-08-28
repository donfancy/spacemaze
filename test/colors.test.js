// Tests fuer die Farbpalette und die reine Farb-Mathe (render/colors.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOSPHOR_GREEN, TEMPEST_BLUE, parseHex, toHex, mixColors, linearLuminance, diagramBoost,
} from '../src/render/colors.js';

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

test('linearLuminance: Rec.-709-Gewichte im LINEAREN Farbraum (wie der Bloom-Pass)', () => {
  assert.equal(linearLuminance('#000000'), 0);
  assert.ok(Math.abs(linearLuminance('#ffffff') - 1) < 1e-9);
  assert.ok(Math.abs(linearLuminance('#00ff00') - 0.7152) < 1e-9, 'Gruen dominiert');
  const green = linearLuminance(PHOSPHOR_GREEN);
  assert.ok(green > 0.7 && green < 0.8, 'Phosphor-Gruen ~0.745 (linear!)');
  const blue = linearLuminance(TEMPEST_BLUE);
  assert.ok(blue > 0.2 && blue < 0.26, 'Tempest-Blau ~0.227 (linear!)');
});

test('diagramBoost: Ego-Boost bei mix 0, luminanz-normiert bei mix 1 (Overglow-Fix)', () => {
  const opts = { ego: 2.2, targetLum: 1.0 };
  assert.equal(diagramBoost(PHOSPHOR_GREEN, 0, opts), 2.2, 'Ego-Ansicht unveraendert');
  const green = diagramBoost(PHOSPHOR_GREEN, 1, opts);
  assert.ok(green > 1.25 && green < 1.45, 'helles Gruen wird deutlich gezaehmt (~1.34)');
  const blue = diagramBoost(TEMPEST_BLUE, 1, opts);
  assert.equal(blue, 2.2, 'dunkles Blau bleibt am Ego-Deckel -- praktisch unveraendert');
  // Marker-Variante: hoeherer Deckel fuer dunkle Farben.
  const marker = diagramBoost(TEMPEST_BLUE, 1, { ego: 2.2, targetLum: 1.0, maxBoost: 3.0 });
  assert.ok(marker > 2.2 && marker <= 3.0, 'der hoehere Deckel laesst dunklen Farben mehr Glow');
  // Schwarz laeuft nicht gegen unendlich (lum-Floor + Deckel).
  assert.ok(diagramBoost('#000000', 1, { ego: 2.2, targetLum: 1.0, maxBoost: 3.0 }) <= 3.0);
});

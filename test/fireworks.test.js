// Tests fuer das Ziel-Feuerwerk (world/fireworks.js): reine, deterministische
// Berechnung -- Strahlen leben gestaffelt, stehen in der Scheibe ums Ziel und
// durchlaufen die klassischen Arcade-Farben in fester Reihenfolge bis Weiss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIREWORK, FIREWORK_COLORS, fireworkBeams } from '../src/world/fireworks.js';

const OPTS = { seed: 4711, center: [10, 20], spread: 11, height: 40 };

// Farbindex in der Show-Reihenfolge; Weiss ist das Finale.
function colorIdx(color) {
  return color === '#ffffff' ? FIREWORK_COLORS.length : FIREWORK_COLORS.indexOf(color);
}

test('vor dem Start und nach dem Ende ist nichts zu sehen, mittendrin funkelt es', () => {
  assert.deepEqual(fireworkBeams(-0.1, OPTS), []);
  assert.deepEqual(fireworkBeams(FIREWORK.duration, OPTS), []);
  assert.ok(fireworkBeams(1.2, OPTS).length > 10);
});

test('deterministisch: gleiches Alter + gleicher Seed -> gleiche Strahlen', () => {
  assert.deepEqual(fireworkBeams(1.2, OPTS), fireworkBeams(1.2, OPTS));
});

test('Strahlen stehen in der Scheibe ums Ziel, senkrecht mit endlicher Hoehe', () => {
  for (const age of [0.3, 1.0, 2.0, 2.7]) {
    for (const b of fireworkBeams(age, OPTS)) {
      assert.ok(Math.hypot(b.x - OPTS.center[0], b.z - OPTS.center[1]) <= OPTS.spread + 1e-9,
        'in der Scheibe');
      assert.ok(b.top > 0 && b.top <= OPTS.height, 'Hoehe positiv und begrenzt');
      assert.ok(b.intensity > 0 && b.intensity <= 1, 'Helligkeit in (0, 1]');
      assert.ok(colorIdx(b.color) >= 0, 'nur Show-Farben');
    }
  }
});

test('jeder Strahl schaltet die Farben in Boris-Reihenfolge durch und endet in Weiss', () => {
  // Strahlen sind ueber ihre (feste) Position identifizierbar; fein abtasten.
  const seen = new Map(); // "x,z" -> letzter Farbindex
  const finale = new Set(); // Strahlen, die Weiss erreicht haben
  const all = new Set();
  for (let age = 0; age < FIREWORK.duration; age += 0.02) {
    for (const b of fireworkBeams(age, OPTS)) {
      const key = b.x.toFixed(9) + ',' + b.z.toFixed(9);
      const idx = colorIdx(b.color);
      all.add(b.color);
      if (seen.has(key)) {
        assert.ok(idx >= seen.get(key), 'Farbfolge laeuft nur vorwaerts (Rot -> ... -> Weiss)');
      }
      seen.set(key, idx);
      if (idx === FIREWORK_COLORS.length) finale.add(key);
    }
  }
  assert.equal(seen.size, FIREWORK.count, 'alle Strahlen sind einmal aufgetreten');
  assert.equal(finale.size, FIREWORK.count, 'jeder Strahl erreicht das weisse Finale');
  // Die ganze Show zeigt alle sechs Klassiker plus Weiss.
  assert.equal(all.size, FIREWORK_COLORS.length + 1, 'alle Farben kommen vor');
});

test('Geburten sind gestaffelt: am Anfang wenige, spaeter viele Strahlen gleichzeitig', () => {
  const early = fireworkBeams(0.05, OPTS).length;
  const mid = fireworkBeams(FIREWORK.duration / 2, OPTS).length;
  assert.ok(early < FIREWORK.count / 2, 'nicht alle starten sofort');
  assert.ok(mid > early, 'zur Mitte hin funkelt es dichter');
});

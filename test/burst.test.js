// Tests fuer die Splitter-Explosionen (world/burst.js): deterministische
// Streuung, radialer Flug, Verblassen und Lebensdauer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burstSegments } from '../src/world/burst.js';

const OPTS = { center: [1, 2, 3], count: 10, speed: 2, life: 0.6, size: 0.1, seed: 5 };

function radius(seg) {
  const mid = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2, (seg[0][2] + seg[1][2]) / 2];
  return Math.hypot(mid[0] - OPTS.center[0], mid[1] - OPTS.center[1], mid[2] - OPTS.center[2]);
}

test('burstSegments: count Splitter, fade 1 -> 0, ausserhalb der Lebensdauer null', () => {
  const early = burstSegments(0.01, OPTS);
  assert.equal(early.segments.length, 10);
  assert.ok(early.fade > 0.9);
  const late = burstSegments(0.55, OPTS);
  assert.ok(late.fade < 0.15 && late.fade > 0);
  assert.equal(burstSegments(0.6, OPTS), null, 'vorbei');
  assert.equal(burstSegments(-0.1, OPTS), null, 'noch nicht geboren');
});

test('Splitter fliegen radial nach aussen und streuen verschieden', () => {
  const a = burstSegments(0.1, OPTS);
  const b = burstSegments(0.3, OPTS);
  for (let i = 0; i < OPTS.count; i++) {
    assert.ok(radius(b.segments[i]) > radius(a.segments[i]), `Splitter ${i} entfernt sich`);
  }
  // Nicht alle in dieselbe Richtung.
  const dirs = new Set(a.segments.map((s) => s[1].map((v) => v.toFixed(4)).join(',')));
  assert.ok(dirs.size > OPTS.count / 2, 'Richtungen streuen');
});

test('deterministisch: gleiches Alter + Optionen -> gleiche Segmente; anderer Seed streut anders', () => {
  assert.deepEqual(burstSegments(0.2, OPTS), burstSegments(0.2, OPTS));
  assert.notDeepEqual(burstSegments(0.2, OPTS), burstSegments(0.2, { ...OPTS, seed: 6 }));
});

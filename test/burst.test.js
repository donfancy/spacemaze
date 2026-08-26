// Tests fuer die Splitter-Explosionen (world/burst.js): deterministische
// Streuung, radialer Flug, Verblassen und Lebensdauer -- und die flaechigen
// Truemmer-Dreiecke (burstShards) der 2026-Engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burstSegments, burstShards } from '../src/world/burst.js';

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

// --- Flaechige Truemmer (burstShards) ---------------------------------------

const SHARD_OPTS = { ...OPTS, shardCount: 7, shardSize: 0.3 };

function triCenter(tri) {
  return [0, 1, 2].map((a) => (tri[0][a] + tri[1][a] + tri[2][a]) / 3);
}

test('burstShards: shardCount Dreiecke, gleicher fade, ohne shardCount null', () => {
  const s = burstShards(0.1, SHARD_OPTS);
  assert.equal(s.triangles.length, 7);
  assert.ok(s.triangles.every((t) => t.length === 3
    && t.every((p) => p.length === 3 && p.every(Number.isFinite))));
  assert.equal(s.fade, burstSegments(0.1, SHARD_OPTS).fade, 'fade wie die Splitter');
  assert.equal(burstShards(0.6, SHARD_OPTS), null, 'vorbei');
  assert.equal(burstShards(-0.1, SHARD_OPTS), null, 'noch nicht geboren');
  assert.equal(burstShards(0.1, OPTS), null, 'ohne shardCount keine Truemmer');
});

test('Truemmer fliegen radial nach aussen und TAUMELN (Form aendert sich)', () => {
  const a = burstShards(0.1, SHARD_OPTS);
  const b = burstShards(0.3, SHARD_OPTS);
  for (let i = 0; i < 7; i++) {
    const ra = Math.hypot(...triCenter(a.triangles[i]).map((v, d) => v - OPTS.center[d]));
    const rb = Math.hypot(...triCenter(b.triangles[i]).map((v, d) => v - OPTS.center[d]));
    assert.ok(rb > ra, `Truemmer ${i} entfernt sich`);
    // Taumeln: die Ecken-Lage RELATIV zum Mittelpunkt dreht sich mit der Zeit.
    const relA = a.triangles[i][0].map((v, d) => v - triCenter(a.triangles[i])[d]);
    const relB = b.triangles[i][0].map((v, d) => v - triCenter(b.triangles[i])[d]);
    const diff = Math.hypot(...relA.map((v, d) => v - relB[d]));
    assert.ok(diff > 1e-3, `Truemmer ${i} taumelt`);
  }
});

test('burstShards deterministisch, Seed streut anders', () => {
  assert.deepEqual(burstShards(0.2, SHARD_OPTS), burstShards(0.2, SHARD_OPTS));
  assert.notDeepEqual(burstShards(0.2, SHARD_OPTS), burstShards(0.2, { ...SHARD_OPTS, seed: 6 }));
});

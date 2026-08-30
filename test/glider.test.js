import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLIDER } from '../src/world/glider.js';

test('der Gleiter ist links/rechts symmetrisch (Kanten wie Fuellung)', () => {
  const key = ([x, y, z]) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const mirrorKey = ([x, y, z]) => key([-x, y, z]);
  const segKeys = new Set(GLIDER.segments.map(([a, b]) => [key(a), key(b)].sort().join('|')));
  for (const [a, b] of GLIDER.segments) {
    assert.ok(segKeys.has([mirrorKey(a), mirrorKey(b)].sort().join('|')),
      'jede Kante hat ihr Spiegelbild');
  }
  const triKeys = new Set(GLIDER.triangles.map((t) => t.map(key).sort().join('|')));
  for (const t of GLIDER.triangles) {
    assert.ok(triKeys.has(t.map(mirrorKey).sort().join('|')),
      'jedes Dreieck hat sein Spiegelbild');
  }
});

test('der Gleiter passt in einen Gang und fliegt ueber dem Boden', () => {
  for (const [a, b] of GLIDER.segments) {
    for (const [x, y] of [a, b]) {
      assert.ok(Math.abs(x) < 0.5, 'schmaler als die Gangbreite');
      assert.ok(y + GLIDER.height > 0, 'kein Punkt unter dem Boden');
      assert.ok(y + GLIDER.height < 0.5, 'unter der Augenhoehe (0.5 Zellen)');
    }
  }
  assert.ok(GLIDER.triangles.length >= 5, 'genug Fuellung fuer den Koerper');
});

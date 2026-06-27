import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDepthBuffer, splitEdgeByOcclusion } from '../src/render/occlusion.js';
import { createCamera } from '../src/math/camera.js';

const VP = { width: 800, height: 600, fov: Math.PI / 2, near: 0.1 };
const cam = createCamera({ position: [0, 0, 0], yaw: 0, pitch: 0 }); // blickt -z
// Verdecker quer vor der Kamera bei Tiefe 2 (x von -1 bis 1).
const OCCLUDER = [[[-1, 0, -2], [1, 0, -2]]];

test('buildDepthBuffer traegt die Verdecker-Tiefe in die mittleren Spalten ein', () => {
  const db = buildDepthBuffer(OCCLUDER, cam, VP);
  const mid = Math.floor(db.cols / 2);
  assert.ok(Math.abs(db.depth[mid] - 2) < 0.2, `Mitte sollte Tiefe ~2 haben, war ${db.depth[mid]}`);
  assert.equal(db.depth[0], Infinity); // Rand: keine Wand
});

test('Kante hinter dem Verdecker ist komplett verdeckt', () => {
  const db = buildDepthBuffer(OCCLUDER, cam, VP);
  const segs = splitEdgeByOcclusion([[-1, 0, -5], [1, 0, -5]], cam, VP, db);
  assert.ok(segs.length >= 1);
  assert.ok(segs.every((s) => s.occluded), 'alle Stuecke sollten verdeckt sein');
});

test('Kante vor dem Verdecker ist komplett sichtbar', () => {
  const db = buildDepthBuffer(OCCLUDER, cam, VP);
  const segs = splitEdgeByOcclusion([[-1, 0, -1], [1, 0, -1]], cam, VP, db);
  assert.ok(segs.every((s) => !s.occluded), 'alle Stuecke sollten sichtbar sein');
});

test('teilweise verdeckte Kante wird in sichtbar UND verdeckt aufgeteilt', () => {
  const db = buildDepthBuffer(OCCLUDER, cam, VP);
  // Breite Kante hinter dem Verdecker, ragt links/rechts darueber hinaus.
  const segs = splitEdgeByOcclusion([[-3, 0, -5], [3, 0, -5]], cam, VP, db);
  assert.ok(segs.some((s) => s.occluded), 'mittiges Stueck verdeckt');
  assert.ok(segs.some((s) => !s.occluded), 'aeussere Stuecke sichtbar');
});

test('ohne Verdecker ist alles sichtbar', () => {
  const db = buildDepthBuffer([], cam, VP);
  const segs = splitEdgeByOcclusion([[-1, 0, -5], [1, 0, -5]], cam, VP, db);
  assert.ok(segs.every((s) => !s.occluded));
});

test('Kante komplett hinter der Kamera ergibt nichts', () => {
  const db = buildDepthBuffer(OCCLUDER, cam, VP);
  assert.deepEqual(splitEdgeByOcclusion([[-1, 0, 5], [1, 0, 5]], cam, VP, db), []);
});

test('Sub-Segmente tragen eine plausible Tiefe', () => {
  const db = buildDepthBuffer([], cam, VP);
  const segs = splitEdgeByOcclusion([[0, 0, -4], [0, 1, -4]], cam, VP, db);
  for (const s of segs) assert.ok(Math.abs(s.depth - 4) < 0.5);
});

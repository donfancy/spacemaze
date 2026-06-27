import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectOccluders, occludeEdge } from '../src/render/occlusion.js';
import { createCamera } from '../src/math/camera.js';
import { worldToView } from '../src/math/camera.js';
import { project } from '../src/render/projection.js';

const VP = { width: 800, height: 600, fov: Math.PI / 2, near: 0.1 };
const cam = createCamera({ position: [0, 0, 0], yaw: 0, pitch: 0 }); // blickt -z
// Verdecker quer vor der Kamera bei Tiefe 2 (x von -1 bis 1).
const OCCLUDER_FP = [[[-1, 0, -2], [1, 0, -2]]];
const occ = projectOccluders(OCCLUDER_FP, cam, VP);

const screenX = (p) => project(worldToView(cam, p), VP).x;

test('projectOccluders liefert einen Span mit korrekter Tiefe', () => {
  assert.equal(occ.length, 1);
  assert.ok(Math.abs(1 / occ[0].invL - 2) < 1e-9);
  assert.ok(Math.abs(1 / occ[0].invR - 2) < 1e-9);
});

test('Kante hinter dem Verdecker ist komplett verdeckt', () => {
  const segs = occludeEdge([[-1, 0, -5], [1, 0, -5]], cam, VP, occ);
  assert.ok(segs.length >= 1);
  assert.ok(segs.every((s) => s.occluded));
});

test('Kante vor dem Verdecker ist komplett sichtbar', () => {
  const segs = occludeEdge([[-1, 0, -1], [1, 0, -1]], cam, VP, occ);
  assert.ok(segs.every((s) => !s.occluded));
});

test('teilweise verdeckte Kante: sichtbar-verdeckt-sichtbar', () => {
  const segs = occludeEdge([[-3, 0, -5], [3, 0, -5]], cam, VP, occ);
  assert.ok(segs.some((s) => s.occluded), 'mittiges Stueck verdeckt');
  assert.ok(segs.some((s) => !s.occluded), 'aeussere Stuecke sichtbar');
});

test('Verdeckungsgrenze liegt EXAKT am Rand des Verdeckers', () => {
  // Breite Kante hinter dem Verdecker. Der verdeckte Teil muss genau im
  // Bildschirm-x-Bereich des Verdeckers liegen (analytisch exakt).
  const segs = occludeEdge([[-3, 0, -5], [3, 0, -5]], cam, VP, occ);
  const xOccL = screenX([-1, 0, -2]); // linker Verdecker-Rand am Bildschirm
  const xOccR = screenX([1, 0, -2]);
  for (const s of segs) {
    if (!s.occluded) continue;
    const lo = Math.min(s.a[0], s.b[0]);
    const hi = Math.max(s.a[0], s.b[0]);
    assert.ok(lo >= xOccL - 0.5 && hi <= xOccR + 0.5,
      `verdecktes Stueck [${lo.toFixed(1)},${hi.toFixed(1)}] ausserhalb [${xOccL.toFixed(1)},${xOccR.toFixed(1)}]`);
  }
});

test('ohne Verdecker ist alles sichtbar', () => {
  const segs = occludeEdge([[-1, 0, -5], [1, 0, -5]], cam, VP, []);
  assert.equal(segs.length, 1);
  assert.ok(!segs[0].occluded);
});

test('vertikaler Pfosten wird einheitlich klassifiziert (nie gemischt)', () => {
  const hinten = occludeEdge([[0, 0, -5], [0, 1.2, -5]], cam, VP, occ); // hinter Verdecker
  const vorne = occludeEdge([[0, 0, -1], [0, 1.2, -1]], cam, VP, occ);  // vor Verdecker
  assert.equal(hinten.length, 1);
  assert.equal(vorne.length, 1);
  assert.ok(hinten[0].occluded);
  assert.ok(!vorne[0].occluded);
});

test('Kante komplett hinter der Kamera ergibt nichts', () => {
  assert.deepEqual(occludeEdge([[-1, 0, 5], [1, 0, 5]], cam, VP, occ), []);
});

test('eigene Wand verdeckt sich nicht selbst (gleiche Tiefe)', () => {
  // Eine Kante, die exakt auf einem Verdecker-Grundriss liegt (y angehoben).
  const o = projectOccluders([[[-1, 0, -3], [1, 0, -3]]], cam, VP);
  const segs = occludeEdge([[-1, 1.2, -3], [1, 1.2, -3]], cam, VP, o);
  assert.ok(segs.every((s) => !s.occluded), 'eigene Wand darf nicht verdecken');
});

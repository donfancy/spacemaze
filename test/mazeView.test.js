// Tests fuer die pure Geometrie in scenes/mazeView.js: Massstaebe
// (unitSize/cellSize), die Flaechen-Posen und vor allem blendPose --
// die Quaternion-Ueberblendung der Schwenks (bekannte Falle: getrenntes
// forward/up-Lerp kippt um, wenn beide in der Mitte antiparallel werden).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../src/world/maze.js';
import { createMetric } from '../src/world/metric.js';
import { SIDE_FACES } from '../src/world/cubeFaces.js';
import {
  CUBE_SIZE, unitSize, cellSize, mapPose, egoPose, blendPose,
} from '../src/scenes/mazeView.js';

const EPS = 1e-9;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

function assertOrthonormal(pose, tag) {
  assert.ok(Math.abs(len(pose.forward) - 1) < 1e-6, `${tag}: |forward| = 1`);
  assert.ok(Math.abs(len(pose.up) - 1) < 1e-6, `${tag}: |up| = 1`);
  assert.ok(Math.abs(dot(pose.forward, pose.up)) < 1e-6, `${tag}: forward senkrecht up`);
  for (const c of [...pose.position, ...pose.forward, ...pose.up]) {
    assert.ok(Number.isFinite(c), `${tag}: keine NaN/Infinity`);
  }
}

test('unitSize/cellSize: Blockwelt gleich, schmale Waende strecken den Gang', () => {
  const block = generateMaze(11, { seed: 1 });
  assert.ok(Math.abs(unitSize(block) - CUBE_SIZE / 11) < EPS, 'Blockwelt: Einheit = Kante/n');
  assert.ok(Math.abs(cellSize(block) - unitSize(block)) < EPS, 'Blockwelt: Gang = Einheit');

  const thin = generateMaze(11, { seed: 1, metric: createMetric({ wall: 1, corridor: 5 }) });
  assert.ok(Math.abs(cellSize(thin) - 5 * unitSize(thin)) < EPS, 'THIN: Gang = 5 Einheiten');
  assert.ok(cellSize(thin) > cellSize(block), 'THIN-Gaenge sind (relativ) breiter als Block-Zellen');
});

test('mapPose/egoPose liefern orthonormale Posen auf jeder Seitenflaeche', () => {
  const fov = Math.PI / 2.4;
  for (const face of SIDE_FACES) {
    const map = mapPose(face, fov);
    assertOrthonormal(map, 'mapPose');
    assert.deepEqual(map.forward.map((v) => -v), face.normal, 'Karte blickt auf die Flaeche');
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const ego = egoPose(face, 1.2, 3.4, yaw, 0.2);
      assertOrthonormal(ego, `egoPose yaw=${yaw}`);
      assert.ok(Math.abs(dot(ego.forward, face.normal)) < 1e-6, 'Ego blickt IN der Flaeche');
      assert.deepEqual(ego.up, face.normal, 'Ego-oben = Flaechen-Normale');
    }
  }
});

test('blendPose: Endpunkte exakt, Zwischenposen orthonormal -- auch im Antiparallel-Fall', () => {
  const fov = Math.PI / 2.4;
  for (const face of SIDE_FACES) {
    const a = mapPose(face, fov);
    // Alle vier Blickrichtungen -- darunter der dokumentierte Umkipp-Fall
    // (Ego-Blick "Sued": forward und up der beiden Posen antiparallel).
    for (const yaw of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      const b = egoPose(face, 1.2, 1.2, yaw, 0.2);
      const at0 = blendPose(a, b, 0);
      const at1 = blendPose(a, b, 1);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(at0.forward[i] - a.forward[i]) < 1e-6, 'e=0: forward = Start');
        assert.ok(Math.abs(at1.forward[i] - b.forward[i]) < 1e-6, 'e=1: forward = Ziel');
        assert.ok(Math.abs(at0.position[i] - a.position[i]) < 1e-9, 'e=0: Position = Start');
        assert.ok(Math.abs(at1.position[i] - b.position[i]) < 1e-9, 'e=1: Position = Ziel');
      }
      for (const e of [0.25, 0.5, 0.75]) {
        assertOrthonormal(blendPose(a, b, e), `face ${face.name ?? '?'} yaw=${yaw} e=${e}`);
      }
    }
  }
});

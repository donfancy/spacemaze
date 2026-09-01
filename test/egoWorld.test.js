// Gemeinsamer 1980-Welt-Zeichner (scenes/egoWorld.js): der Schiffs-Burst
// des Spieler-Crashs traegt only2026 und darf NUR in der 2026-Engine
// erscheinen -- 1980 sitzt die Kamera im Schiff, dort bleibt der Crash das
// klassische Zerbersten des Bildes (die Splitter saessen direkt im Auge).
import test from 'node:test';
import assert from 'node:assert';

import { generateMaze } from '../src/world/maze.js';
import { cellCenter } from '../src/world/mazeWorld.js';
import { SIDE_FACES } from '../src/world/cubeFaces.js';
import { createCamera } from '../src/math/camera.js';
import { buildEgoStatics, renderEgoWorld } from '../src/scenes/egoWorld.js';

function fakeRenderer() {
  return {
    width: 800,
    height: 600,
    scenes: 0,
    renderScene() { this.scenes++; },
    drawPolylines() {},
    drawText() {},
    worldToScreen() { return { x: 400, y: 300 }; },
  };
}

function drawWithBursts(bursts) {
  const maze = generateMaze(9, { seed: 7 });
  const face = SIDE_FACES[0];
  const statics = buildEgoStatics(maze, face);
  const { cell, unit } = statics;
  const px = cellCenter(maze, 1, 1, unit);
  const r = fakeRenderer();
  renderEgoWorld(r, createCamera(), {
    maze, face, statics, px, pz: px, yaw: 0, t: 1, near: 0.1 * cell,
    stars: null, rainbow: false, reached: false, reachedAt: 0,
    waves: [], enemies: [], spinners: [], flippers: [], pulsars: [],
    foeShots: [], shots: [],
    bursts: bursts.map((b) => ({
      born: 0.8, center: [px, 0.5 * cell, px], seed: 1, count: 8,
      speed: cell, life: 1.2, size: 0.1 * cell, color: '#ffffff', ...b,
    })),
    enemyCol: '#ff3b30', spinnerCol: '#4dff7a',
  });
  return r.scenes;
}

test('renderEgoWorld: only2026-Bursts (Schiffs-Explosion) zeichnet 1980 nicht', () => {
  const none = drawWithBursts([]);
  const one = drawWithBursts([{}]);
  assert.equal(one, none + 1, 'ein normaler Burst = genau eine Splitter-Szene');
  const withShip = drawWithBursts([{}, { only2026: true }]);
  assert.equal(withShip, one, 'der only2026-Burst kommt in 1980 NICHT dazu');
  const two = drawWithBursts([{}, {}]);
  assert.equal(two, one + 1, 'Gegentest: ein zweiter normaler Burst schon');
});

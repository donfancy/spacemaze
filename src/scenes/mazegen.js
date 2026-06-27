// Zustand "Labyrinth-Erzeugung": uebernimmt nahtlos die Draufsicht vom Andocken
// und inszeniert den Aufbau:
//   1. das feste Quadrat (Grid-Rand) steht bereits (deckungsgleich mit dem Andock-Quadrat),
//   2. S/G-Marker blenden ein,
//   3. die Korridor-Randlinien "fressen" sich in der Grab-Reihenfolge hinein.
// Danach folgt der Uebergang ins Spiel.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { growthOutline, gridBorderWorld, mapGridToWorld, mapSegmentsToWorld } from '../world/mazeGeometry.js';
import { topDownDock } from '../world/cameraPaths.js';
import { randomSeed } from '../util/rng.js';

const CUBE_SIZE = 2.4;
const PLANE_Y = CUBE_SIZE / 2;  // Oberseiten-Ebene -- deckungsgleich mit dem Andock-Quadrat
const LEVEL1_N = 11;

const MARKER_TIME = 0.7;  // Sekunden: S/G blenden ein
const GROW_TIME = 2.6;    // Sekunden: Labyrinth waechst
const HOLD_TIME = 1.0;    // Sekunden: fertiges Labyrinth steht

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function createMazeGen(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });
  const dock = topDownDock([0, 0, 0], CUBE_SIZE, camera.fov, 0.85);

  let maze = null;
  let border = null;
  let t = 0;

  function applyDock() {
    camera.position = dock.position;
    camera.yaw = dock.yaw;
    camera.pitch = dock.pitch;
  }

  // Buchstaben-Marker an einer Zellmitte (3D-Position -> 2D-Bildposition).
  function drawMarker(renderer, cell, label, intensity) {
    if (intensity <= 0) return;
    const world = mapGridToWorld(cell[0] + 0.5, cell[1] + 0.5, maze.n, CUBE_SIZE, PLANE_Y);
    const screen = renderer.worldToScreen(world, camera);
    if (!screen) return;
    renderer.drawText(label, {
      x: screen.x,
      y: screen.y,
      size: Math.max(12, renderer.height * 0.04),
      align: 'center',
      baseline: 'middle',
      intensity,
    });
  }

  return {
    enter() {
      t = 0;
      maze = generateMaze(LEVEL1_N, { seed: randomSeed() });
      border = gridBorderWorld(maze.n, CUBE_SIZE, PLANE_Y);
      applyDock();
    },

    update(dt) {
      t += dt;
      if (t >= MARKER_TIME + GROW_TIME + HOLD_TIME) {
        game.dispatch(GameEvent.MAZE_READY);
      }
    },

    render(renderer) {
      if (!maze) return;
      applyDock();

      // 1) Festes aeusseres Quadrat (Grid-Rand).
      renderer.renderScene({ segments: border }, camera);

      // 2) Korridor-Randlinien fressen sich in der Grab-Reihenfolge hinein.
      const growT = clamp01((t - MARKER_TIME) / GROW_TIME);
      if (growT > 0) {
        const k = Math.round(growT * maze.order.length);
        const world = mapSegmentsToWorld(growthOutline(maze, k), maze.n, CUBE_SIZE, PLANE_Y);
        renderer.renderScene({ segments: world }, camera);
      }

      // 3) S/G-Marker blenden zu Beginn ein.
      const markerFade = clamp01(t / MARKER_TIME);
      drawMarker(renderer, maze.start, 'S', markerFade);
      drawMarker(renderer, maze.goal, 'G', markerFade);
    },
  };
}

// Zustand "Labyrinth-Erzeugung": uebernimmt nahtlos die Andock-Flaeche vom
// Startscreen und inszeniert den Aufbau:
//   1. das feste Quadrat (Grid-Rand) steht bereits (deckungsgleich mit dem Andock-Quadrat),
//   2. S/G-Marker blenden ein,
//   3. die Korridor-Randlinien "fressen" sich in der Grab-Reihenfolge hinein.
// Danach folgt der Uebergang ins Spiel.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { growthOutline } from '../world/mazeGeometry.js';
import {
  SIDE_FACES, faceDockPose, mapSegmentsToFace, gridBorderOnFace,
} from '../world/cubeFaces.js';
import { randomSeed } from '../util/rng.js';
import { levelConfig } from '../core/levels.js';
import { gnawPatch } from '../sound/patches.js';
import { drawCompassLabels, drawFaceMarker } from './mazeView.js';

const CUBE_SIZE = 2.4;

const MARKER_TIME = 0.7;  // Sekunden: S/G blenden ein
const GROW_TIME = 2.6;    // Sekunden: Labyrinth waechst
const HOLD_TIME = 1.0;    // Sekunden: fertiges Labyrinth steht

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function createMazeGen(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let border = null;
  let t = 0;
  let gnawing = false; // Nage-Sound gestartet? (einmalig beim Wachstums-Beginn)

  function applyDock() {
    const dock = faceDockPose(face, CUBE_SIZE, camera.fov, 0.85);
    camera.position = dock.position;
    camera.yaw = dock.yaw;
    camera.pitch = dock.pitch;
  }

  return {
    enter() {
      t = 0;
      gnawing = false;
      const cfg = levelConfig(game.level);
      maze = generateMaze(cfg.n, { seed: randomSeed(), metric: cfg.metric, straight: cfg.straight });
      game.maze = maze; // an Playing weiterreichen
      game.resume = false; // frisches Labyrinth: keine Fortsetzung, Ziel offen
      game.reachedGoal = false;
      game.gameOver = false;
      game.enemies = null; // Feinde gehoeren zum Labyrinth -> Playing erzeugt neue
      face = game.dockFace ?? SIDE_FACES[0]; // Fallback, falls ohne Andocken erreicht
      border = gridBorderOnFace(maze.n, CUBE_SIZE, face);
      applyDock();
    },

    update(dt) {
      t += dt;
      // Das "Nagen" laeuft synchron zum Hineinfressen der Korridor-Linien.
      if (!gnawing && t >= MARKER_TIME) {
        gnawing = true;
        game.audio?.play(gnawPatch(GROW_TIME));
      }
      if (t >= MARKER_TIME + GROW_TIME + HOLD_TIME) {
        game.dispatch(GameEvent.MAZE_READY, { fade: false }); // nahtlos ins Reinfallen
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
        const world = mapSegmentsToFace(growthOutline(maze, k), maze.n, CUBE_SIZE, face, maze.metric);
        renderer.renderScene({ segments: world }, camera);
      }

      // 3) S/G-Marker (Groesse folgt der Zellgroesse, siehe mazeView) und
      // Himmelsrichtungen blenden zu Beginn ein.
      const markerFade = clamp01(t / MARKER_TIME);
      if (markerFade > 0) {
        drawFaceMarker(renderer, maze.start, 'S', face, maze, camera, markerFade);
        drawFaceMarker(renderer, maze.goal, 'G', face, maze, camera, markerFade);
      }
      drawCompassLabels(renderer, maze, face, camera, markerFade);
    },
  };
}

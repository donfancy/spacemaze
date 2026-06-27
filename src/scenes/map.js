// Zustand "Karte": nach dem Rueckschwenk steht die Kartensicht still und zeigt das
// flache Labyrinth mit S/G und dem abgelaufenen Weg. Q -> zurueck zum Startscreen
// (der Wuerfel dreht wieder); nach 5 Minuten loest das automatisch aus.

import { GameEvent } from '../core/states.js';
import { createCamera } from '../math/camera.js';
import { generateMaze } from '../world/maze.js';
import { SIDE_FACES } from '../world/cubeFaces.js';
import {
  FAR_RATIO, NEAR_RATIO, cellSize, faceWalls, faceFootprints, renderFaceWalls, mapPose, drawMapOverlay,
} from './mazeView.js';

const AUTO_EXIT = 300; // 5 Minuten

export function createMap(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });

  let maze = null;
  let face = null;
  let walls = null;
  let footprints = null;
  let cell = 1;
  let pose = null;
  let t = 0;

  return {
    enter() {
      t = 0;
      maze = game.maze ?? generateMaze(11, {});
      face = game.dockFace ?? SIDE_FACES[0];
      cell = cellSize(maze);
      walls = faceWalls(maze, face, 0); // flaches Labyrinth (Korridor-Konturen)
      footprints = faceFootprints(maze, face);
      pose = mapPose(face, camera.fov);
    },

    update(dt) {
      t += dt;
      if (t >= AUTO_EXIT) game.dispatch(GameEvent.EXIT);
    },

    render(renderer) {
      renderFaceWalls(renderer, walls, footprints, camera, pose, { far: FAR_RATIO * cell, near: NEAR_RATIO * cell, occWeight: 0 });
      drawMapOverlay(renderer, maze, face, camera, game.trail, 1);

      renderer.drawText('YOUR PATH  -  Q TO RETURN', {
        x: renderer.width / 2,
        y: renderer.height - Math.max(40, renderer.height * 0.08),
        size: Math.max(14, renderer.height * 0.025),
        align: 'center', baseline: 'middle', intensity: 0.7,
      });
    },

    onKey(key) {
      if (key === 'Q') game.dispatch(GameEvent.EXIT); // -> Startscreen
    },
  };
}
